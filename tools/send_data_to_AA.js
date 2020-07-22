/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('ocore/event_bus.js');

function sendDataToAA(){
	headlessWallet.readFirstAddress(function(first_address) {
		let payload = {};
		//payload.d = {xx: 66.3,sub: 22.1};
		//payload.sub = 22.1;
		//payload.output = {address: first_address};
		payload.payment = {
			asset: "base",
			outputs: [
				{address: first_address},
			]
		};
		var opts = {
			paying_addresses: [first_address],
			change_address: first_address,
			messages: [
				{app: "data", payload},
			],
			to_address: "24WUKC3BDXCDUNKEZE52IT77S66OFW3L",
			amount: 10000
		};
		headlessWallet.sendMultiPayment(opts, (err, unit) => {
			if (err) {
				console.error(err);
				process.exit();
			}
			console.log('sendDataToAA: '+ unit);
			process.exit();
		});
	});
}

eventBus.on('headless_wallet_ready', sendDataToAA);
