/* jshint esversion: 11,node: true,-W041: false */
"use strict";

const axios = require('axios');
const async = require('async');

class JeedomAPI {
    constructor(type, url, apikey, logLevel, mode = "event") {
        this.url = url;
        this.apikey = apikey;
        this.type = type;
        this.logLevel = logLevel;
        this.mode = mode; // "jsonrpc" | "event"
        this.maxRetry = 3;
        this.maxResponseTime = 20 * 1000;

        this.axiosInstance = axios.create({
            timeout: this.maxResponseTime,
            headers: {'Accept-Encoding': 'gzip, deflate'},
        });

        this.queue = async.queue(async (message, callback) => {
            await this.processMessage(message, callback);
        }, 1); // Concurrency of 1 for fifo
    }

    async processMessage(message, callback) {
        if (this.logLevel === 'ultradebug') {
            console.log('Traitement du message : ' + JSON.stringify(message.data));
        }

        try {
            let response = null;
            if (message.isJSONRPC) {
                const msg = {
                    jsonrpc: "2.0",
                    id: Math.floor(Math.random() * 1000),
                    method: "event",
                    params: {
                        plugin: this.type,
                        apikey: this.apikey,
                        data: message.data,
                    },
                };
                if (this.url !== "testURL") {
                    response = await this.axiosInstance.post(this.url, msg);
                }
            } else if (this.url !== "testURL") {
                response = await this.axiosInstance.post(this.url, message.data, {
                    headers: {"Content-Type": "multipart/form-data"},
                });
            }

            if (response?.data?.error) {
                console.error(`Erreur communication avec Jeedom API ${message.isJSONRPC ? "en JsonRPC" : ''} (retry ${message.tryCount}/${this.maxRetry}):`, 
                              response.data.error.code + ' : ' + response.data.error.message, 
                              "Message:", JSON.stringify(message.data));
                this.retryRequest(message, callback);
            } else {
                if (typeof callback === "function") callback(); // Succès
            }
        } catch (err) {
            console.error(`Erreur communication avec Jeedom ${message.isJSONRPC ? "en JsonRPC" : ''} (retry ${message.tryCount}/${this.maxRetry}):`, err);
            this.retryRequest(message, callback);
        }
    }

    retryRequest(message, callback) {
		if (message.tryCount < this.maxRetry) {
			message.tryCount++;
			setTimeout(() => this.queue.push(message, callback), 1000 + (1000 * message.tryCount));
		} else {
			console.error("Nombre maximal de tentatives atteint pour :", message);
			if (typeof callback === "function") callback();
		}
	}


    sendToJeedom(data, isJSONRPC = (this.mode === 'jsonrpc')) {
        data.type = 'event';
        data.apikey = this.apikey;
        data.plugin = this.type;
        const message = { data, tryCount: 0, isJSONRPC };

        if (this.logLevel === 'ultradebug') {
            console.log("Ajout du message " + JSON.stringify(message) + " dans la queue des messages à transmettre à Jeedom");
        }

        this.queue.push(message, () => {});
    }

    getSendToJeedom() {
        return this.sendToJeedom.bind(this);
    }
}

module.exports = (type, url, apikey, logLevel, mode = "event") => {
    const apiInstance = new JeedomAPI(type, url, apikey, logLevel, mode);
    return apiInstance.getSendToJeedom();
};
