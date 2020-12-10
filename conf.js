/*jslint node: true */
"use strict";

//exports.port = 6611;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = false;
exports.bSingleAddress = false;
exports.bStaticChangeAddress = false;

exports.storage = 'sqlite';


exports.hub = process.env.testnet ? 'obyte.org/bb-test' : (process.env.devnet ? 'localhost:6611' : 'obyte.org/bb');
exports.deviceName = 'Headless';
exports.permanent_pairing_secret = ''; // use '*' to allow any or generate random string
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';
exports.KEYS_FILENAME = 'keys.json';

// where logs are written to (absolute path).  Default is log.txt in app data directory
//exports.LOG_FILENAME = '/dev/null';
// set true to append logs to logfile instead of overwriting it. Default is to overwrite
// exports.appendLogfile = true;

// set to true to disable passphrase request, default is false. Disabling the passphrase would weaken the security of your node as an attacker would need to steal only your seed which is stored in <data dir>/keys.json. Passphrase encrypts the keys, and keys.json alone would be useless for the attacker (if the passphrase is good). However, disabling the passphrase can make sense if you run a low-stakes wallet and absolutely need to start your node non-interactively.
//exports.bNoPassphrase = true;

// consolidate unspent outputs when there are too many of them.  Value of 0 means do not try to consolidate
exports.MAX_UNSPENT_OUTPUTS = 0;
exports.CONSOLIDATION_INTERVAL = 3600*1000;

// this is for runnining RPC service only, see tools/rpc_service.js
exports.rpcInterface = '127.0.0.1';
exports.rpcPort = '6332';

console.log('finished headless conf');
