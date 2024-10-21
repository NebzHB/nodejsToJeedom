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
            headers: { 'Accept-Encoding': 'gzip, deflate' },
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
            console.log('Traitement du message : ' + JSON.stringify(nextMessage.data));
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
            } else {
                if (this.url !== "testURL") {
                    response = await this.axiosInstance.post(this.url, nextMessage.data, {
                        headers: { "Content-Type": "multipart/form-data" },
                    });
                }
            }

            if (response?.data?.error) {
                console.error("Erreur communication avec Jeedom API " + (nextMessage.isJSONRPC?"en JsonRPC":'') + " (retry " + nextMessage.tryCount + "/" + this.maxRetry + "): ", response.data.error.code + ' : ' + response.data.error.message, "Message:", JSON.stringify(nextMessage.data));
                this.retryRequest(nextMessage);
            } else {
                setImmediate(() => this.processJeedomSendQueue());
            }
        } catch (err) {
            if(err) { console.error("Erreur communication avec Jeedom " + (nextMessage.isJSONRPC?"en JsonRPC":'') + " (retry " + nextMessage.tryCount + "/" + this.maxRetry + "): ", err); }
            this.retryRequest(nextMessage);
        }
    }

    retryRequest(message) {
        if (message.tryCount < this.maxRetry) {
            message.tryCount++;
            this.jeedomSendQueue.unshift(message);
            setTimeout(() => this.processJeedomSendQueue(), 1000 + (1000 * message.tryCount));
        } else {
            console.error("Nombre maximal de tentatives atteint pour : ", message);
        }
    }

    sendToJeedom(data, isJSONRPC = (this.mode === 'jsonrpc')) {
        data.type = 'event';
        data.apikey = this.apikey;
        data.plugin = this.type;
        const message = { data: data, tryCount: 0, isJSONRPC: isJSONRPC };

        if (this.logLevel === 'ultradebug') {
            console.log("Ajout du message " + JSON.stringify(message) + " dans la queue des messages à transmettre à Jeedom");
        }

        this.jeedomSendQueue.push(message);
        if (!this.busy) {
            this.busy = true;
            setImmediate(() => this.processJeedomSendQueue());
        }
    }

    getSendToJeedom() {
        return this.sendToJeedom.bind(this);
    }
}

module.exports = (type, url, apikey, logLevel, mode = "event") => {
    const apiInstance = new JeedomAPI(type, url, apikey, logLevel, mode);
    return apiInstance.getSendToJeedom();
};
