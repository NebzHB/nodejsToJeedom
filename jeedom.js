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
        this.maxRetry = 3;
        this.maxResponseTime = 20 * 1000;

        this.axiosInstance = axios.create({
            timeout: this.maxResponseTime,
            headers: {'Accept-Encoding': 'gzip, deflate'},
        });
    }

    async processJeedomSendQueue() {
        if (this.logLevel === 'ultradebug') {
            console.log('Nombre de messages en attente de traitement : ' + this.jeedomSendQueue.length);
        }

        const nextMessage = this.jeedomSendQueue.shift();
        if (!nextMessage) {
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
            if(err) { console.error("Erreur communication avec Jeedom " + (nextMessage.isJSONRPC?"en JsonRPC":'') + " (retry " + nextMessage.tryCount + "/" + this.maxRetry + "): ", (err.message || String(err)) + (err.code ? ' [' + err.code + ']' : '')); }
            // renvoi seulement si Jeedom n'a pas répondu (réseau, délai dépassé) ou a répondu une erreur serveur (5xx)
            if (!err?.response || err.response.status >= 500) {
                this.retryRequest(nextMessage);
            } else {
                setImmediate(() => this.processJeedomSendQueue());
            }
        }
    }

    retryRequest(message) {
        if (message.tryCount < this.maxRetry) {
            message.tryCount++;
            this.jeedomSendQueue.unshift(message);
            setTimeout(() => this.processJeedomSendQueue(), 1000 + (1000 * message.tryCount));
        } else {
            console.error("Nombre maximal de tentatives atteint pour : ", this.forLog(message.data));
            setImmediate(() => this.processJeedomSendQueue()); // message abandonné : on passe aux suivants (sinon la file reste bloquée)
        }
    }

    sendToJeedom(data, isJSONRPC = (this.mode === 'jsonrpc')) {
        // copie : l'envoi se fait plus tard (file), le plugin peut modifier son objet juste après l'appel, et on n'y écrit plus rien
        let copy;
        try { copy = structuredClone(data); } catch (_) { copy = {...data}; } // (fonction dans les données...)
        copy.type = 'event';
        copy.plugin = this.type;
        // en JSON-RPC la clé est déjà dans params.apikey : pas dans les données remises à event() du plugin (qui peut les loguer)
        if (!isJSONRPC) { copy.apikey = this.apikey; }
        const message = {data: copy, tryCount: 0, isJSONRPC: isJSONRPC};

        if (this.logLevel === 'ultradebug') {
            console.log("Ajout du message " + this.forLog(message.data) + " dans la queue des messages à transmettre à Jeedom");
        }

        this.jeedomSendQueue.push(message);
        if (!this.busy) {
            this.busy = true;
            setImmediate(() => this.processJeedomSendQueue());
        }
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
