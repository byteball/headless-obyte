/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('byteballcore/event_bus.js');
var objectHash = require('byteballcore/object_hash.js');

function onError(err){
	throw Error(err);
}

function createDefinitionChange(){
	var composer = require('byteballcore/composer.js');
	var network = require('byteballcore/network.js');
	var callbacks = composer.getSavingCallbacks({
		ifNotEnoughFunds: onError,
		ifError: onError,
		ifOk: function(objJoint){
			network.broadcastJoint(objJoint);
		}
	});
	
	var arrNewDefinition = ["sig", {pubkey: "new pubkey in base64"}];
	var new_definition_chash = objectHash.getChash160(arrNewDefinition);
	composer.composeDefinitionChangeJoint("PYQJWUWRMUUUSUHKNJWFHSR5OADZMUYR", new_definition_chash, headlessWallet.signer, callbacks);
}

eventBus.on('headless_wallet_ready', createDefinitionChange);
