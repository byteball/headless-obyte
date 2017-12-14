/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('byteballcore/event_bus.js');
var mail = require('byteballcore/mail.js');
var conf = require('byteballcore/conf.js');

const asset = null;
const amount = 1000;
const to_address = 'textcoin:pandanation@wwfus.org';
const email_subject = "Textcoin from headless wallet";

let opts = {
	asset: asset, 
	amount: amount, 
	to_address: to_address,
	email_subject: email_subject
};

function pay(){
	headlessWallet.issueChangeAddressAndSendMultiPayment(opts, (err, unit, assocMnemonics) => {
		console.error("=== sent payment, unit="+unit+", err="+err, assocMnemonics);
	});
}

eventBus.on('headless_wallet_ready', pay);

headlessWallet.setupChatEventHandlers();
