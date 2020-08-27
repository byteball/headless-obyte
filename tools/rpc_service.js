/*jslint node: true */

/*
	Accept commands via JSON-RPC API.
	The daemon listens on port 6332 by default.
	See https://developer.obyte.org/json-rpc/running-rpc-service for detailed description of the API
*/

"use strict";
var fs = require('fs');
var desktopApp = require('ocore/desktop_app.js');
var appDataDir = desktopApp.getAppDataDir();
var path = require('path');

if (require.main === module && !fs.existsSync(appDataDir) && fs.existsSync(path.dirname(appDataDir)+'/headless-byteball')){
	console.log('=== will rename old data dir');
	fs.renameSync(path.dirname(appDataDir)+'/headless-byteball', appDataDir);
}
var conf = require('ocore/conf.js');
if (conf.bSingleAddress)
	throw Error('can`t run in single address mode');

if (!conf.rpcInterface || !conf.rpcPort)
	throw new Error('conf.rpcInterface and conf.rpcPort must be configured.');

var headlessWallet = require('../start.js');
var eventBus = require('ocore/event_bus.js');
var db = require('ocore/db.js');
var mutex = require('ocore/mutex.js');
var storage = require('ocore/storage.js');
var constants = require('ocore/constants.js');
var validationUtils = require("ocore/validation_utils.js");
var wallet_id;

function initRPC() {
	var network = require('ocore/network.js');

	var rpc = require('json-rpc2');
	var walletDefinedByKeys = require('ocore/wallet_defined_by_keys.js');
	var Wallet = require('ocore/wallet.js');
	var balances = require('ocore/balances.js');

	var server = rpc.Server.$create({
		'websocket': true, // is true by default 
		'headers': { // allow custom headers is empty by default 
			'Access-Control-Allow-Origin': '*'
		}
	});

	/**
	 * Returns information about the current state.
	 * @return {connections:{number}, last_mci:{number}, last_stable_mci:{number}, count_unhandled:{number}}
	 */
	server.expose('getinfo', function(args, opt, cb) {
		var connections = network.getConnectionStatus();
		var response = {connections: connections.incoming+connections.outgoing};
		storage.readLastMainChainIndex(function(last_mci){
			response.last_mci = last_mci;
			storage.readLastStableMcIndex(db, function(last_stable_mci){
				response.last_stable_mci = last_stable_mci;
				db.query("SELECT COUNT(*) AS count_unhandled FROM unhandled_joints", function(rows){
					response.count_unhandled = rows[0].count_unhandled;
					cb(null, response);
				});
			});
		});
	});

	/**
	 * Returns the number of connections to other nodes.
	 * @return {number} result
	 */
	server.expose('getconnectioncount', function(args, opt, cb) {
		var connections = network.getConnectionStatus();
		cb(null, connections.incoming+connections.outgoing);
	});

	/**
	 * Returns information about the node's connection to the network.
	 * @return {object} result
	 */
	server.expose('getnetworkinfo', function(args, opt, cb) {
		var connections = network.getConnectionStatus();
		cb(null, {
			"version": constants.minCoreVersion,
			"subversion": conf.program +' '+ conf.program_version,
			"protocolversion": constants.version,
			"alt": constants.alt,
			"connections": connections.incoming+connections.outgoing,
			"bLight": conf.bLight,
			"socksConfigured": !(!conf.socksHost || !conf.socksPort),
			"COUNT_WITNESSES": constants.COUNT_WITNESSES,
			"MAJORITY_OF_WITNESSES": constants.MAJORITY_OF_WITNESSES,
			"GENESIS_UNIT": constants.GENESIS_UNIT,
			"BLACKBYTES_ASSET": constants.BLACKBYTES_ASSET,
		});
	});

	/**
	 * Validates address.
	 * @param {string} address
	 * @return {boolean} is_valid
	 *
	 * Accepts params as Object too
	 * @param {address:{string}} args as Object
	 * @return {boolean} is_valid
	 */
	server.expose('validateaddress', validateaddres);
	// alias for validateaddress
	server.expose('verifyaddress', validateaddres);

	function validateaddres(args, opt, cb) {
		var address = Array.isArray(args) ? args[0] : args.address;
		cb(null, validationUtils.isValidAddress(address));
	}

	/**
	 * Creates and returns new wallet address.
	 * @return {string} address
	 */
	server.expose('getnewaddress', function(args, opt, cb) {
		mutex.lock(['rpc_getnewaddress'], function(unlock){
			walletDefinedByKeys.issueNextAddress(wallet_id, 0, function(addressInfo) {
				unlock();
				cb(null, addressInfo.address);
			});
		});
	});

	/**
	 * Returns the list of addresses for the whole wallet.
	 * @param {string} [type] - optional, must be: "deposit", "change", "shared", "textcoin", null - shows both deposit and change by default
	 * @param {number|string|boolean} [reverse] - optional, true by default
	 * @param {number|string} [limit] - optional, 100 by default
	 * @return [{address:{string}, address_index:{string}, is_change:{number}, is_used:{number}, creation_ts:{string}}] list of addresses
	 * 
	 * Accepts params as Object too
	 * @param {type?: {string}, reverse?: {number|string|boolean}, limit?: {number|string}} [args] as Object - all are optional
	 * @return [{address:{string}, address_index:{string}, is_change:{number}, is_used:{number}, creation_ts:{string}}] list of addresses
	 */
	server.expose('getaddresses', function(args, opt, cb) {
		var {type, reverse, limit} = args;
		if (Array.isArray(args))
			[type, reverse, limit] = args;

		limit = parseInt(limit) || 100;
		reverse = (reverse == null) || String(reverse).toLowerCase() === "true";
		var sql;
		switch (type) {
			case 'textcoin':
				sql = "SELECT address, NULL AS address_index, NULL AS is_change, (CASE WHEN unit_authors.unit IS NULL THEN 0 ELSE 1 END) AS is_used, "+db.getUnixTimestamp("creation_date")+" AS creation_ts FROM sent_mnemonics LEFT JOIN unit_authors USING(address) GROUP BY address";
				break;
			case 'shared':
				sql = "SELECT shared_address AS address, NULL AS address_index, NULL AS is_change, (CASE WHEN unit_authors.unit IS NULL THEN 0 ELSE 1 END) AS is_used, "+db.getUnixTimestamp("creation_date")+" AS creation_ts FROM shared_addresses LEFT JOIN unit_authors ON shared_address = address GROUP BY shared_address";
				break;
			default:
				sql = "SELECT address, address_index, is_change, (CASE WHEN unit_authors.unit IS NULL THEN 0 ELSE 1 END) AS is_used, "+db.getUnixTimestamp("creation_date")+" AS creation_ts FROM my_addresses LEFT JOIN unit_authors USING(address)";
				if (type === 'deposit' || type === 'change')
					sql += " WHERE is_change="+ (type === 'change' ? "1" : "0");
				sql += " GROUP BY address";
				break;
		}
		sql += " ORDER BY creation_ts "+ (reverse ? "DESC" : "") +" LIMIT "+ limit;
		db.query(sql, [], function(listOfAddresses) {
			cb(null, listOfAddresses);
		});
	});

	/**
	 * Returns address balance(stable and pending).
	 * If address is invalid, then returns "invalid address".
	 * If your wallet doesn`t own the address, then returns "address not found".
	 * If no address supplied, returns wallet balance(stable and pending).
	 * @param {string} [address] - optional
	 * @param {string} [asset] - optional
	 * @return {"base":{"stable":{number},"pending":{number}}} balance
	 *
	 * Accepts params as Object too
	 * @param {address?: {string}, asset?: {string}} [args] as Object - all are optional
	 * @return {"base":{"stable":{number},"pending":{number}}} balance
	 */
	server.expose('getbalance', function(args, opt, cb) {
		let start_time = Date.now();
		var {address, asset} = args;
		if (Array.isArray(args))
			[address, asset] = args;
		if (address) {
			if (!validationUtils.isValidAddress(address))
				return cb("invalid address");
			db.query("SELECT address FROM my_addresses WHERE address = ? UNION SELECT shared_address AS address FROM shared_addresses WHERE shared_address = ? UNION SELECT address FROM sent_mnemonics WHERE address = ?;", [address, address, address], function(rows) {
				if (rows.length !== 1)
					return cb("address not found");
				if (asset && asset !== 'base' && !validationUtils.isValidBase64(asset, constants.HASH_LENGTH))
					return cb("bad asset: "+asset);
				db.query(
					"SELECT asset, is_stable, SUM(amount) AS balance \n\
					FROM outputs JOIN units USING(unit) \n\
					WHERE is_spent=0 AND address=? AND sequence='good' AND asset "+((asset && asset !== 'base') ? "="+db.escape(asset) : "IS NULL")+" \n\
					GROUP BY is_stable", [address],
					function(rows) {
						var balance = {};
						balance[asset || 'base'] = {
							stable: 0,
							pending: 0
						};
						for (var i = 0; i < rows.length; i++) {
							var row = rows[i];
							balance[asset || 'base'][row.is_stable ? 'stable' : 'pending'] = row.balance;
						}
						cb(null, balance);
					}
				);
			});
		}
		else
			Wallet.readBalance(wallet_id, function(balances) {
				console.log('getbalance took '+(Date.now()-start_time)+'ms');
				cb(null, balances);
			});
	});

	/**
	 * Returns wallet balance(stable and pending) without commissions earned from headers and witnessing.
	 * 
	 * @return {"base":{"stable":{number},"pending":{number}}} balance
	 */
	server.expose('getmainbalance', function(args, opt, cb) {
		let start_time = Date.now();
		balances.readOutputsBalance(wallet_id, function(balances) {
			console.log('getmainbalance took '+(Date.now()-start_time)+'ms');
			cb(null, balances);
		});
	});

	/**
	 * Returns transaction by unit ID.
	 * @param {string} unit - transaction unit ID
	 * @param {boolean} [verbose] - optional, includes unit definition if "verbose" is second parameter
	 * @param {string} [asset] - optional, asset ID
	 * @return {"action":{'invalid','received','sent','moved'},"amount":{number},"my_address":{string},"arrPayerAddresses":[{string}],"confirmations":{0,1},"unit":{string},"fee":{number},"time":{string},"level":{number},"asset":{string}} one transaction
	 *
	 * Accepts params as Object too
	 * @param {unit: {string}, verbose?: {boolean}, asset?: {string}} [args] as Object - verbose is optional
	 * @return {"action":{'invalid','received','sent','moved'},"amount":{number},"my_address":{string},"arrPayerAddresses":[{string}],"confirmations":{0,1},"unit":{string},"fee":{number},"time":{string},"level":{number},"asset":{string}} one transaction
	 */
	server.expose('gettransaction', function(args, opt, cb) {
		var {unit, verbose, asset} = args;
		if (Array.isArray(args)) {
			if (typeof args[0] === 'string')
				[unit, verbose, asset] = args;
			else
				return cb('unit must be a string');
		}
		listtransactions({unit, since_mci:1, asset}, opt, function(err, results) {
			if (err)
				return cb(err);
			if (!results.length)
				return cb('transaction not found in wallet for ' + (asset || 'base') + ' asset');
			if (!verbose)
				return cb(null, {unit, details:results});
			storage.readJoint(db, unit, {
				ifFound: function(objJoint){
					cb(null, {unit, details:results, decoded:objJoint});
				},
				ifNotFound: function(){
					cb(null, {unit, details:results, decoded:null});
				}
			});
		});
	});

	/**
	 * Returns transaction list.
	 * If address is invalid, then returns "invalid address".
	 * If no address supplied, returns wallet transaction list.
	 * @param {string} [address] - optional
	 * @param {string} [since_mci] - optional, counts only if no address
	 * @param {string} [unit] - optional, counts only if no address
	 * @param {string} [asset] - optional, counts only if no address
	 * @return [{"action":{'invalid','received','sent','moved'},"amount":{number},"my_address":{string},"arrPayerAddresses":[{string}],"confirmations":{0,1},"unit":{string},"fee":{number},"time":{string},"level":{number},"asset":{string}}] transactions
	 *
	 * Accepts params as Object too
	 * @param {address?: {string}, since_mci?: {number}, unit?: {string}, asset?: {string}} [args] as Object - all are optional
	 * @return [{"action":{'invalid','received','sent','moved'},"amount":{number},"my_address":{string},"arrPayerAddresses":[{string}],"confirmations":{0,1},"unit":{string},"fee":{number},"time":{string},"level":{number},"asset":{string}}] transactions
	 */
	server.expose('listtransactions', listtransactions);

	function listtransactions(args, opt, cb) {
		let start_time = Date.now();
		var {address, since_mci, unit, asset} = args;
		if (Array.isArray(args))
			[address, since_mci, unit, asset] = args;
		if (address) {
			if (!validationUtils.isValidAddress(address))
				return cb("invalid address");
			Wallet.readTransactionHistory({address: address}, function(result) {
				cb(null, result);
			});
		}
		else{
			var opts = {wallet: wallet_id};
			if (unit) {
				if (!validationUtils.isValidBase64(unit, constants.HASH_LENGTH))
					return cb('invalid unit');
				opts.unit = unit;
			}
			if (since_mci) {
				if (!validationUtils.isNonnegativeInteger(since_mci))
					return cb('invalid since_mci');
				opts.since_mci = since_mci;
			}
			else
				opts.limit = 200;
			if (asset){
				if (asset !== 'base' && !validationUtils.isValidBase64(asset, constants.HASH_LENGTH))
					return cb("bad asset: "+asset);
				opts.asset = asset;
			}
			Wallet.readTransactionHistory(opts, function(result) {
				console.log('listtransactions '+JSON.stringify({address, since_mci, unit, asset})+' took '+(Date.now()-start_time)+'ms');
				cb(null, result);
			});
		}

	}

	/**
	 * Send funds to address.
	 * If address is invalid, then returns "invalid address".
	 * @param {string} address - wallet address
	 * @param {number|string} amount - positive integer
	 * @param {string} [asset] - asset ID, optional
	 * @return {string} unit ID
	 *
	 * Accepts params as Object too
	 * @param {address:{string}, amount:{number|string}, asset?:{string}} args as Object - asset is optional
 	 * @return {string} unit ID
	 */
	server.expose('sendtoaddress', function(args, opt, cb) {
		console.log('sendtoaddress '+JSON.stringify(args));
		let start_time = Date.now();
		var {address, amount, asset} = args;
		if (Array.isArray(args)) {
			if (typeof args[0] === 'string')
				[address, amount, asset] = args;
			else
				return cb('address must be a string');
		}
		if (amount != parseInt(amount) || parseInt(amount) < 1)
			return cb('amount must be positive integer');
		amount = parseInt(amount);
		if (asset && asset !== 'base' && !validationUtils.isValidBase64(asset, constants.HASH_LENGTH))
			return cb("bad asset: "+asset);
		if (!amount || !address)
			return cb("required parameters missing");
		if (!validationUtils.isValidAddress(address))
			return cb("invalid address");

		headlessWallet.issueChangeAddressAndSendPayment(asset, amount, address, null, function(err, unit) {
			console.log('sendtoaddress '+JSON.stringify(args)+' took '+(Date.now()-start_time)+'ms, unit='+unit+', err='+err);
			cb(err, err ? undefined : unit);
		});
	});

	/**
	 * Send funds from address to address, keeping change to sending address.
	 * If eiher addresses are invalid, then returns "invalid address" error.
	 * If your wallet doesn`t own the address, then returns "address not found".
	 * Bytes payment can have amount as 'all', other assets must specify exact amount.
	 * @param {string} from_address - wallet address
	 * @param {string} to_address - wallet address
	 * @param {number|string} amount - positive integer or 'all' (for Bytes only)
	 * @param {string} [asset] - asset ID, optional
	 * @return {string} unit ID
	 *
	 * Accepts params as Object too
	 * @param {from_address:{string}, to_address:{string}, amount:{number|string}, asset?:{string}} args as Object - asset is optional
 	 * @return {string} unit ID
	 */
	server.expose('sendfrom', function(args, opt, cb) {
		console.log('sendfrom '+JSON.stringify(args));
		let start_time = Date.now();
		var {from_address, to_address, amount, asset} = args;
		if (Array.isArray(args)) {
			if (typeof args[0] === 'string' && typeof args[1] === 'string')
				[from_address, to_address, amount, asset] = args;
			else
				return cb('from_address and to_address must be strings');
		}
		amount = (String(amount).toLowerCase() === 'all') ? 'all' : amount;
		if (amount !== 'all') {
			if (amount != parseInt(amount) || parseInt(amount) < 1)
				return cb('amount must be positive integer');
			amount = parseInt(amount);
		}
		if (asset && asset !== 'base' && !validationUtils.isValidBase64(asset, constants.HASH_LENGTH))
			return cb("bad asset: "+asset);
		if (!amount || !to_address || !from_address)
			return cb("required parameters missing");
		if (!validationUtils.isValidAddress(to_address) || !validationUtils.isValidAddress(from_address))
			return cb("invalid address");

		db.query("SELECT address FROM my_addresses WHERE address = ? UNION SELECT shared_address AS address FROM shared_addresses WHERE shared_address = ?;", [from_address, from_address], function(rows){
			if (rows.length !== 1)
				return cb("address not found");
			if (amount === 'all') {
				if (asset && asset !== 'base')
					return cb("use exact amount for custom assets");

				headlessWallet.sendAllBytesFromAddress(from_address, to_address, null, function(err, unit) {
					console.log('sendfrom '+JSON.stringify(args)+' took '+(Date.now()-start_time)+'ms, unit='+unit+', err='+err);
					cb(err, err ? undefined : unit);
				});
			}
			else
				headlessWallet.sendAssetFromAddress(asset, amount, from_address, to_address, null, function(err, unit) {
					console.log('sendfrom '+JSON.stringify(args)+' took '+(Date.now()-start_time)+'ms, unit='+unit+', err='+err);
					cb(err, err ? undefined : unit);
				});
		});
	});

	/**
	 * Signs a message with address.
	 * If address is invalid, then returns "invalid address".
	 * If your wallet doesn`t own the address, then returns "address not found".
	 * @param {string} address - wallet that signs the message
	 * @param {string|object} message - message to be signed
	 * @return {string} base64 encoded signature of {version:{string}, signed_message:{string|object}, authors:{object}}
	 *
	 * Accepts params as Object too
	 * @param {address?:{string}, message:{string|object}} args as Object - address is optional
 	 * @return {string} base64 encoded signature
	 */
	server.expose('signmessage', function(args, opt, cb) {
		var {address, message} = args;
		if (Array.isArray(args)) {
			if (typeof args[0] === 'string')
				[address, message] = args;
			else
				return cb('address must be a string');
		}
		if (address && !validationUtils.isValidAddress(address))
			return cb('invalid address');
		if (!message || (typeof message !== 'string' && typeof message !== 'object') || !Object.keys(message).length)
			return cb('message must be string or object');

		headlessWallet.readFirstAddress((first_address) => {
			address = address || first_address;
			db.query("SELECT definition FROM my_addresses WHERE address=?", [address], function(rows){
				if (rows.length !== 1)
					return cb("address not found");
				headlessWallet.signMessage(address, message, function(err, objSignedMessage){
					if (err)
						return cb(err);
					var signedMessageBase64 = Buffer.from(JSON.stringify(objSignedMessage)).toString('base64');
					cb(null, signedMessageBase64);
				});
			});
		});
	});

	/**
	 * Verifies signed message.
	 * @param {string} [address] - wallet that signed the message (optional, first param can be null)
	 * @param {string} signature - base64 encoded signature
	 * @param {string|object} [message] - the message that was signed (optional)
 	 * @return {version:{string}, signed_message:{string|object}, authors:{object}} objSignedMessage
	 *
	 * Accepts params as Object too
	 * @param {address?:{string}, signature:{string}, message?:{string|object}} args as Object - address and message are optinal
 	 * @return {version:{string}, signed_message:{string|object}, authors:{object}} objSignedMessage
	 */
	server.expose('verifymessage', verifymessage);
	// alias for verifymessage
	server.expose('validatemessage', verifymessage);

	function verifymessage(args, opt, cb) {
		var {address, signature, message} = args;
		if (Array.isArray(args)) {
			if (typeof args[1] === 'string')
				[address, signature, message] = args;
			else
				return cb('signature must be a string');
		}
		if (!validationUtils.isValidBase64(signature))
			return cb('signature is not valid base64');
		if (message && (typeof message !== 'string' && typeof message !== 'object' && !Object.keys(message).length))
			return cb('message must be string or object');

		var signedMessageJson = Buffer.from(signature, 'base64').toString('utf8');
		var objSignedMessage = {};
		try {
			objSignedMessage = JSON.parse(signedMessageJson);
		}
		catch(e) {
			return cb(e);
		}
		var signed_message = require('ocore/signed_message.js');
		signed_message.validateSignedMessage(db, objSignedMessage, address, function(err) {
			if (err)
				return cb(err);
			if (message) {
				if (typeof objSignedMessage.signed_message === "string" && objSignedMessage.signed_message !== message)
					return cb("message strings don't match");
				if (typeof objSignedMessage.signed_message === "object" && JSON.stringify(objSignedMessage.signed_message) !== JSON.stringify(message))
					return cb("message objects don't match");
			}
			cb(null, objSignedMessage);
		});
	}

	/**
	 * Claim the textcoin.
	 * If address is invalid, then returns "invalid address".
	 * @param {string} mnemonic - textcoin words
	 * @param {string} [address] - wallet address to receive funds
	 * @return {unit:{string}, asset?:{string}} unit ID and asset (claim again if not null)
	 *
	 * Accepts params as Object too
	 * @param {mnemonic:{string}, address?:{string}} args as Object
 	 * @return {nit:{string}, asset?:{string}} unit ID and asset (claim again if not null)
	 */
	server.expose('claimtextcoin', claimtextcoin);
	// aliases for claimtextcoin
	server.expose('sweeptextcoin', claimtextcoin);
	server.expose('sweeppaperwallet', claimtextcoin);

	function claimtextcoin(args, opt, cb) {
		console.log('claimtextcoin '+JSON.stringify(args));
		let start_time = Date.now();
		var {mnemonic, address} = args;
		if (Array.isArray(args)) {
			if (typeof args[0] === 'string')
				[mnemonic, address] = args;
			else
				return cb('mnemonic must be a string');
		}
		if (!mnemonic)
			return cb("mnemonic is required");
		if (address && !validationUtils.isValidAddress(address))
			return cb('invalid address');

		headlessWallet.readFirstAddress((first_address) => {
			address = address || first_address;
			Wallet.receiveTextCoin(mnemonic, address, function(err, unit, asset) {
				console.log('claimtextcoin '+JSON.stringify(args)+' took '+(Date.now()-start_time)+'ms, unit='+unit+', err='+err);
				cb(err, err ? undefined : {unit, asset});
			});
		});
	}

	headlessWallet.readSingleWallet(function(_wallet_id) {
		wallet_id = _wallet_id;
		// listen creates an HTTP server on localhost only 
		var httpServer = server.listen(conf.rpcPort, conf.rpcInterface);
		httpServer.timeout = 900*1000;
	});
}

eventBus.on('headless_wallet_ready', initRPC);
