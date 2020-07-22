/*jslint node: true */
"use strict";
const headlessWallet = require('../start.js');
const eventBus = require('ocore/event_bus.js');

// this is an example for posting data to Autonomous Agent below, click definition to see it's code, testnet can be turned on with .env file
// https://explorer.obyte.org/#24WUKC3BDXCDUNKEZE52IT77S66OFW3L
// https://testnetexplorer.obyte.org/#24WUKC3BDXCDUNKEZE52IT77S66OFW3L

function sendDataToAA(){
	// lets get first address of the wallet, but this can be hard-coded too
	headlessWallet.readFirstAddress((first_address) => {
		let payload = {};
		// different ways how this specific AA accepts data, enable all or disable all to see different results

		//payload.d = {xx: 66.3,sub: 22.1}; // this results the same as below because the AA definition
		payload.sub = 22.1;

		//payload.output = {address: first_address}; // this results the same as below because the AA definition
		payload.payment = {
			asset: "base", // base asset is bytes
			outputs: [
				{address: first_address}, // if output has only address and no amount, all from this asset is sent
			]
		};

		let opts = {
			paying_addresses: [first_address], // first address pays the fees
			change_address: first_address, // and first address gets back the change
			messages: [
				{app: "data", payload},
			],
			to_address: "24WUKC3BDXCDUNKEZE52IT77S66OFW3L", // AA address
			amount: 10000 // minimal fee for AA
		};
		// this is a multi-purpose sending function, which can send payments and data
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

// we wait for the wallet to get ready and then execute this function
eventBus.on('headless_wallet_ready', sendDataToAA);
