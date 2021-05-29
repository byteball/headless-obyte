"use strict";
const headlessWallet = require('../start.js');
const eventBus = require('ocore/event_bus.js');
const arbiter_contract = require('ocore/arbiter_contract.js');
const device = require('ocore/device.js');
const validationUtils = require('ocore/validation_utils');

function onReady() {
	let contract_text = "Bill pays Tom $20, if Tom sends Bill a pair of his Air Jordans.";
	let contract_title = "Air Jordans Purchase from Tom";
	let amount = 10000; // in bytes, min 10000
	let asset = null;
	let ttl = 24; //hours
	let arbiter_address = "VYDZPZABPIYNNHCPQKTMIKAEBHWEW3SQ";
	let my_contacts = `Email me at: bill@example.com`;
	let me_is_payer = true;

	let my_address;
	let my_pairing_code;
	headlessWallet.readFirstAddress(address => {
		my_address = address;
	});

	eventBus.on('paired', from_address => {
		device.sendMessageToDevice(from_address, 'text', `My address: ${my_address}, now send me your's.`);
	});

	/* ================ OFFER ================ */
	eventBus.on('text', (from_address, text) => {
		text = text.trim();
		if (!validationUtils.isValidAddress(text))
			return device.sendMessageToDevice(from_address, 'text', `does not look like an address`);
		let contract = {
			title: contract_title,
			text: contract_text,
			arbiter_address: arbiter_address,
			amount: amount,
			asset: asset,
			peer_address: text,
			my_address: my_address,
			me_is_payer: me_is_payer,
			peer_device_address: from_address,
			ttl: ttl,
			cosigners: [],
			my_pairing_code: my_pairing_code,
			my_contact_info: my_contacts
		};

		arbiter_contract.createAndSend(contract, contract => {
			console.log('contract offer sent', contract);
		});
	});

	/* ================ OFFER ACCEPTED ================ */
	eventBus.on("arbiter_contract_response_received", contract => {
		if (contract.status != 'accepted') {
			console.warn('contract declined');
			return;
		}
		arbiter_contract.createSharedAddressAndPostUnit(contract.hash, headlessWallet, (err, contract) => {
			if (err)
				throw err;
			console.log('Unit with contract hash was posted into DAG\nhttps://explorer.obyte.org/#' + contract.unit);

	/* ================ PAY TO THE CONTRACT ================ */
			arbiter_contract.pay(contract.hash, headlessWallet, [],	(err, contract, unit) => {
				if (err)
					throw err;
				console.log('Unit with contract payment was posted into DAG\nhttps://explorer.obyte.org/#' + unit);

				setTimeout(() => {completeContract(contract)}, 3 * 1000); // complete the contract in 3 seconds
			});
		});
	});

	/* ================ CONTRACT FULFILLED - UNLOCK FUNDS ================ */
	function completeContract(contract) {
		arbiter_contract.complete(contract.hash, headlessWallet, [], (err, contract, unit) => {
			if (err)
				throw err;
			console.log(`Contract completed. Funds locked on contract with hash ${contract.hash} were sent to peer, unit: https://explorer.obyte.org/#${unit}`);
		});
	}

	/* ================ CONTRACT EVENT HANDLERS ================ */
	eventBus.on("arbiter_contract_update", (contract, field, value, unit) => {
		if (field === "status" && value === "paid") {
			// do something usefull here
			console.log(`Contract was paid, unit: https://explorer.obyte.org/#${unit}`);
		}
	});
};
eventBus.once('headless_wallet_ready', onReady);