/* jshint esversion: 8,node: true,-W041: false */
"use strict";

const request = require('request');

var busy = false;
var busyRPC = false;
var jeedomSendQueue = [];
var jeedomSendRPCQueue = [];

var thisUrl="";
var thisApikey="";
var thisType="";
var this42="";
var sessionId="";
var thisLogLevel="";

var processJeedomSendQueue = function()
{
	// console.log('Nombre de messages en attente de traitement : ' + jeedomSendQueue.length);
	var nextMessage = jeedomSendQueue.shift();

	if (!nextMessage) {
		busy = false;
		return;
	}
	// console.log('Traitement du message : ' + JSON.stringify(nextMessage));
	request.post({url:thisUrl, form:nextMessage.data}, function(err, response, body) {
		if(err)
		{
			if(thisLogLevel == 'debug') { console.error("Erreur communication avec Jeedom (retry "+nextMessage.tryCount+"/5): ",err,response,body); }
			if (nextMessage.tryCount < 5)
			{
				nextMessage.tryCount++;
				jeedomSendQueue.unshift(nextMessage);
			}
		}
		else if(thisLogLevel == 'debug' && response.body.trim() != '') { console.log("Réponse de Jeedom : ", response.body); }
		setTimeout(processJeedomSendQueue, 0.01*1000);
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
	
	var requestContent = {
		"request":'{"jsonrpc":"2.0","id":"'+(Math.floor(Math.random() * 1000))+'","method":"event","params":{"plugin":"'+thisType+'","apikey":"' + thisApikey + '","session":true,"sess_id":"'+ sessionId +'","data":'+JSON.stringify(nextMessage.data)+'}}',
	};
	
	// console.log('Traitement du message : ' + JSON.stringify(nextMessage));
	request.post(thisUrl,{json:true,gzip:true, form:requestContent}, function(err, response, json) {
		if (err)
		{
			if(thisLogLevel == 'debug') { console.error("Erreur communication avec Jeedom JSONRPC (retry "+nextMessage.tryCount+"/5): ",err,response,json); }
			if (nextMessage.tryCount < 5)
			{
				nextMessage.tryCount++;
				jeedomSendRPCQueue.unshift(nextMessage);
			}
		}
		else if (response.statusCode == 200) {
			if (!json) {
				console.error("JSON reçu de Jeedom invalide, vérifiez le log API de Jeedom, reçu :"+JSON.stringify(response));
			}
			if (!json.result && json.error) {
				console.error(json.error);
			} else if (json.sess_id !== undefined) {
				sessionId = json.sess_id;
			} else {
				sessionId = "";
			}
		} else {
			console.error(err, response.statusCode);
		}
		setTimeout(processJeedomSendRPCQueue, 0.01*1000);
	});
};

var sendToJeedom = function(data)
{
	const origDataSize=JSON.stringify(data).length;
	// console.log("sending with "+thisUrl+" and "+thisApikey);
	if(this42 == '0') {
		data.type = thisType;
		data.apikey= thisApikey;
	} else {
		data.type = 'event';
		data.apikey= thisApikey;
		data.plugin= thisType;
	}
	var message = {};
	message.data = data;
	message.tryCount = 0;
	// console.log("Ajout du message " + JSON.stringify(message) + " dans la queue des messages a transmettre a Jeedom");
	if(origDataSize > (100 * 1024)) { // > 100k
		jeedomSendRPCQueue.push(message);  
	} else {
		jeedomSendQueue.push(message);
	}
	
	// unQueue
	if (!busyRPC && jeedomSendRPCQueue.length) {
		busyRPC = true;
		process.nextTick(processJeedomSendRPCQueue);
	}
	if (!busy && jeedomSendQueue.length) {
		busy = true;
		process.nextTick(processJeedomSendQueue);
	}
};


module.exports = ( type, url, apikey, jeedom42, logLevel ) => { 
	// console.log("importing jeedom with "+url+" and "+apikey);
	thisUrl=url;
	thisApikey=apikey;
	thisType=type;
	this42=jeedom42;
	thisLogLevel=logLevel;
	return sendToJeedom;
};
