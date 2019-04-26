/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('ocore/event_bus.js');

function onError(err){
	throw Error(err);
}

function createDivisibleAssetPayment(){
	var network = require('ocore/network.js');
	var divisibleAsset = require('ocore/divisible_asset.js');
	var walletGeneral = require('ocore/wallet_general.js');
	
	divisibleAsset.composeAndSaveDivisibleAssetPaymentJoint({
		asset: 'gRUW3CkKYA9LNf2/gX4bnDdnDZyPY9TAd9wIATzXSwE=', 
		paying_addresses: ["PYQJWUWRMUUUSUHKNJWFHSR5OADZMUYR"],
		fee_paying_addresses: ["PYQJWUWRMUUUSUHKNJWFHSR5OADZMUYR"],
		change_address: "PYQJWUWRMUUUSUHKNJWFHSR5OADZMUYR",
		to_address: "GIBIFBPG42MJHN4KGY7RV4UTHTHKVRJE",
		amount: 5000, 
		signer: headlessWallet.signer, 
		callbacks: {
			ifError: onError,
			ifNotEnoughFunds: onError,
			ifOk: function(objJoint, arrChains){
				network.broadcastJoint(objJoint);
				if (arrChains){ // if the asset is private
					// send directly to the receiver
					network.sendPrivatePayment('wss://example.org/bb', arrChains);
					
					// or send to the receiver's device address through the receiver's hub
					//walletGeneral.sendPrivatePayments("0F7Z7DDVBDPTYJOY7S4P24CW6K23F6B7S", arrChains);
				}
			}
		}
	});
}

eventBus.on('headless_wallet_ready', createDivisibleAssetPayment);
