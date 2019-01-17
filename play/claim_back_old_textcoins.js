/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('ocore/event_bus.js');


function claimBack(){
	headlessWallet.readFirstAddress(address => {
		var Wallet = require('ocore/wallet.js');
		Wallet.claimBackOldTextcoins(address, 7);
	});
}

eventBus.on('headless_wallet_ready', claimBack);
