/* jshint esversion: 11,node: true,-W041: false */
"use strict";

const axios = require('axios');
let axiosInstance;

let busy = false;
const jeedomSendQueue = [];

let thisURL="";
let thisApikey="";
let thisType="";
let thisLogLevel="";
let thisMode="";


const processJeedomSendQueue = async () => {
	if(thisLogLevel === 'ultradebug') { console.log('Nombre de messages en attente de traitement : ' + jeedomSendQueue.length); }
	
	const nextMessage = jeedomSendQueue.shift();
	if(!nextMessage) {
		busy = false;
		return;
	}
	
	if(thisLogLevel === 'ultradebug') { console.log('Traitement du message : ' + JSON.stringify(nextMessage.data)); }
	if(nextMessage.isJSONRPC) {
		try {
			const response = await axiosInstance.post(thisURL, 
			{
				jsonrpc:"2.0",
				id:(Math.floor(Math.random() * 1000)),
				method:"event",
				params:{
					plugin:thisType,
					apikey:thisApikey,
					data:nextMessage.data,
				},
			});
		
			if(response.data.error) {
				console.error("Erreur communication avec Jeedom API en JsonRPC (retry "+nextMessage.tryCount+"/5): ",response.data.error.code+' : '+response.data.error.message);
				retryRequest(nextMessage,jeedomSendQueue,processJeedomSendQueue);
				return;
			} 
			setImmediate(processJeedomSendQueue);
		} catch (err) {
			if(err) { console.error("Erreur communication avec Jeedom en JsonRPC (retry "+nextMessage.tryCount+"/5): ",err,err?.code,err?.response?.status,err?.response?.statusText);}
			retryRequest(nextMessage,jeedomSendQueue,processJeedomSendQueue);
		}
	} else {
		try {
			const response=await axiosInstance.post(thisURL,nextMessage.data,{headers:{"Content-Type": "multipart/form-data"}});
			
			if(response.data.error) {
				console.error("Erreur communication avec Jeedom API (retry "+nextMessage.tryCount+"/5): ",response.data.error.code+' : '+response.data.error.message);
				retryRequest(nextMessage,jeedomSendQueue,processJeedomSendQueue);
				return;
			}
			setImmediate(processJeedomSendQueue);
		} catch (err) {
			if(err) { console.error("Erreur communication avec Jeedom (retry "+nextMessage.tryCount+"/5): ",err,err?.code,err?.response?.status,err?.response?.statusText);}
			retryRequest(nextMessage,jeedomSendQueue,processJeedomSendQueue);
		}
	}
};


const retryRequest = (message, queue, callback) => {
    if (message.tryCount < 5) {
        message.tryCount++;
        queue.unshift(message);
        setTimeout(callback, 1000 + (1000 * message.tryCount));
    } else {
        console.error("Nombre maximal de tentatives atteint pour : ", message);
    }
};


const sendToJeedom = (data, isJSONRPC = (thisMode==='jsonrpc'?true:false)) => {
	data.type = 'event';
	data.apikey= thisApikey;
	data.plugin= thisType;
	const message = {data: data, tryCount: 0, isJSONRPC: isJSONRPC};

	if(thisLogLevel === 'ultradebug') { console.log("Ajout du message " + JSON.stringify(message) + " dans la queue des messages a transmettre a Jeedom"); }
	
	jeedomSendQueue.push(message);
	if(!busy) {
		busy = true;
		setImmediate(processJeedomSendQueue);
	}
};


module.exports = ( type, url, apikey, logLevel, mode="event" ) => { 
	thisURL=url;
	thisApikey=apikey;
	thisType=type;
	thisLogLevel=logLevel;
	thisMode=mode; // "jsonrpc" | "event"
	axiosInstance = axios.create({
		timeout: 10000,
		headers: {'Accept-Encoding': 'gzip, deflate'},
	});
	return sendToJeedom;
};
