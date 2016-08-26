/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('byteballcore/event_bus.js');

function onError(err){
	throw Error(err);
}

function createIndivisibleAssetPayment(){
	var network = require('byteballcore/network.js');
	var indivisibleAsset = require('byteballcore/indivisible_asset.js');
	var walletGeneral = require('byteballcore/wallet_general.js');
	
	indivisibleAsset.composeAndSaveIndivisibleAssetPaymentJoint({
		asset: 'Qgb6/iSQeuaE7sMJY4WI/Nqukn2lRqwGlyxsuvjCRVI=', 
		paying_addresses: ["3VH6WZ4V5AD2U55MQLRQPHRRCYQCFDUI"],
		change_address: "3VH6WZ4V5AD2U55MQLRQPHRRCYQCFDUI",
		to_address: "C4HXVBEHNEMWBAADDLY2GZU7INUMSJ47",
		amount: 5321, 
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
					//network.sendPrivatePayment('wss://example.org/bb', arrChains);
					
					// or send to the receiver's device address through the receiver's hub
					walletGeneral.sendPrivatePayments("0DTZZY6J27KSEVEXL4BIGTZXAELJ47OYW", arrChains);
				}
			}
		}
	});
}

eventBus.on('headless_wallet_ready', createIndivisibleAssetPayment);
