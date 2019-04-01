/*jslint node: true */
"use strict";
var constants = require('ocore/constants.js');
var conf = require('ocore/conf.js');
var db = require('ocore/db.js');
var eventBus = require('ocore/event_bus.js');
var headlessWallet = require('../start.js');


const COUNT_CHUNKS = 100;

var my_address;

if (!conf.bSingleAddress)
	throw Error('split must be on single address');

headlessWallet.setupChatEventHandlers();


function work(){
	function onError(err){
		throw err;
	}
	var network = require('ocore/network.js');
	var walletGeneral = require('ocore/wallet_general.js');
	var composer = require('ocore/composer.js');
	createSplitOutputs(function(arrOutputs){
		console.log(arrOutputs);
	//	return unlock();
		composer.composeAndSavePaymentJoint([my_address], arrOutputs, headlessWallet.signer, {
			ifNotEnoughFunds: onError,
			ifError: onError,
			ifOk: function(objJoint){
				network.broadcastJoint(objJoint);
			}
		});
	});
}


function createSplitOutputs(handleOutputs){
	db.query("SELECT amount FROM outputs WHERE address=? AND asset IS NULL AND is_spent=0 ORDER BY amount DESC LIMIT 1", [my_address], function(rows){
		if (rows.length !== 1)
			throw Error("not 1 output");
		var amount = rows[0].amount;
		var chunk_amount = Math.round(amount/COUNT_CHUNKS);
		var arrOutputs = [{amount: 0, address: my_address}];
		for (var i=1; i<COUNT_CHUNKS; i++) // 99 iterations
			arrOutputs.push({amount: chunk_amount, address: my_address});
		handleOutputs(arrOutputs);
	});
}


eventBus.on('headless_wallet_ready', function(){
	headlessWallet.readSingleAddress(function(address){
		my_address = address;
		console.log('===== my address '+my_address);
		work();
	});
});


