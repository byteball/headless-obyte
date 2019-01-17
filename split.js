/*jslint node: true */
'use strict';
const db = require('ocore/db.js');

const COUNT_CHUNKS = 10;

// finds the largest output on this address and splits it in 10 chunks
function splitLargestOutput(address, asset){
	let headlessWallet = require('./start.js');
	console.log("will split the largest output on "+address);
	createSplitOutputs(address, asset, function(arrOutputs){
		if (!arrOutputs)
			return;
		let opts = {
			asset: asset || null,
			paying_addresses: [address],
			change_address: address
		};
		if (asset)
			opts.asset_outputs = arrOutputs;
		else
			opts.base_outputs = arrOutputs;
		headlessWallet.sendMultiPayment(opts, function(err, unit) {
			if (err)
				return console.log('failed to split: '+err);
			console.log("split unit: "+unit);
		});
	});
}

function createSplitOutputs(address, asset, handleOutputs){
	let asset_value = asset ? '='+db.escape(asset) : ' IS NULL';
	db.query(
		"SELECT amount FROM outputs CROSS JOIN units USING(unit) \n\
		WHERE address=? AND asset "+asset_value+" AND is_spent=0 AND is_stable=1 \n\
		ORDER BY amount DESC LIMIT 1",
		[address],
		function(rows){
			if (rows.length === 0)
				return handleOutputs();
			var amount = rows[0].amount;
			var chunk_amount = Math.round(amount/COUNT_CHUNKS);
			var arrOutputs = [];
			for (var i=1; i<COUNT_CHUNKS; i++) // 9 iterations
				arrOutputs.push({amount: chunk_amount, address: address});
			handleOutputs(arrOutputs);
		}
	);
}

// splits the largest output if it is greater than the 1/10th of the total
function checkAndSplitLargestOutput(address, asset){
	let asset_value = asset ? '='+db.escape(asset) : ' IS NULL';
	db.query( // see if the largest output is greater than the 1/10th of the total
		"SELECT COUNT(*) AS count FROM outputs CROSS JOIN units USING(unit) \n\
		WHERE address=? AND is_spent=0 AND asset "+asset_value+" AND is_stable=1 \n\
			AND amount>(SELECT SUM(amount)+10000 FROM outputs WHERE address=? AND is_spent=0 AND asset "+asset_value+")/(?/2)", 
		[address, address, COUNT_CHUNKS], 
		rows => {
			if (rows[0].count > 0)
				splitLargestOutput(address, asset);
		}
	);
}

// periodically checks and splits if the largest output becomes too large compared with the total
function startCheckingAndSplittingLargestOutput(address, asset, period){
	if (typeof asset === 'number'){ // asset omitted but period is set
		period = asset;
		asset = null;
	}
	checkAndSplitLargestOutput(address, asset);
	setInterval(function(){
		checkAndSplitLargestOutput(address, asset);
	}, period || 600*1000);
}

exports.splitLargestOutput = splitLargestOutput;
exports.checkAndSplitLargestOutput = checkAndSplitLargestOutput;
exports.startCheckingAndSplittingLargestOutput = startCheckingAndSplittingLargestOutput;

