/* jshint esversion: 11,node: true,-W041: false */
"use strict";

const axios = require('axios');

class JeedomAPI {
    constructor(type, url, apikey, logLevel, mode = "event") {
        this.url = url;
        this.apikey = apikey;
        this.type = type;
        this.logLevel = logLevel;
        this.mode = mode; // "jsonrpc" | "event"
        this.busy = false;
        this.jeedomSendQueue = [];
        this.maxRetryDelay = 5 * 1000; // entre deux essais (2s, 3s, 4s puis 5s) tant que le message n'a pas dépassé maxMessageAge
        this.maxResponseTime = 20 * 1000;
        // Jeedom lent ou indisponible (sauvegarde, redémarrage...) : la file ne grossit pas sans fin et on n'envoie pas
        // des états périmés en retard
        this.maxQueueSize = 500; // au-delà, les plus anciens sont jetés
        this.maxMessageAge = 2 * 60 * 1000; // un message plus vieux est jeté au lieu d'être envoyé
        this.dropped = {};
        this.lastDropLog = 0;

        this.axiosInstance = axios.create({
            timeout: this.maxResponseTime,
            headers: {'Accept-Encoding': 'gzip, deflate'},
        });
    }

    async processJeedomSendQueue() {
        if (this.logLevel === 'ultradebug') {
            console.log('Nombre de messages en attente de traitement : ' + this.jeedomSendQueue.length);
        }

        let nextMessage = this.jeedomSendQueue.shift();
        while (nextMessage && Date.now() - nextMessage.createdAt > this.maxMessageAge) {
            this.drop('trop ancien');
            nextMessage = this.jeedomSendQueue.shift();
        }
        if (!nextMessage) {
            this.logDropped(); // le reste du décompte, une fois la file vidée
            this.busy = false;
            return;
        }

        if (this.logLevel === 'ultradebug') {
            console.log('Traitement du message : ' + this.forLog(nextMessage.data));
        }

        try {
            let response = null;
            if (nextMessage.isJSONRPC) {
                const msg = {
                    jsonrpc: "2.0",
                    id: Math.floor(Math.random() * 1000),
                    method: "event",
                    params: {
                        plugin: this.type,
                        apikey: this.apikey,
                        data: nextMessage.data,
                    },
                };
                if (this.url !== "testURL") {
                    response = await this.axiosInstance.post(this.url, msg);
                }
            } else if (this.url !== "testURL") {
                response = await this.axiosInstance.post(this.url, nextMessage.data, {
                    headers: {"Content-Type": "multipart/form-data"},
                });
            }

            if (response?.data?.error) {
                // Jeedom a reçu et traité le message mais le plugin a levé une erreur : le renvoyer échouerait pareil
                // (et rejouerait ce qui a été fait avant l'erreur, ex : une automatisation)
                console.error("Erreur de Jeedom API " + (nextMessage.isJSONRPC?"en JsonRPC":'') + ", message non renvoyé : ", response.data.error.code + ' : ' + response.data.error.message, "Message:", this.forLog(nextMessage.data));
                setImmediate(() => this.processJeedomSendQueue());
            } else {
                setImmediate(() => this.processJeedomSendQueue());
            }
        } catch (err) {
            // message seulement : l'erreur axios contient la requête, donc la clé API
            if(err) { console.error("Erreur communication avec Jeedom " + (nextMessage.isJSONRPC?"en JsonRPC":'') + " (essai " + (nextMessage.tryCount + 1) + "): ", (err.message || String(err)) + (err.code ? ' [' + err.code + ']' : '')); }
            // renvoi seulement si Jeedom n'a pas répondu (réseau, délai dépassé) ou a répondu une erreur serveur (5xx)
            if (!err?.response || err.response.status >= 500) {
                this.retryRequest(nextMessage);
            } else {
                setImmediate(() => this.processJeedomSendQueue());
            }
        }
    }

    // Jeedom n'a pas répondu ou erreur serveur : on réessaie le même message (l'ordre est gardé) jusqu'à ce qu'il soit trop
    // ancien (maxMessageAge), il est alors jeté au traitement suivant. Pas de message sauté au milieu : seuls les plus anciens
    // sont perdus pendant une coupure, puis tout ce qui est récent part dans l'ordre au retour de Jeedom.
    retryRequest(message) {
        message.tryCount++;
        this.jeedomSendQueue.unshift(message);
        setTimeout(() => this.processJeedomSendQueue(), Math.min(1000 + (1000 * message.tryCount), this.maxRetryDelay));
    }

    sendToJeedom(data, isJSONRPC = (this.mode === 'jsonrpc')) {
        // copie : l'envoi se fait plus tard (file), le plugin peut modifier son objet juste après l'appel, et on n'y écrit plus rien
        let copy;
        try { copy = structuredClone(data); } catch (_) { copy = {...data}; } // (fonction dans les données...)
        copy.type = 'event';
        copy.plugin = this.type;
        // en JSON-RPC la clé est déjà dans params.apikey : pas dans les données remises à event() du plugin (qui peut les loguer)
        if (!isJSONRPC) { copy.apikey = this.apikey; }
        const message = {data: copy, tryCount: 0, isJSONRPC: isJSONRPC, createdAt: Date.now()};

        if (this.logLevel === 'ultradebug') {
            console.log("Ajout du message " + this.forLog(message.data) + " dans la queue des messages à transmettre à Jeedom");
        }

        if (this.jeedomSendQueue.length >= this.maxQueueSize) {
            this.jeedomSendQueue.shift();
            this.drop('file pleine');
        }
        this.jeedomSendQueue.push(message);
        if (!this.busy) {
            this.busy = true;
            setImmediate(() => this.processJeedomSendQueue());
        }
    }

    // message non envoyé : compté, et loggé au plus toutes les 10s (pas une ligne par message quand Jeedom ne répond plus)
    drop(reason) {
        this.dropped[reason] = (this.dropped[reason] || 0) + 1;
        if (Date.now() - this.lastDropLog >= 10 * 1000) { this.logDropped(); }
    }

    logDropped() {
        if (!Object.keys(this.dropped).length) { return; }
        console.error("Jeedom ne traite pas les messages assez vite, messages non envoyés : " + Object.entries(this.dropped).map(([r, n]) => n + " (" + r + ")").join(', '));
        this.dropped = {};
        this.lastDropLog = Date.now();
    }

    // message pour les logs, sans la clé API
    forLog(data) {
        return JSON.stringify(data, (key, value) => ((key === 'apikey') ? '***' : value));
    }

    getSendToJeedom() {
        return this.sendToJeedom.bind(this);
    }
}

module.exports = (type, url, apikey, logLevel, mode = "event") => {
    const apiInstance = new JeedomAPI(type, url, apikey, logLevel, mode);
    return apiInstance.getSendToJeedom();
};
