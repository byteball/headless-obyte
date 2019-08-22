/*jslint node: true */
'use strict';
const db = require('ocore/db.js');

Array.prototype.forEachAsync = async function(fn) {
	for (let t of this) { await fn(t) }
}

witnessTable();

async function witnessTable() {
	let witness_matrix = {};

	// get current mci
	let units = await db.query("SELECT max(main_chain_index) AS max_index FROM units;", []);
	if (!units.length) return;

	// witnesses who have been selected to witness past 1000 mci units
	let witnessing_outputs = await db.query("SELECT address, count(*) AS total_count \
			FROM witnessing_outputs \
			WHERE main_chain_index > ? AND main_chain_index <= ? \
			GROUP BY address ORDER BY total_count DESC;", [units[0].max_index-1000, units[0].max_index]);

	// get the witness lists of the last transaction of those witnesses from above query
	await witnessing_outputs.forEachAsync(async (witnessing_output) => {
		console.log('witnessing_output', witnessing_output.address);
		let unit_witnesses = await db.query("SELECT unit_witnesses.address, unit_witnesses.unit \
				FROM witnessing_outputs \
				JOIN units ON witnessing_outputs.main_chain_index = units.main_chain_index \
				JOIN unit_witnesses ON (units.witness_list_unit = unit_witnesses.unit OR units.unit = unit_witnesses.unit) \
				WHERE witnessing_outputs.address = ? \
				ORDER BY witnessing_outputs.rowid DESC LIMIT 12;", [witnessing_output.address]);
		if (!unit_witnesses.length) return;
		console.log('witness_list_unit', unit_witnesses[0].unit);

		// convert sqlite result to array
		witness_matrix[witnessing_output.address] = unit_witnesses.map( (unit_witness) => {
			return unit_witness.address;
		});
	});

	let witness_table = {};
	let index_length = 3;
	// build empty table
	Object.keys(witness_matrix).sort().forEach( (key) => {
		witness_matrix[key].forEach( (witness) => {
			Object.keys(witness_matrix).forEach( (key2) => {
				let key_name = key.substr(0, index_length) +'...';
				let witness_name = witness.substr(0, index_length) +'...';
				let key_name2 = key2.substr(0, index_length) +'...';
				// init assoc arrays
				if (typeof witness_table[key_name] == 'undefined') {
					witness_table[key_name] = {};
				}
				if (typeof witness_table[key_name2] == 'undefined') {
					witness_table[key_name2] = {};
				}
				if (typeof witness_table[witness_name] == 'undefined') {
					witness_table[witness_name] = {};
				}
				// set empty cells
				witness_table[key_name][key_name] = null;
				witness_table[key_name2][key_name] = null;
				witness_table[witness_name][key_name] = null;
				witness_table[witness_name][key_name2] = null;
			});
		});
	});
	// fill empty table cells
	Object.keys(witness_matrix).forEach( (key) => {
		witness_matrix[key].forEach( (witness) => {
			let key_name = key.substr(0, index_length) +'...';
			let witness_name = witness.substr(0, index_length) +'...';
			// just in case
			if (typeof witness_table[witness_name] == 'undefined') {
				witness_table[witness_name] = {};
			}
			// themselves on their witness list
			if (key === witness) {
				witness_table[witness_name][key_name] = true;
			}
			// mark on those who have picked as witness, not who they picked
			else if (witness_matrix[key] !== 'undefined') {
				witness_table[witness_name][key_name] = 'true';
			}
		});
	});

	if (Number(process.version.match(/^v(\d+)/)[1]) < 10) {
		console.log(JSON.stringify(witness_matrix));
		console.log(witness_table);
		console.error('No table, JSON dump of both arrays because lower than Node.js v10');
	}
	else {
		// draws nice table in console on Node.js v10 and above
		console.table(witness_table);
	}
	process.exit();
}