/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('byteballcore/event_bus.js');

function onError(err){
	throw Error(err);
}

function createDefinitionTemplate(){
	var composer = require('byteballcore/composer.js');
	var network = require('byteballcore/network.js');
	var callbacks = composer.getSavingCallbacks({
		ifNotEnoughFunds: onError,
		ifError: onError,
		ifOk: function(objJoint){
			network.broadcastJoint(objJoint);
		}
	});
	
	// this template depends on two variables: $address and $ts
	var definition_template = ["and", [
		["address", "$address"], 
		["in data feed", [["MO7ZZIU5VXHRZGGHVSZWLWL64IEND5K2"], "timestamp", ">=", "$ts"]]
	]];
	composer.composeDedinitionTemplateJoint("PYQJWUWRMUUUSUHKNJWFHSR5OADZMUYR", definition_template, headlessWallet.signer, callbacks);
}

eventBus.on('headless_wallet_ready', createDefinitionTemplate);
