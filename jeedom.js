/* jshint esversion: 8,node: true,-W041: false */
"use strict";

const axios = require('axios');

var busy = false;
var busyRPC = false;
var jeedomSendQueue = [];
var jeedomSendRPCQueue = [];

var thisUrl="";
var thisApikey="";
var thisType="";
var sessionId="";
var thisLogLevel="";
var thisMode="";

var processJeedomSendQueue = function()
{
	// console.log('Nombre de messages en attente de traitement : ' + jeedomSendQueue.length);
	var nextMessage = jeedomSendQueue.shift();

	if (!nextMessage) {
		busy = false;
		return;
	}
	 console.log('Traitement du message : ' + JSON.stringify(nextMessage.data));
	axios.post(thisUrl,JSON.stringify(nextMessage.data),{headers:{"Content-Type": "multipart/form-data"}}
	).then(response => {
		if(response.data.error) {
			console.error("Erreur communication avec Jeedom 1 (retry "+nextMessage.tryCount+"/5): ",response.data.error.code+' : '+response.data.error.message);
			if (nextMessage.tryCount < 5)
			{
				nextMessage.tryCount++;
				jeedomSendQueue.unshift(nextMessage);
			}
			setTimeout(processJeedomSendQueue, 1000+(1000*nextMessage.tryCount));
			return;
		}
		//if(thislogLevel == 'debug' && response.data) { console.log("Réponse de Jeedom : ", response); }
		process.nextTick(processJeedomSendQueue);
	}).catch(err => {
		if(err) { console.error("Erreur communication avec Jeedom 2 (retry "+nextMessage.tryCount+"/5): ",err);}//+' : 'err.code+err.response.status+' '+err.response.statusText); }
		if (nextMessage.tryCount < 5)
		{
			nextMessage.tryCount++;
			jeedomSendQueue.unshift(nextMessage);
		}
		setTimeout(processJeedomSendQueue, 1000+(1000*nextMessage.tryCount));
	});
};

var processJeedomSendRPCQueue = function()
{
	// console.log('Nombre de messages en attente de traitement pour RPC : ' + jeedomSendRPCQueue.length);
	var nextMessage = jeedomSendRPCQueue.shift();

	if (!nextMessage) {
		busyRPC = false;
		return;
	}

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
			if (nextMessage.tryCount < 5)
			{
				nextMessage.tryCount++;
				jeedomSendRPCQueue.unshift(nextMessage);
			}
			setTimeout(processJeedomSendRPCQueue, 1000+(1000*nextMessage.tryCount));
			return;
		} 
		if (response.data.sess_id !== undefined) {
			sessionId = response.data.sess_id;
		} else {
			sessionId = "";
		}
		//if(thislogLevel == 'debug' && response.data) { console.log("Réponse de Jeedom : ", response); }
		process.nextTick(processJeedomSendRPCQueue);
	}).catch(err => {
		if(err) { console.error("Erreur communication avec Jeedom JsonRPC 2 (retry "+nextMessage.tryCount+"/5): ",err);}//err.code+' : '+err.response.status+' '+err.response.statusText); }
		if (nextMessage.tryCount < 5)
		{
			nextMessage.tryCount++;
			jeedomSendRPCQueue.unshift(nextMessage);
		}
		setTimeout(processJeedomSendRPCQueue, 1000+(1000*nextMessage.tryCount));
	});
	
	// console.log('Traitement du message : ' + JSON.stringify(nextMessage));
};

var sendToJeedom = function(data)
{
	const origDataSize=JSON.stringify(data).length;
	// console.log("sending with "+thisUrl+" and "+thisApikey);
	data.type = 'event';
	data.apikey= thisApikey;
	data.plugin= thisType;

	var message = {};
	message.data = data;
	message.tryCount = 0;
	// console.log("Ajout du message " + JSON.stringify(message) + " dans la queue des messages a transmettre a Jeedom");
	if(thisMode == "size") {
		if(origDataSize > (100 * 1024)) { // > 100k
			jeedomSendRPCQueue.push(message);  
		} else {
			jeedomSendQueue.push(message);
		}
	} else if(thisMode == "jsonrpc") {
		jeedomSendRPCQueue.push(message);  
	} else if(thisMode == "event") {
		jeedomSendQueue.push(message);  
	}
	
	// unQueue
	if ((thisMode == "size" || thisMode == "jsonrpc") && !busyRPC && jeedomSendRPCQueue.length) {
		busyRPC = true;
		process.nextTick(processJeedomSendRPCQueue);
	}
	if ((thisMode == "size" || thisMode == "event") && !busy && jeedomSendQueue.length) {
		busy = true;
		process.nextTick(processJeedomSendQueue);
	}
};


module.exports = ( type, url, apikey, mode="size" ) => { 
	// console.log("importing jeedom with "+url+" and "+apikey);
	thisUrl=url;
	thisApikey=apikey;
	thisType=type;
	//thisLogLevel=logLevel;
	thisMode=mode; // "size" = if >100k -> jsonrpc, else event | "jsonrpc" | "event"
	return sendToJeedom;
};
