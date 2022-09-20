"use strict";

const request = require('request');

var busy = false;
var jeedomSendQueue = [];
var jeedomSendRPCQueue = [];

var thisUrl="";
var thisApikey="";
var thisType="";
var sessionId="";

var processJeedomSendQueue = function()
{
	// console.log('Nombre de messages en attente de traitement : ' + jeedomSendQueue.length);
	var nextMessage = jeedomSendQueue.shift();

	if (!nextMessage) {
		busy = false;
		return;
	}
	// console.log('Traitement du message : ' + JSON.stringify(nextMessage));
	request.post({url:thisUrl, form:nextMessage.data}, function(err, _response, _body) {
		if(err)
		{
			// console.log(err);
			if (nextMessage.tryCount < 5)
			{
				nextMessage.tryCount++;
				jeedomSendQueue.unshift(nextMessage);
			}
		}
		else {
			// console.log("Response from Jeedom: " + response.statusCode);
			// console.log("Full Response: " + JSON.stringify(response));
		}
		setTimeout(_processJeedomSendQueue, 0.01*1000);
	});
};

var processJeedomSendRPCQueue = function()
{
	// console.log('Nombre de messages en attente de traitement pour RPC : ' + jeedomSendRPCQueue.length);
	var nextMessage = jeedomSendRPCQueue.shift();

	if (!nextMessage) {
		busy = false;
		return;
	}
	
	var requestContent = {
		"request":'{"jsonrpc":"2.0","id":"'+(Math.floor(Math.random() * 1000))+'","method":"event","params":{"plugin":"'+thisType+'","apikey":"' + thisApikey + '","session":true,"sess_id":"'+ sessionId +'","data":'+JSON.stringify(nextMessage.data)+'}}',
	};
	
	// console.log('Traitement du message : ' + JSON.stringify(nextMessage));
	request.post(thisUrl,{json:true,gzip:true, form:requestContent}, function(err, _response, json) {
		if (err)
		{
			// console.log(err);
			if (nextMessage.tryCount < 5)
			{
				nextMessage.tryCount++;
				jeedomSendRPCQueue.unshift(nextMessage);
			}
		}
		else if (_response.statusCode == 200) {
			if (!json) {
				console.error("JSON reçu de Jeedom invalide, vérifiez le log API de Jeedom, reçu :"+JSON.stringify(_response));
			}
			if (!json.result && json.error) {
				console.error(json.error);
			} else if (json.sess_id !== undefined) {
				sessionId = json.sess_id;
			} else {
				sessionId = "";
			}
		} else {
			console.error(err, _response.statusCode);
		}
		setTimeout(processJeedomSendRPCQueue, 0.01*1000);
	});
};

var sendToJeedom = function(data)
{
	// console.log("sending with "+thisUrl+" and "+thisApikey);
	data.type = thisType;
	data.apikey= thisApikey;
	var message = {};
	message.data = data;
	message.tryCount = 0;
	// console.log("Ajout du message " + JSON.stringify(message) + " dans la queue des messages a transmettre a Jeedom");
	if(data.length > (100 * 1024)) { // > 100k
		jeedomSendRPCQueue.push(message);  
	} else {
		jeedomSendQueue.push(message);
	}
	if (busy) {return;}
	busy = true;
	processJeedomSendQueue();
	processJeedomSendRPCQueue();
};


module.exports = ( type, url, apikey ) => { 
	// console.log("importing jeedom with "+url+" and "+apikey);
	thisUrl=url;
	thisApikey=apikey;
	thisType=type;
	return sendToJeedom;
};
