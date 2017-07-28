/*jslint node: true */

/*
To be used by exchanges in order to move balance away from deposit addresses
*/

"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('byteballcore/event_bus.js');
var db = require('byteballcore/db.js');
var conf = require('byteballcore/conf.js');

const MAX_FEES = 5000;

var wallet;

function onError(err){
	throw Error(err);
}

function readNextChangeAddress(handleChangeAddress){
	if (conf.bStaticChangeAddress)
		headlessWallet.issueOrSelectStaticChangeAddress(handleChangeAddress);
	else{
		var walletDefinedByKeys = require('byteballcore/wallet_defined_by_keys.js');
		walletDefinedByKeys.issueNextAddress(wallet, 1, function(objAddr){
			handleChangeAddress(objAddr.address);
		});
	}
}

function moveBalance(){
	var composer = require('byteballcore/composer.js');
	var network = require('byteballcore/network.js');
	db.query(
		"SELECT address, SUM(amount) AS amount FROM my_addresses JOIN outputs USING(address) JOIN units USING(unit) \n\
		WHERE wallet=? AND is_change=0 AND is_spent=0 AND asset IS NULL AND sequence='good' AND is_stable=1 \n\
		GROUP BY address \n\
		ORDER BY EXISTS ( \n\
			SELECT * FROM unit_authors JOIN units USING(unit) \n\
			WHERE is_stable=0 AND unit_authors.address=outputs.address AND definition_chash IS NOT NULL \n\
		) \n\
		LIMIT 10", 
		[wallet],
		function(rows){
			let arrPayingAddresses = rows.map(row => row.address);
			let amount = rows.reduce((acc, row) => { return acc+row.amount; }, 0);
			let pay_amount = Math.round(amount/2);
			if (rows.length === 0 || pay_amount <= MAX_FEES){
				console.error('done');
				return setTimeout(() => { process.exit(0); }, 1000);
			}
			console.error('will move '+pay_amount+' bytes from', arrPayingAddresses);
			readNextChangeAddress(function(to_address){
				readNextChangeAddress(function(change_address){
					var arrOutputs = [
						{address: change_address, amount: 0},      // the change
						{address: to_address, amount: pay_amount}  // the receiver
					];
					composer.composeAndSaveMinimalJoint({
						available_paying_addresses: arrPayingAddresses, 
						outputs: arrOutputs, 
						signer: headlessWallet.signer, 
						callbacks: {
							ifNotEnoughFunds: function(err){
								console.error(err+', will retry in 1 min');
								setTimeout(moveBalance, 60*1000);
							},
							ifError: onError,
							ifOk: function(objJoint){
								network.broadcastJoint(objJoint);
								console.error("moved "+pay_amount+" bytes, unit "+objJoint.unit.unit);
								moveBalance();
							}
						}
					});
				});
			});
		}
	);
}

eventBus.on('headless_wallet_ready', function(){
	headlessWallet.readSingleWallet(function(_wallet){
		wallet = _wallet;
		moveBalance();
	});
});
