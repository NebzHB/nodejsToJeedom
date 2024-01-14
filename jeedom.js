/* jshint esversion: 8,node: true,-W041: false */
"use strict";

const axios = require('axios');

let busy = false;
let busyRPC = false;
const jeedomSendQueue = [];
const jeedomSendRPCQueue = [];

let thisUrl="";
let thisApikey="";
let thisType="";
let sessionId="";
let thisLogLevel="";
let thisMode="";

const processJeedomSendQueue = () => {
	// console.log('Nombre de messages en attente de traitement : ' + jeedomSendQueue.length);
	const nextMessage = jeedomSendQueue.shift();

	if (!nextMessage) {
		busy = false;
		return;
	}
	
	//console.log('Traitement du message : ' + JSON.stringify(nextMessage.data));
	axios.post(thisUrl,new URLSearchParams(nextMessage.data).toString(),{headers: {'Content-Type': 'application/x-www-form-urlencoded'}})
	.then(response => {
		if(response.data.error) {
			console.error("Erreur communication avec Jeedom 1 (retry "+nextMessage.tryCount+"/5): ",response.data.error.code+' : '+response.data.error.message);
			retryRequest(nextMessage,jeedomSendQueue,processJeedomSendQueue);
			return;
		}
		//if(thislogLevel == 'debug' && response.data) { console.log("Réponse de Jeedom : ", response); }
		setImmediate(processJeedomSendQueue);
	}).catch(err => {
		if(err) { console.error("Erreur communication avec Jeedom 2 (retry "+nextMessage.tryCount+"/5): ",err,err?.code,err?.response?.status,err?.response?.statusText);}
		retryRequest(nextMessage,jeedomSendQueue,processJeedomSendQueue);
	});
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

const processJeedomSendRPCQueue = () => {
	//console.log('Nombre de messages en attente de traitement pour RPC : ' + jeedomSendRPCQueue.length);
	const nextMessage = jeedomSendRPCQueue.shift();

	if (!nextMessage) {
		busyRPC = false;
		return;
	}
	//console.log('Traitement du message : ' + JSON.stringify(nextMessage.data));
	axios.post(thisUrl, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"event",
		params:{
			plugin:thisType,
			apikey:thisApikey,
			session:true,
			sess_id:sessionId,
			data:nextMessage.data,
		},
	}).then((response) => {
		if(response.data.error) {
			console.error("Erreur communication avec Jeedom JsonRPC 1 (retry "+nextMessage.tryCount+"/5): ",response.data.error.code+' : '+response.data.error.message);
			retryRequest(nextMessage,jeedomSendRPCQueue,processJeedomSendRPCQueue);
			return;
		} 
		//console.log("Réponse de Jeedom : ", response);
		if (response.data.sess_id !== undefined) {
			sessionId = response.data.sess_id;
		} else {
			sessionId = "";
		}
		//if(thislogLevel == 'debug' && response.data) { console.log("Réponse de Jeedom : ", response); }
		setImmediate(processJeedomSendRPCQueue);
	}).catch(err => {
		if(err) { console.error("Erreur communication avec Jeedom JsonRPC 2 (retry "+nextMessage.tryCount+"/5): ",err,err?.code,err?.response?.status,err?.response?.statusText);}
		retryRequest(nextMessage,jeedomSendRPCQueue,processJeedomSendRPCQueue);
	});
	
	// console.log('Traitement du message : ' + JSON.stringify(nextMessage));
};


const sendToJeedom = (data) => {
	const origDataSize = thisMode === 'size' ? JSON.stringify(data).length : 0;
	
	// console.log("sending with "+thisUrl+" and "+thisApikey);
	data.type = 'event';
	data.apikey= thisApikey;
	data.plugin= thisType;

	const message = {data: data, tryCount: 0};
	// console.log("Ajout du message " + JSON.stringify(message) + " dans la queue des messages a transmettre a Jeedom");
	switch(thisMode) {
		case 'jsonrpc':
			jeedomSendRPCQueue.push(message);
			if(!busyRPC) {
				busyRPC = true;
				setImmediate(processJeedomSendRPCQueue);
			}
		break;
		case 'event':
			jeedomSendQueue.push(message);
			if(!busy) {
				busy = true;
				setImmediate(processJeedomSendQueue);
			}
		break;
		case 'size':
			if(origDataSize > (100 * 1024)) { // > 100k
				jeedomSendRPCQueue.push(message);
				if(!busyRPC) {
					busyRPC = true;
					setImmediate(processJeedomSendRPCQueue);
				}
			} else {
				jeedomSendQueue.push(message);
				if(!busy) {
					busy = true;
					setImmediate(processJeedomSendQueue);
				}
			}
		break;
		default:
			console.error("Mode "+thisMode+" inconnu !");
		break;
	}
};


module.exports = ( type, url, apikey, logLevel, mode="event" ) => { 
	//console.log("== Importing jeedom api mode "+mode+" on "+logLevel+" for "+type+" with "+url+" and "+apikey);
	thisUrl=url;
	thisApikey=apikey;
	thisType=type;
	thisLogLevel=logLevel;
	thisMode=mode; // "size" = if >100k -> jsonrpc, else event | "jsonrpc" | "event"
	return sendToJeedom;
};
