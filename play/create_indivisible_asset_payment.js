/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('byteballcore/event_bus.js');

function onError(err){
	throw Error(err);
}

function createIndivisibleAssetPayment(){
	var network = require('byteballcore/network.js');
	var divisibleAsset = require('./divisible_asset.js');
	var walletGeneral = require('./wallet_general.js');
	
	divisibleAsset.composeAndSaveDivisibleAssetPaymentJoint({
		asset: 'Mbntr8pBevCjRgqj9Y9n80GrBD3SrAQEJjalh232/Qw=', 
		paying_addresses: ["PYQJWUWRMUUUSUHKNJWFHSR5OADZMUYR"],
		change_address: "PYQJWUWRMUUUSUHKNJWFHSR5OADZMUYR",
		to_address: "GIBIFBPG42MJHN4KGY7RV4UTHTHKVRJE",
		amount: 5000, 
		tolerance_plus: 0, 
		tolerance_minus: 0, 
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

eventBus.on('headless_wallet_ready', createIndivisibleAssetPayment);
