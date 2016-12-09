/*jslint node: true */
"use strict";
var async = require('async');
var headlessWallet = require('../start.js');
var conf = require('byteballcore/conf.js');
var eventBus = require('byteballcore/event_bus.js');
var db = require('byteballcore/db.js');
var validationUtils = require("byteballcore/validation_utils.js");
var wallet_id;

if (conf.bSingleAddress)
	throw Error('can`t run in single address mode');

function initRPC() {
	var composer = require('byteballcore/composer.js');
	var network = require('byteballcore/network.js');

	var rpc = require('json-rpc2');
	var walletDefinedByKeys = require('byteballcore/wallet_defined_by_keys.js');

	var server = rpc.Server.$create({
		'websocket': true, // is true by default 
		'headers': { // allow custom headers is empty by default 
			'Access-Control-Allow-Origin': '*'
		}
	});

	/**
	 * Creates and returns new wallet address.
	 * @return {String} address
	 */
	server.expose('getnewaddress', function(args, opt, cb) {
		walletDefinedByKeys.issueNextAddress(wallet_id, 0, function(addressInfo) {
			cb(null, addressInfo.address);
		});
	});

	/**
	 * Returns address balance(stable and pending).
	 * If address is invalid, then returns "invalid address".
	 * If your wallet doesn`t own the address, then returns "address not found".
	 * @param {String} address
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 * 
	 * If no address supplied, returns wallet balance(stable and pending).
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 */
	server.expose('getbalance', function(args, opt, cb) {
		var address = args[0];
		if (address) {
			if (validationUtils.isValidAddress(address))
				db.query("SELECT COUNT(*) AS count FROM my_addresses WHERE address = ?", [address], function(rows) {
					if (rows[0].count)
						db.query(
							"SELECT asset, is_stable, SUM(amount) AS balance \n\
							FROM outputs JOIN units USING(unit) \n\
							WHERE is_spent=0 AND address=? AND sequence='good' AND asset IS NULL \n\
							GROUP BY is_stable", [address],
							function(rows) {
								var balance = {
									base: {
										stable: 0,
										pending: 0
									}
								};
								for (var i = 0; i < rows.length; i++) {
									var row = rows[i];
									balance.base[row.is_stable ? 'stable' : 'pending'] = row.balance;
								}
								cb(null, balance);
							}
						);
					else
						cb("address not found");
				});
			else
				cb("invalid address");
		}
		else
			walletDefinedByKeys.readBalance(wallet_id, function(balances) {
				cb(null, balances);
			});
	});

	/**
	 * Returns transaction list.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} address
	 * @return [{"action":{'invalid','received','sent'},"amount":{Integer},"arrPayerAddresses":[{String}],"confirmations":{0,1},"unit":{String},"fee":{Integer},"time":{String},"level":{Integer},"asset":{String}}] transactions
	 * 
	 * If no address suplied, returns wallet transaction list.
	 * @return [{"action":{'invalid','received','sent'},"amount":{Integer},"arrPayerAddresses":[{String}],"confirmations":{0,1},"unit":{String},"fee":{Integer},"time":{String},"level":{Integer},"asset":{String}}] transactions
	 */
	server.expose('listtransactions', function(args, opt, cb) {
		var address = args[0];
		if (address) {
			if (validationUtils.isValidAddress(address))
				walletDefinedByKeys.readTransactionHistory(address, null, function(result) {
					cb(null, result);
				});
			else
				cb("invalid address");
		}
		else
			walletDefinedByKeys.readTransactionHistory(wallet_id, null, function(result) {
				cb(null, result);
			});

	});

	/**
	 * Send funds to address.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} address
	 * @param {Integer} amount
	 * @return {String} status
	 */
	server.expose('sendtoaddress', function(args, opt, cb) {
		// return cb(null, null);
		var amount = args[1];
		var toAddress = args[0];
		if (amount && toAddress) {
			if (validationUtils.isValidAddress(toAddress))
				headlessWallet.issueChangeAddressAndSendPayment(null, amount, toAddress, null, function(err, unit) {
					cb(err, err ? undefined : unit);
				});
			else
				cb("invalid address");
		}
		else
			cb("wrong parameters");
	});

	headlessWallet.readSingleWallet(function(_wallet_id) {
		wallet_id = _wallet_id;
		// listen creates an HTTP server on localhost only 
		server.listen(conf.rpcPort, conf.rpcInterface);
	});
}

eventBus.on('headless_wallet_ready', initRPC);
