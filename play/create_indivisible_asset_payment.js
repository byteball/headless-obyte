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
		asset: 'JY4RvlUGv0qWItikizmNOIjIYZeEciODOog8AzLju50=', 
		paying_addresses: ["3VH6WZ4V5AD2U55MQLRQPHRRCYQCFDUI"],
		fee_paying_addresses: ["3VH6WZ4V5AD2U55MQLRQPHRRCYQCFDUI"],
		change_address: "3VH6WZ4V5AD2U55MQLRQPHRRCYQCFDUI",
		to_address: "ORKPD5QZFX4JDGYBQ7FV535LCRDOJQHK",
		amount: 2111100000000000, 
		tolerance_plus: 0, 
		tolerance_minus: 0, 
		signer: headlessWallet.signer, 
		callbacks: {
			ifError: onError,
			ifNotEnoughFunds: onError,
			ifOk: function(objJoint, arrRecipientChains, arrCosignerChains){
				network.broadcastJoint(objJoint);
				if (arrRecipientChains){ // if the asset is private
					// send directly to the receiver
					//network.sendPrivatePayment('wss://example.org/bb', arrRecipientChains);
					
					// or send to the receiver's device address through the receiver's hub
					walletGeneral.sendPrivatePayments("0DTZZY6J27KSEVEXL4BIGTZXAELJ47OYW", arrRecipientChains);
				}
			}
		}
	});
}

eventBus.on('headless_wallet_ready', createIndivisibleAssetPayment);
