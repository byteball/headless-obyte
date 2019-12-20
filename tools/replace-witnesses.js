/*jslint node: true */
'use strict';
const db = require('ocore/db.js');

let witnesses = [];
if (!process.env.testnet) {
	witnesses.push({'old': 'JEDZYC2HMGDBIDQKG3XSTXUSHMCBK725', 'new': '4GDZSXHEFVFMHCUCSHZVXBVF5T2LJHMU'}); // Rogier Eijkelhof
	witnesses.push({'old': 'S7N5FE42F6ONPNDQLCF64E2MGFYKQR2I', 'new': 'FAB6TH7IRAVHDLK2AAWY5YBE6CEBUACF'}); // Fabien Marino
	witnesses.push({'old': 'DJMMI5JYA5BWQYSXDPRZJVLW3UGL3GJS', 'new': '2TO6NYBGX3NF5QS24MQLFR7KXYAMCIE5'}); // Bosch
}

witnesses.forEach(function(replacement) {
	if (replacement.old && replacement.new) {
		db.query("UPDATE my_witnesses SET address = ? WHERE address = ?;", [replacement.new, replacement.old], (rows) => {
			console.log(rows);
		});
	}
});