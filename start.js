/*jslint node: true */
"use strict";
/**
 * @namespace headless_wallet
 */
var fs = require('fs');
var crypto = require('crypto');
var util = require('util');
var constants = require('ocore/constants.js');
var desktopApp = require('ocore/desktop_app.js');
var appDataDir = desktopApp.getAppDataDir();
var path = require('path');

if (require.main === module && !fs.existsSync(appDataDir) && fs.existsSync(path.dirname(appDataDir)+'/headless-byteball')){
	console.log('=== will rename old data dir');
	fs.renameSync(path.dirname(appDataDir)+'/headless-byteball', appDataDir);
}

var conf = require('ocore/conf.js');
var objectHash = require('ocore/object_hash.js');
var db = require('ocore/db.js');
var eventBus = require('ocore/event_bus.js');
var ecdsaSig = require('ocore/signature.js');
var storage = require('ocore/storage.js');
var Mnemonic = require('bitcore-mnemonic');
var Bitcore = require('bitcore-lib');
var readline = require('readline');

var KEYS_FILENAME = appDataDir + '/' + (conf.KEYS_FILENAME || 'keys.json');
var wallet_id;
var xPrivKey;
var bReady = false;

/**
 * @callback resultCallback
 * @param {string} result
 */
/**
 * @callback paymentResultCallback
 * @param {string} error
 * @param {string} unit
 * @param {string} assocMnemonics
 */

/**
 * @typedef {Object} PaymentResult
 * @property {string} unit
 * @property {string} assocMnemonics
 */

/**
 * Returns whether the wallet is ready
 * @memberOf headless_wallet
 * @return {boolean} is ready
 *
 * @example
 * if (isReady()) {
 *
 * }
 */
function isReady() {
	return bReady;
}

/**
 * Waits for the wallet to be ready
 * @async
 * @memberOf headless_wallet
 * @example
 * await waitTillReady();
 */
function waitTillReady() {
	if (bReady)
		return;
	return new Promise(resolve => eventBus.once('headless_wallet_ready', resolve));
}

function replaceConsoleLog(){
	if (conf.logToSTDOUT) {
 		return;
 	}
	var log_filename = conf.LOG_FILENAME || (appDataDir + '/log.txt');
	var writeStream = fs.createWriteStream(log_filename, { flags: conf.appendLogfile ? 'a' : 'w' });
	console.log('---------------');
	console.log('From this point, output will be redirected to '+log_filename);
	console.log(conf.bNoPassphrase ? "Press Enter to release the terminal if you started the daemon with &. Otherwise, type Ctrl-Z, then 'bg'." : "To release the terminal, type Ctrl-Z, then 'bg'");
	console.log = function(){
		writeStream.write(new Date().toISOString()+': ');
		writeStream.write(util.format.apply(null, arguments) + '\n');
	};
	console.warn = console.log;
	console.info = console.log;
}

function requestInput(prompt, cb) {
	if (conf.bNoPassphrase)
		return cb("");
	var rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		//terminal: true
	});
	rl.question(prompt, function (input) {
		rl.close();
		cb(input);
	});
}

function readKeys(onDone){
	console.log('-----------------------');
	if (conf.control_addresses)
		console.log("remote access allowed from devices: "+conf.control_addresses.join(', '));
	if (conf.payout_address)
		console.log("payouts allowed to address: "+conf.payout_address);
	console.log('-----------------------');
	if (process.env.mnemonic && conf.bNoPassphrase) {
		var deviceTempPrivKey = crypto.randomBytes(32);
		var devicePrevTempPrivKey = crypto.randomBytes(32);
		return onDone(process.env.mnemonic, '', deviceTempPrivKey, devicePrevTempPrivKey);
	}
	fs.readFile(KEYS_FILENAME, 'utf8', function(err, data){
		if (err){ // first start
			console.log('failed to read keys, will gen');
			initConfJson(function(){
				eventBus.emit('headless_wallet_need_pass')
				requestInput('Passphrase for your private keys: ', function(passphrase){
					if (process.stdout.moveCursor) process.stdout.moveCursor(0, -1);
					if (process.stdout.clearLine)  process.stdout.clearLine();
					var deviceTempPrivKey = crypto.randomBytes(32);
					var devicePrevTempPrivKey = crypto.randomBytes(32);

					var mnemonic = new Mnemonic(); // generates new mnemonic
					while (!Mnemonic.isValid(mnemonic.toString()))
						mnemonic = new Mnemonic();

					writeKeys(mnemonic.phrase, deviceTempPrivKey, devicePrevTempPrivKey, function(){
						console.log('keys created');
						var xPrivKey = mnemonic.toHDPrivateKey(passphrase);
						createWallet(xPrivKey, function(){
							onDone(mnemonic.phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
						});
					});
				});
			});
		}
		else{ // 2nd or later start
			eventBus.emit('headless_wallet_need_pass')
			requestInput("Passphrase: ", function(passphrase){
				if (process.stdout.moveCursor) process.stdout.moveCursor(0, -1);
				if (process.stdout.clearLine)  process.stdout.clearLine();
				var keys = JSON.parse(data);
				var deviceTempPrivKey = Buffer.from(keys.temp_priv_key, 'base64');
				var devicePrevTempPrivKey = Buffer.from(keys.prev_temp_priv_key, 'base64');
				determineIfWalletExists(function(bWalletExists){
					if (bWalletExists)
						onDone(keys.mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
					else{
						var mnemonic = new Mnemonic(keys.mnemonic_phrase);
						var xPrivKey = mnemonic.toHDPrivateKey(passphrase);
						createWallet(xPrivKey, function(){
							onDone(keys.mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
						});
					}
				});
			});
		}
	});
}

function initConfJson(onDone){
	var userConfFile = appDataDir + '/conf.json';
	var confJson = null;
	try {
		confJson = require(userConfFile);
	}
	catch(e){
	}
	if (conf.deviceName && conf.deviceName !== 'Headless') // already set in conf.js or conf.json
		return confJson ? onDone() : writeJson(userConfFile, {}, onDone);
	// continue if device name not set
	if (!confJson)
		confJson = {};
	var suggestedDeviceName = require('os').hostname() || 'Headless';
	requestInput("Please name this device ["+suggestedDeviceName+"]: ", function(deviceName){
		if (!deviceName)
			deviceName = suggestedDeviceName;
		confJson.deviceName = deviceName;
		writeJson(userConfFile, confJson, function(){
			console.log('Device name saved to '+userConfFile+', you can edit it later if you like.\n');
			onDone();
		});
	});
}

function writeJson(filename, json, onDone){
	fs.writeFile(filename, JSON.stringify(json, null, '\t'), 'utf8', function(err){
		if (err)
			throw Error('failed to write conf.json: '+err);
		onDone();
	});
}

function writeKeys(mnemonic_phrase, deviceTempPrivKey, devicePrevTempPrivKey, onDone){
	var keys = {
		mnemonic_phrase: mnemonic_phrase,
		temp_priv_key: deviceTempPrivKey.toString('base64'),
		prev_temp_priv_key: devicePrevTempPrivKey.toString('base64')
	};
	fs.writeFile(KEYS_FILENAME, JSON.stringify(keys, null, '\t'), 'utf8', function(err){
		if (err)
			throw Error("failed to write keys file");
		if (onDone)
			onDone();
	});
}

function createWallet(xPrivKey, onDone){
	var devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({size:32});
	var device = require('ocore/device.js');
	device.setDevicePrivateKey(devicePrivKey); // we need device address before creating a wallet
	var strXPubKey = Bitcore.HDPublicKey(xPrivKey.derive("m/44'/0'/0'")).toString();
	var walletDefinedByKeys = require('ocore/wallet_defined_by_keys.js');
	// we pass isSingleAddress=false because this flag is meant to be forwarded to cosigners and headless wallet doesn't support multidevice
	walletDefinedByKeys.createWalletByDevices(strXPubKey, 0, 1, [], 'any walletName', false, function(wallet_id){
		walletDefinedByKeys.issueNextAddress(wallet_id, 0, function(addressInfo){
			onDone();
		});
	});
}


/**
 * Check that the device address is in the array of controlled addresses
 * @memberOf headless_wallet
 * @param device_address
 * @return {boolean}
 * @example
 * if (isControlAddress('0CUUZZ2UYM4ATP4HULSRH646B5V4G3JRW')) {
 *
 * }
 */
function isControlAddress(device_address){
	return (conf.control_addresses && conf.control_addresses.indexOf(device_address) >= 0);
}

/**
 * Returns the address of the single-address wallet, throws if the wallet is not single-address
 * @memberOf headless_wallet
 * @param {resultCallback=} handleAddress
 * @return {Promise<string>}
 * @example
 * const address = await readSingleAddress();
 */
function readSingleAddress(handleAddress){
	if (!handleAddress)
		return new Promise(resolve => readSingleAddress(resolve));
	db.query("SELECT address FROM my_addresses WHERE wallet=?", [wallet_id], function(rows){
		if (rows.length === 0)
			throw Error("no addresses");
		if (rows.length > 1)
			throw Error("more than 1 address");
		handleAddress(rows[0].address);
	});
}

/**
 * Returns the first address of the wallet
 * @memberOf headless_wallet
 * @param {resultCallback=} handleAddress
 * @return {Promise<string>}
 * @example
 * const address = await readFirstAddress();
 */
function readFirstAddress(handleAddress){
	if (!handleAddress)
		return new Promise(resolve => readFirstAddress(resolve));
	db.query("SELECT address FROM my_addresses WHERE wallet=? AND address_index=0 AND is_change=0", [wallet_id], function(rows){
		if (rows.length === 0)
			throw Error("no addresses");
		if (rows.length > 1)
			throw Error("more than 1 address");
		handleAddress(rows[0].address);
	});
}

function prepareBalanceText(handleBalanceText){
	var Wallet = require('ocore/wallet.js');
	Wallet.readBalance(wallet_id, function(assocBalances){
		var arrLines = [];
		for (var asset in assocBalances){
			var total = assocBalances[asset].stable + assocBalances[asset].pending;
			var units = (asset === 'base') ? ' bytes' : (' of ' + asset);
			var line = "* "+ total + units;
			if (assocBalances[asset].pending)
				line += ' (' + assocBalances[asset].pending + ' pending)';
			else if (asset === 'base')
				line += ' (including earned commissions)';
			arrLines.push(line);
		}
		handleBalanceText(arrLines.join("\n"));
	});
}

/**
 * Returns the wallet ID. There should be only one wallet, throws otherwise.
 * @memberOf headless_wallet
 * @param {resultCallback=} handleWallet
 * @return {Promise<string>}
 * @example
 * const wallet = await readSingleWallet();
 */
function readSingleWallet(handleWallet){
	if (!handleWallet)
		return new Promise(resolve => readSingleWallet(resolve));
	db.query("SELECT wallet FROM wallets", function(rows){
		if (rows.length === 0)
			throw Error("no wallets");
		if (rows.length > 1)
			throw Error("more than 1 wallet");
		handleWallet(rows[0].wallet);
	});
}

function determineIfWalletExists(handleResult){
	db.query("SELECT wallet FROM wallets", function(rows){
		if (rows.length > 1)
			throw Error("more than 1 wallet");
		handleResult(rows.length > 0);
	});
}

/**
 * @callback signWithLocalPrivateKeyCB
 * @param {string} result
 */
/**
 * Signs a transaction/message using the local private key
 * @memberOf headless_wallet
 * @param {string} wallet_id
 * @param {number} account
 * @param {number} is_change
 * @param {number} address_index
 * @param {string} text_to_sign
 * @param {signWithLocalPrivateKeyCB=} handleSig
 * @return {Promise<string>}
 * @example
 * const walletId = '+lCx+8UGlbwdXC8ZlnQeuQZ2cKI5fyaWyxzGFXUEnbA=';
 * const sign = await signWithLocalPrivateKey(walletId, 0, 0, 0, 'hello');
 */
function signWithLocalPrivateKey(wallet_id, account, is_change, address_index, text_to_sign, handleSig){
	if (!handleSig)
		return new Promise(resolve => signWithLocalPrivateKey(wallet_id, account, is_change, address_index, text_to_sign, resolve));
	var path = "m/44'/0'/" + account + "'/"+is_change+"/"+address_index;
	var privateKey = xPrivKey.derive(path).privateKey;
	var privKeyBuf = privateKey.bn.toBuffer({size:32}); // https://github.com/bitpay/bitcore-lib/issues/47
	handleSig(ecdsaSig.sign(text_to_sign, privKeyBuf));
}

var signer = {
	readSigningPaths: function(conn, address, handleLengthsBySigningPaths){
		if (!handleLengthsBySigningPaths)
			return new Promise(resolve => signer.readSigningPaths(conn, address, resolve));
		handleLengthsBySigningPaths({r: constants.SIG_LENGTH});
	},
	readDefinition: function(conn, address, handleDefinition){
		if (!handleDefinition)
			return new Promise(resolve => signer.readDefinition(conn, address, (err, arrDefinition) => resolve(arrDefinition)));
		conn.query("SELECT definition FROM my_addresses WHERE address=?", [address], function(rows){
			if (rows.length !== 1)
				throw Error("definition not found");
			handleDefinition(null, JSON.parse(rows[0].definition));
		});
	},
	sign: function(objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature){
		if (!handleSignature)
			return new Promise(resolve => signer.sign(objUnsignedUnit, assocPrivatePayloads, address, signing_path, (err, sig) => resolve(sig)));
		var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
		db.query(
			"SELECT wallet, account, is_change, address_index \n\
			FROM my_addresses JOIN wallets USING(wallet) JOIN wallet_signing_paths USING(wallet) \n\
			WHERE address=? AND signing_path=?",
			[address, signing_path],
			function(rows){
				if (rows.length !== 1)
					throw Error(rows.length+" indexes for address "+address+" and signing path "+signing_path);
				var row = rows[0];
				signWithLocalPrivateKey(row.wallet, row.account, row.is_change, row.address_index, buf_to_sign, function(sig){
					handleSignature(null, sig);
				});
			}
		);
	}
};


if (conf.permanent_pairing_secret)
	db.query(
		"INSERT "+db.getIgnore()+" INTO pairing_secrets (pairing_secret, is_permanent, expiry_date) VALUES (?, 1, '2038-01-01')",
		[conf.permanent_pairing_secret]
	);

setTimeout(function(){
	readKeys(function(mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey){
		var saveTempKeys = function(new_temp_key, new_prev_temp_key, onDone){
			writeKeys(mnemonic_phrase, new_temp_key, new_prev_temp_key, onDone);
		};
		var mnemonic = new Mnemonic(mnemonic_phrase);
		// global
		xPrivKey = mnemonic.toHDPrivateKey(passphrase);
		var devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({size:32});
		// read the id of the only wallet
		readSingleWallet(function(wallet){
			// global
			wallet_id = wallet;
			require('ocore/wallet.js'); // we don't need any of its functions but it listens for hub/* messages
			var device = require('ocore/device.js');
			device.setDevicePrivateKey(devicePrivKey);
			let my_device_address = device.getMyDeviceAddress();
			db.query("SELECT 1 FROM extended_pubkeys WHERE device_address=?", [my_device_address], function(rows){
				if (rows.length > 1)
					throw Error("more than 1 extended_pubkey?");
				if (rows.length === 0)
					return setTimeout(function(){
						console.log('passphrase is incorrect');
						process.exit(0);
					}, 1000);
				device.setTempKeys(deviceTempPrivKey, devicePrevTempPrivKey, saveTempKeys);
				device.setDeviceName(conf.deviceName);
				device.setDeviceHub(conf.hub);
				let my_device_pubkey = device.getMyDevicePubKey();
				console.log("====== my device address: "+my_device_address);
				console.log("====== my device pubkey: "+my_device_pubkey);
				if (conf.bSingleAddress)
					readSingleAddress(function(address){
						console.log("====== my single address: "+address);
					});
				else
					readFirstAddress(function(address){
						console.log("====== my first address: "+address);
					});

				if (conf.permanent_pairing_secret)
					console.log("====== my pairing code: "+my_device_pubkey+"@"+conf.hub+"#"+conf.permanent_pairing_secret);
				if (conf.bLight){
					var light_wallet = require('ocore/light_wallet.js');
					light_wallet.setLightVendorHost(conf.hub);
				}
				bReady = true;
				eventBus.emit('headless_wallet_ready');
				setTimeout(replaceConsoleLog, 1000);
				if (conf.MAX_UNSPENT_OUTPUTS && conf.CONSOLIDATION_INTERVAL){
					var consolidation = require('./consolidation.js');
					consolidation.scheduleConsolidation(wallet_id, signer, conf.MAX_UNSPENT_OUTPUTS, conf.CONSOLIDATION_INTERVAL);
				}
			});
		});
	});
}, 1000);


function handlePairing(from_address){
	var device = require('ocore/device.js');
	prepareBalanceText(function(balance_text){
		device.sendMessageToDevice(from_address, 'text', balance_text);
	});
}

function sendPayment(asset, amount, to_address, change_address, device_address, onDone){
	if(!onDone) {
		return new Promise((resolve, reject) => {
			sendPayment(asset, amount, to_address, change_address, device_address, (err, unit, assocMnemonics) => {
				if (err) return reject(new Error(err));
				return resolve({unit, assocMnemonics});
			});
		});
	}
	var device = require('ocore/device.js');
	var Wallet = require('ocore/wallet.js');
	Wallet.sendPaymentFromWallet(
		asset, wallet_id, to_address, amount, change_address,
		[], device_address,
		signWithLocalPrivateKey,
		function(err, unit, assocMnemonics){
			if (device_address) {
				if (err)
					device.sendMessageToDevice(device_address, 'text', "Failed to pay: " + err);
				//	else
				// if successful, the peer will also receive a payment notification
				//		device.sendMessageToDevice(device_address, 'text', "paid");
			}
			if (onDone)
				onDone(err, unit, assocMnemonics);
		}
	);
}

/**
 * @typedef {Object} smpOpts
 * @property {string} [wallet] If specified, the payment will be from this wallet
 * @property {string} [fee_paying_wallet] Fallback wallet for paying the fees, used if there is not enough bytes on the main paying wallet
 * @property {Array<string>} [paying_addresses] If specified, payment will be sent from these addresses
 * @property {string} change_address Change address
 * @property {number} [amount] Payment amount
 * @property {string} [to_address] Payment address of the receiver
 * @property {Array<Object>} [base_outputs] Array of outputs for payment in bytes
 * @property {string|null} [asset] Payment asset
 * @property {Array<Object>} [asset_outputs] Array of outputs for payment in the specified asset
 * @property {boolean} [send_all] Send all bytes to "to_address"
 * @property {Array<Object>} [messages] Array of messages to send along with the payment
 * @property {string} [spend_unconfirmed=own] What unspent outputs to use for the payment (all - all available, own - sent by us or stable, none - only stable)
 * @property {string} [recipient_device_address] Device address for payment notification or sending the private payloads
 * @property {Array<string>} [recipient_device_addresses] Device addresses for payment notification or sending the private payloads
 * @property {Array<string>} [arrSigningDeviceAddresses] Device addresses which need to sign the transaction
 * @property {Array<string>} [signing_addresses] Payment addresses which need to sign the transaction
 * @property {function} [signWithLocalPrivateKey] A function for signing the transaction with a key stored on the wallet's device
 * @property {boolean} [aa_addresses_checked] Whether the output addresses have already been checked for being Autonomous Agent addresses and the respective bounce fees added where necessary. If false, the job will be performed by the function
 * @property {boolean} [do_not_email] Do not send an email when sending textcoins, the caller will take care of delivery of the produced textcoins
 * @property {string} [email_subject] Subject for the email message sent when sending textcoins
 * @property {function} [getPrivateAssetPayloadSavePath] Function that returns the path to save the file with private payloads when sending a private textcoin
 */
/**
 * Sends payment with specified parameters. See more examples in the [documentation]{@link https://developer.obyte.org}
 * @memberOf headless_wallet
 * @param {smpOpts} opts
 * @param {paymentResultCallback=} onDone
 * @return {Promise<PaymentResult>}
 * @example
 * const opts = {};
 * opts.paying_addresses = ['FCNQIGCW7JIYTARK6M54NMSCPFVIY25E'];
 * opts.change_address = 'FCNQIGCW7JIYTARK6M54NMSCPFVIY25E';
 * opts.amount = 10000;
 * opts.toAddress = '2T35YT6L53OYFEUKIOXBQRKUZD4B3CYW';
 * const {unit, assocMnemonics} = await sendMultiPayment(opts);
 * @example
 * const datafeed = {key: "value"};
 * const objMessage = {
 *    app: "data_feed",
 *    payload_location: "inline",
 *    payload_hash: objectHash.getBase64Hash(datafeed),
 *    payload: datafeed
 * };
 * var opts = {
 *    paying_addresses: [my_address],
 *    change_address: my_address,
 *    messages: [objMessage]
 * };
 *
 * const {unit, assocMnemonics} = await sendMultiPayment(opts);
 * @example
 * const opts = {};
 * opts.paying_addresses = ['FCNQIGCW7JIYTARK6M54NMSCPFVIY25E'];
 * opts.change_address = 'FCNQIGCW7JIYTARK6M54NMSCPFVIY25E';
 * opts.base_outputs = [{address: "2T35YT6L53OYFEUKIOXBQRKUZD4B3CYW", amount: 10000}];
 * const {unit, assocMnemonics} = await sendMultiPayment(opts);
 */
function sendMultiPayment(opts, onDone){
	if(!onDone) {
		return new Promise((resolve, reject) => {
			sendMultiPayment(opts, (err, unit, assocMnemonics) => {
				if (err) return reject(new Error(err));
				return resolve({unit, assocMnemonics});
			});
		});
	}
	var device = require('ocore/device.js');
	var Wallet = require('ocore/wallet.js');
	if (!opts.paying_addresses)
		opts.wallet = wallet_id;
	if (!opts.change_address) {
		return readDefaultChangeAddress(change_address => {
			opts.change_address = change_address;
			sendMultiPayment(opts, onDone);
		});
	}
	opts.arrSigningDeviceAddresses = [device.getMyDeviceAddress()];
	opts.signWithLocalPrivateKey = signWithLocalPrivateKey;
	Wallet.sendMultiPayment(opts, (err, unit, assocMnemonics) => {
		if (onDone)
			onDone(err, unit, assocMnemonics);
	});
}

/**
 * Sends payment using the specified outputs
 * @memberOf headless_wallet
 * @param asset
 * @param outputs
 * @param change_address
 * @param {paymentResultCallback=} onDone
 * @return {Promise<PaymentResult>}
 * @example
 * const address = await issueOrSelectStaticChangeAddress();
 * const outputs = [
 *     {amount: 10000, address: 'FCNQIGCW7JIYTARK6M54NMSCPFVIY25E'},
 *     {amount: 0, address: address}
 * ];
 * const {unit, assocMnemonics} = await sendPaymentUsingOutputs(null, outputs, address);
 */
function sendPaymentUsingOutputs(asset, outputs, change_address, onDone) {
	if(!onDone) {
		return new Promise((resolve, reject) => {
			sendPaymentUsingOutputs(asset, outputs, change_address, (err, unit, assocMnemonics) => {
				if (err) return reject(new Error(err));
				return resolve({unit, assocMnemonics});
			});
		});
	}
	var device = require('ocore/device.js');
	var Wallet = require('ocore/wallet.js');
	var opt = {
		asset: asset,
		wallet: wallet_id,
		change_address: change_address,
		arrSigningDeviceAddresses: [device.getMyDeviceAddress()],
		recipient_device_address: null,
		signWithLocalPrivateKey: signWithLocalPrivateKey
	};
	if(asset === 'base' || asset === null){
		opt.base_outputs = outputs;
	}else{
		opt.asset_outputs = outputs;
	}
	Wallet.sendMultiPayment(opt, (err, unit, assocMnemonics) => {
		if (onDone)
			onDone(err, unit, assocMnemonics);
	});
}

/**
 * Sends all bytes from all addresses
 * @memberOf headless_wallet
 * @param {string} to_address
 * @param {string|null} recipient_device_address
 * @param {paymentResultCallback=} onDone
 * @return {Promise<PaymentResult>}
 * @example
 * const peerAddress = '2T35YT6L53OYFEUKIOXBQRKUZD4B3CYW';
 * const peerDeviceAddress = '0CUUZZ2UYM4ATP4HULSRH646B5V4G3JRW';
 * const {unit, assocMnemonics} = await sendAssetFromAddress(peerAddress, peerDeviceAddress);
 */
function sendAllBytes(to_address, recipient_device_address, onDone) {
	if(!onDone) {
		return new Promise((resolve, reject) => {
			sendAllBytes(to_address, recipient_device_address, (err, unit, assocMnemonics) => {
				if (err) return reject(new Error(err));
				return resolve({unit, assocMnemonics});
			});
		});
	}
	var device = require('ocore/device.js');
	var Wallet = require('ocore/wallet.js');
	Wallet.sendMultiPayment({
		asset: null,
		to_address: to_address,
		send_all: true,
		wallet: wallet_id,
		arrSigningDeviceAddresses: [device.getMyDeviceAddress()],
		recipient_device_address: recipient_device_address,
		signWithLocalPrivateKey: signWithLocalPrivateKey
	}, (err, unit, assocMnemonics) => {
		if (onDone)
			onDone(err, unit, assocMnemonics);
	});
}

/**
 * Sends all bytes from the specified address
 * @memberOf headless_wallet
 * @param {string} from_address
 * @param {string} to_address
 * @param {string|null} recipient_device_address
 * @param {paymentResultCallback=} onDone
 * @return {Promise<PaymentResult>}
 * @example
 * const myAddress = 'FCNQIGCW7JIYTARK6M54NMSCPFVIY25E';
 * const peerAddress = '2T35YT6L53OYFEUKIOXBQRKUZD4B3CYW';
 * const peerDeviceAddress = '0CUUZZ2UYM4ATP4HULSRH646B5V4G3JRW';
 * const {unit, assocMnemonics} = await sendAllBytesFromAddress(myAddress, peerAddress, peerDeviceAddress);
 */
function sendAllBytesFromAddress(from_address, to_address, recipient_device_address, onDone) {
	if(!onDone) {
		return new Promise((resolve, reject) => {
			sendAllBytesFromAddress(from_address, to_address, recipient_device_address, (err, unit, assocMnemonics) => {
				if (err) return reject(new Error(err));
				return resolve({unit, assocMnemonics});
			});
		});
	}
	var device = require('ocore/device.js');
	var Wallet = require('ocore/wallet.js');
	Wallet.sendMultiPayment({
		asset: null,
		to_address: to_address,
		send_all: true,
		paying_addresses: [from_address],
		arrSigningDeviceAddresses: [device.getMyDeviceAddress()],
		recipient_device_address: recipient_device_address,
		signWithLocalPrivateKey: signWithLocalPrivateKey
	}, (err, unit, assocMnemonics) => {
		if(onDone)
			onDone(err, unit, assocMnemonics);
	});
}

/**
 * Sends a payment in the specified asset from the specified address
 * @memberOf headless_wallet
 * @param {string|null} asset
 * @param {number} amount
 * @param {string} from_address
 * @param {string} to_address
 * @param {string|null} recipient_device_address
 * @param {paymentResultCallback=} onDone
 * @return {Promise<PaymentResult>}
 * @example
 * const myAddress = 'FCNQIGCW7JIYTARK6M54NMSCPFVIY25E';
 * const peerAddress = '2T35YT6L53OYFEUKIOXBQRKUZD4B3CYW';
 * const peerDeviceAddress = '0CUUZZ2UYM4ATP4HULSRH646B5V4G3JRW';
 * const {unit, assocMnemonics} = await sendAssetFromAddress(null, 10000, myAddress, peerAddress, peerDeviceAddress);
 */
function sendAssetFromAddress(asset, amount, from_address, to_address, recipient_device_address, onDone) {
	if(!onDone) {
		return new Promise((resolve, reject) => {
			sendAssetFromAddress(asset, amount, from_address, to_address, recipient_device_address, (err, unit, assocMnemonics) => {
				if (err) return reject(new Error(err));
				return resolve({unit, assocMnemonics});
			});
		});
	}
	var device = require('ocore/device.js');
	var Wallet = require('ocore/wallet.js');
	Wallet.sendMultiPayment({
		fee_paying_wallet: wallet_id,
		asset: asset,
		to_address: to_address,
		amount: amount,
		paying_addresses: [from_address],
		change_address: from_address,
		arrSigningDeviceAddresses: [device.getMyDeviceAddress()],
		recipient_device_address: recipient_device_address,
		signWithLocalPrivateKey: signWithLocalPrivateKey
	}, (err, unit, assocMnemonics) => {
		if (onDone)
			onDone(err, unit, assocMnemonics);
	});
}

/**
 * Publish data to DAG
 * @memberOf headless_wallet
 * @param {Object} opts
 * @param {paymentResultCallback=} onDone
 * @return {Promise<string>}
 * @example
 * const opts = {
 *   app: 'text',
 *   payload: 'hello Obyte!'
 * };
 * const unit = await sendData(opts);
 */
function sendData(opts, onDone){
	if (!opts.payload)
		throw Error("no payload");
	if(!onDone) {
		return new Promise((resolve, reject) => {
			sendData(opts, (err, unit) => {
				if (err) return reject(new Error(err));
				return resolve(unit);
			});
		});
	}
	let payment_opts = Object.assign({}, opts);
	delete payment_opts.payload;
	delete payment_opts.app;
	let dataMessage = {
		app: opts.app || 'data',
		payload_location: 'inline',
		payload: opts.payload,
	};
	payment_opts.messages = [dataMessage];
	sendMultiPayment(payment_opts, onDone);
}

/**
 * Issue change address and send payment
 * @memberOf headless_wallet
 * @param {string|null} asset
 * @param {number} amount
 * @param {string} to_address
 * @param {string|null} device_address
 * @param {paymentResultCallback=} onDone
 * @return {Promise<PaymentResult>}
 * @example
 * const address = '2T35YT6L53OYFEUKIOXBQRKUZD4B3CYW';
 * const deviceAddress = '0CUUZZ2UYM4ATP4HULSRH646B5V4G3JRW';
 * const {unit, assocMnemonics} = await issueChangeAddressAndSendPayment(null, 10000, address, deviceAddress);
 */
function issueChangeAddressAndSendPayment(asset, amount, to_address, device_address, onDone){
	if(!onDone) {
		return new Promise((resolve, reject) => {
			issueChangeAddressAndSendPayment(asset, amount, to_address, device_address, (err, unit, assocMnemonics) => {
				if (err) return reject(new Error(err));
				return resolve({unit, assocMnemonics});
			});
		});
	}
	issueChangeAddress(function(change_address){
		sendPayment(asset, amount, to_address, change_address, device_address, onDone);
	});
}

/**
 * Issue change address and send payment with specified parameters
 * @memberOf headless_wallet
 * @param {smpOpts} opts
 * @param {paymentResultCallback=} onDone
 * @return {Promise<PaymentResult>}
 * @example
 * const opts = {};
 * opts.paying_addresses = 'FCNQIGCW7JIYTARK6M54NMSCPFVIY25E';
 * opts.amount = 10000;
 * opts.toAddress = '2T35YT6L53OYFEUKIOXBQRKUZD4B3CYW';
 * const {unit, assocMnemonics} = await issueChangeAddressAndSendMultiPayment(opts);
 */
function issueChangeAddressAndSendMultiPayment(opts, onDone){
	if(!onDone) {
		return new Promise((resolve, reject) => {
			issueChangeAddressAndSendMultiPayment(opts, (err, unit, assocMnemonics) => {
				if (err) return reject(new Error(err));
				return resolve({unit, assocMnemonics});
			});
		});
	}
	issueChangeAddress(function(change_address){
		opts.change_address = change_address;
		sendMultiPayment(opts, onDone);
	});
}

/**
 * Returns the next main address, or reuses an existing address if there is already a long row of unused addresses
 * @memberOf headless_wallet
 * @param {resultCallback=} handleAddress
 * @return {Promise<string>}
 * @example
 * const address = await issueOrSelectNextMainAddress();
 */
function issueOrSelectNextMainAddress(handleAddress){
	if (!handleAddress)
		return new Promise(resolve => issueOrSelectNextMainAddress(resolve));
	var walletDefinedByKeys = require('ocore/wallet_defined_by_keys.js');
	walletDefinedByKeys.issueOrSelectNextAddress(wallet_id, 0, function(objAddr){
		handleAddress(objAddr.address);
	});
}

/**
 * Issue the next main address
 * @memberOf headless_wallet
 * @param {resultCallback=} handleAddress
 * @return {Promise<string>}
 * @example
 * const address = await issueNextMainAddress();
 */
function issueNextMainAddress(handleAddress){
	if (!handleAddress)
		return new Promise(resolve => issueNextMainAddress(resolve));
	var walletDefinedByKeys = require('ocore/wallet_defined_by_keys.js');
	walletDefinedByKeys.issueNextAddress(wallet_id, 0, function(objAddr){
		handleAddress(objAddr.address);
	});
}

/**
 * Returns the wallet's address by is_change flag and index. If the address does not exist, it will be created
 * @memberOf headless_wallet
 * @param is_change {number}
 * @param address_index {number}
 * @param {resultCallback=} handleAddress
 * @return {Promise<string>}
 * @example
 * const address = await issueOrSelectAddressByIndex(0, 0);
 */
function issueOrSelectAddressByIndex(is_change, address_index, handleAddress){
	if (!handleAddress)
		return new Promise(resolve => issueOrSelectAddressByIndex(is_change, address_index, resolve));
	var walletDefinedByKeys = require('ocore/wallet_defined_by_keys.js');
	walletDefinedByKeys.readAddressByIndex(wallet_id, is_change, address_index, function(objAddr){
		if (objAddr)
			return handleAddress(objAddr.address);
		walletDefinedByKeys.issueAddress(wallet_id, is_change, address_index, function(objAddr){
			handleAddress(objAddr.address);
		});
	});
}

/**
 * Returns static change address, which is the same as the first change address. If the address does not exist, it will be created
 * @memberOf headless_wallet
 * @param {resultCallback=} handleAddress
 * @return {Promise<string>}
 * @example
 * const address = await issueOrSelectStaticChangeAddress();
 */
function issueOrSelectStaticChangeAddress(handleAddress){
	if (!handleAddress)
		return new Promise(resolve => issueOrSelectStaticChangeAddress(resolve));
	issueOrSelectAddressByIndex(1, 0, handleAddress);
}

function issueChangeAddress(handleAddress){
	if (!handleAddress)
		return new Promise(resolve => issueChangeAddress(resolve));
	if (conf.bSingleAddress)
		readSingleAddress(handleAddress);
	else if (conf.bStaticChangeAddress)
		issueOrSelectStaticChangeAddress(handleAddress);
	else{
		var walletDefinedByKeys = require('ocore/wallet_defined_by_keys.js');
		walletDefinedByKeys.issueOrSelectNextChangeAddress(wallet_id, function(objAddr){
			handleAddress(objAddr.address);
		});
	}
}

function readDefaultChangeAddress(handleAddress) {
	if (!handleAddress)
		return new Promise(resolve => readDefaultChangeAddress(resolve));
	if (conf.bSingleAddress)
		readSingleAddress(handleAddress);
	else if (conf.bStaticChangeAddress)
		issueOrSelectStaticChangeAddress(handleAddress);
	else
		readFirstAddress(handleAddress);
}

/*
function signMessage(signing_address, message, cb) {
	var device = require('ocore/device.js');
	var Wallet = require('ocore/wallet.js');
	Wallet.signMessage(signing_address, message, [device.getMyDeviceAddress()], signWithLocalPrivateKey, cb);
}
*/

/**
 * @callback signMessageCB
 * @param {string} error
 * @param {Object|undefined} objUnit
 */
/**
 * Signs message
 * @memberOf headless_wallet
 * @param signing_address
 * @param message
 * @param {signMessageCB=} cb
 * @return {Promise<Object>} objUnit
 * @example
 * const objUnit = await signMessage('2T35YT6L53OYFEUKIOXBQRKUZD4B3CYW', 'hello');
 */
function signMessage(signing_address, message, cb) {
	if (!cb)
		return new Promise((resolve, reject) => signMessage(signing_address, message, (err, objUnit) => {
			if (err)
				return reject(new Error(err));
			resolve(objUnit);
		}));
	var signed_message = require('ocore/signed_message.js');
	signed_message.signMessage(message, signing_address, signer, false, cb);
}


function handleText(from_address, text, onUnknown){

	text = text.trim();
	var fields = text.split(/ /);
	var command = fields[0].trim().toLowerCase();
	var params =['',''];
	if (fields.length > 1) params[0] = fields[1].trim();
	if (fields.length > 2) params[1] = fields[2].trim();

	var walletDefinedByKeys = require('ocore/wallet_defined_by_keys.js');
	var device = require('ocore/device.js');
	switch(command){
		case 'address':
			if (conf.bSingleAddress)
				readSingleAddress(function(address){
					device.sendMessageToDevice(from_address, 'text', address);
				});
			else
				walletDefinedByKeys.issueOrSelectNextAddress(wallet_id, 0, function(addressInfo){
					device.sendMessageToDevice(from_address, 'text', addressInfo.address);
				});
			break;

		case 'balance':
			prepareBalanceText(function(balance_text){
				device.sendMessageToDevice(from_address, 'text', balance_text);
			});
			break;

		case 'pay':
			analyzePayParams(params[0], params[1], function(asset, amount){
				if(asset===null && amount===null){
					var msg = "syntax: pay [amount] [asset]";
					msg +=	"\namount: positive integer or 'all'";
					msg +=	"\nasset: optional ('bytes', 'blackbytes', any ASSET_ID)";
					msg +=	"\n";
					msg +=	"\n* Example 1: 'pay 12345' withdraws 12345 bytes";
					msg +=	"\n* Example 2: 'pay 12345 bytes' withdraws 12345 bytes";
					msg +=	"\n* Example 3: 'pay all bytes' withdraws all bytes (including earned commissions)";
					msg +=	"\n* Example 4: 'pay 12345 blackbytes' withdraws 12345 blackbytes";
					msg +=	"\n* Example 5: 'pay 12345 qO2JsiuDMh/j+pqJYZw3u82O71WjCDf0vTNvsnntr8o=' withdraws 12345 blackbytes";
					msg +=	"\n* Example 6: 'pay 12345 ASSET_ID' withdraws 12345 of asset with ASSET_ID";
					return device.sendMessageToDevice(from_address, 'text', msg);
				}

				if (!conf.payout_address)
					return device.sendMessageToDevice(from_address, 'text', "payout address not defined");

				function payout(amount, asset){
					if (!amount)
						return device.sendMessageToDevice(from_address, 'text', 'amount must be positive integer'); 
					if (amount === 'all') {
						if (asset===null)
							return sendAllBytes(conf.payout_address, from_address);
						else
							return device.sendMessageToDevice(from_address, 'text', '[get balance](command:balance) and then use exact amount for custom assets');
					}
					if (conf.bSingleAddress)
						readSingleAddress(function(address){
							sendPayment(asset, amount, conf.payout_address, address, from_address);
						});
					else
						// create a new change address or select first unused one
						issueChangeAddressAndSendPayment(asset, amount, conf.payout_address, from_address);
				};

				if(asset!==null){
					db.query("SELECT unit FROM assets WHERE unit=?", [asset], function(rows){
						if(rows.length===1){
							// asset exists
							payout(amount, asset);
						}else{
							// unknown asset
							device.sendMessageToDevice(from_address, 'text', 'unknown asset: '+asset);
						}
					});
				}else{
					payout(amount, asset);
				}

			});
			break;

		case 'mci':
			storage.readLastMainChainIndex(function(last_mci){
				device.sendMessageToDevice(from_address, 'text', last_mci.toString());
			});
			break;

		case 'space':
			getFileSizes(appDataDir, function(data) {
				var total_space = 0;
				var response = '';
				Object.keys(data).forEach(function(key) {
					total_space += data[key];
					response += key +' '+ niceBytes(data[key]) +"\n";
				});
				response += 'Total: '+ niceBytes(total_space);
				device.sendMessageToDevice(from_address, 'text', response);
			});
			break;

		default:
			if (onUnknown)
				onUnknown(from_address, text);
			else if (require.main === module)
				device.sendMessageToDevice(from_address, 'text', "unrecognized command");
			break;
	}
}

function niceBytes(x){
	// source: https://stackoverflow.com/a/39906526
	const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
	let l = 0, n = parseInt(x, 10) || 0;
	while(n >= 1024 && ++l)
			n = n/1024;

	//include a decimal point and a tenths-place digit if presenting
	//less than ten of KB or greater units
	return(n.toFixed(n < 10 && l > 0 ? 1 : 0) + ' ' + units[l]);
}

function getFileSizes(rootDir, cb) {
	fs.readdir(rootDir, function(err, files) {
		var fileSizes = {};
		for (var index = 0; index < files.length; ++index) {
			var file = files[index];
			if (file[0] !== '.') {
				var filePath = rootDir + '/' + file;
				fs.stat(filePath, function(err, stat) {
					fileSizes[this.file + (stat.isFile() ? '' : '/')] = stat['size'];
					if (files.length === (this.index + 1)) {
						return cb(fileSizes);
					}
				}.bind({index: index, file: file}));
			}
		}
	});
}

function analyzePayParams(amountText, assetText, cb){
	// expected:
	// amountText: positive integer or 'all'
	// assetText: '' -> whitebytes, 'bytes' -> whitebytes, 'blackbytes' -> blackbytes, '{asset-ID}' -> any asset
	if (amountText==='' && assetText==='') return cb(null, null);

	var pattern = /^\d+$/; // checks if positive integer
	amountText = String(amountText).toLowerCase();

	if(!pattern.test(amountText) && amountText !== 'all')
		return cb(null, null);
	if (amountText !== 'all')
		amountText = parseInt(amountText);

	switch(assetText.toLowerCase()){
		case '':
		case 'bytes':
			return cb(null, amountText);
		case 'blackbytes':
			return cb(constants.BLACKBYTES_ASSET, amountText);
		default:
			// return original assetText string because asset ID it is case sensitive
			return cb(assetText, amountText);
	}
}

// The below events can arrive only after we read the keys and connect to the hub.
// The event handlers depend on the global var wallet_id being set, which is set after reading the keys

function setupChatEventHandlers(){
	eventBus.on('paired', function(from_address){
		console.log('paired '+from_address);
		if (!isControlAddress(from_address))
			return console.log('ignoring pairing from non-control address');
		handlePairing(from_address);
	});

	eventBus.on('text', function(from_address, text){
		console.log('text from '+from_address+': '+text);
		if (!isControlAddress(from_address))
			return console.log('ignoring text from non-control address');
		handleText(from_address, text);
	});
}

exports.isReady = isReady;
exports.waitTillReady = waitTillReady;
exports.readSingleWallet = readSingleWallet;
exports.readSingleAddress = readSingleAddress;
exports.readFirstAddress = readFirstAddress;
exports.signer = signer;
exports.isControlAddress = isControlAddress;
exports.issueOrSelectNextMainAddress = issueOrSelectNextMainAddress;
exports.issueNextMainAddress = issueNextMainAddress;
exports.issueOrSelectAddressByIndex = issueOrSelectAddressByIndex;
exports.issueOrSelectStaticChangeAddress = issueOrSelectStaticChangeAddress;
exports.issueChangeAddressAndSendPayment = issueChangeAddressAndSendPayment;
exports.signMessage = signMessage;
exports.signWithLocalPrivateKey = signWithLocalPrivateKey;
exports.setupChatEventHandlers = setupChatEventHandlers;
exports.handlePairing = handlePairing;
exports.handleText = handleText;
exports.sendAllBytesFromAddress = sendAllBytesFromAddress;
exports.sendAssetFromAddress = sendAssetFromAddress;
exports.sendAllBytes = sendAllBytes;
exports.sendPaymentUsingOutputs = sendPaymentUsingOutputs;
exports.sendMultiPayment = sendMultiPayment;
exports.issueChangeAddressAndSendMultiPayment = issueChangeAddressAndSendMultiPayment;
exports.sendData = sendData;

if (require.main === module)
	setupChatEventHandlers();
