/*jslint node: true */
"use strict";
var fs = require('fs');
var headlessWallet = require('../start.js');
var eventBus = require('ocore/event_bus.js');
var constants = require('ocore/constants.js');


// edit these two constants
const AMOUNT = 1000000; // 1 MB
const COUNT_TEXTCOINS = 20;



const MAX_TEXTCOINS_PER_MESSAGE = 100; // but not more than 127

const filename = 'textcoins-' + (new Date().toISOString().replace(/:/g, '-').substr(0, 19)) + 'Z.txt';

let count_textcoins_left = COUNT_TEXTCOINS;

function createList(){
	let count_textcoins_to_send = Math.min(count_textcoins_left, MAX_TEXTCOINS_PER_MESSAGE);
	let base_outputs = [];
	for (let i=0; i<count_textcoins_to_send; i++)
		base_outputs.push({address: 'textcoin:tc'+i, amount: AMOUNT+constants.TEXTCOIN_CLAIM_FEE});
	let opts = {
		base_outputs: base_outputs
	};
	headlessWallet.issueChangeAddressAndSendMultiPayment(opts, (err, unit, assocMnemonics) => {
		if (err){
			console.error(err);
			return setTimeout(createList, 60*1000);
		}
		console.error("sent unit "+unit);
		let arrMnemonics = [];
		for (let address in assocMnemonics)
			arrMnemonics.push(assocMnemonics[address]+"\n");
		let strMnemonics = arrMnemonics.join('');
		fs.appendFile(filename, strMnemonics, err => {
			if (err)
				throw Error("failed to write to file "+filename+": "+err);
			count_textcoins_left -= count_textcoins_to_send;
			if (count_textcoins_to_send !== arrMnemonics.length)
				throw Error("expected to send "+count_textcoins_to_send+" textcoins, sent "+arrMnemonics.length);
			if (count_textcoins_left > 0)
				setTimeout(createList, 1000);
			else
				console.error('done');
		});
	});
}

eventBus.on('headless_wallet_ready', createList);

/*

Stats:
SELECT DATE(units.creation_date) AS date, COUNT(*) 
FROM sent_mnemonics LEFT JOIN unit_authors USING(address) LEFT JOIN units ON unit_authors.unit=units.unit
GROUP BY date

*/

