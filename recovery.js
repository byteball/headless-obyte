const fs = require('fs');
const readline = require('readline');
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});
const desktopApp = require('ocore/desktop_app.js');
const conf = require('ocore/conf.js');
const Mnemonic = require('bitcore-mnemonic');
const crypto = require('crypto');
const objectHash = require('ocore/object_hash.js');
const wallet_defined_by_keys = require('ocore/wallet_defined_by_keys.js');
const Bitcore = require('bitcore-lib');
const network = require('ocore/network');
const myWitnesses = require('ocore/my_witnesses');
const db = require('ocore/db.js');
const async = require('async');
const util = require('util');
const argv = require('yargs').argv;


let appDataDir = desktopApp.getAppDataDir();
let KEYS_FILENAME = appDataDir + '/' + (conf.KEYS_FILENAME || 'keys.json');

function getKeys(callback) {
	fs.access(KEYS_FILENAME, fs.constants.F_OK | fs.constants.W_OK, (err) => {
		if (err) {
			rl.question('mnemonic:', (mnemonic_phrase) => {
				mnemonic_phrase = mnemonic_phrase.trim().toLowerCase();
				if ((mnemonic_phrase.split(' ').length % 3 === 0) && Mnemonic.isValid(mnemonic_phrase)) {
					let deviceTempPrivKey = crypto.randomBytes(32);
					let devicePrevTempPrivKey = crypto.randomBytes(32);
					writeKeys(mnemonic_phrase, deviceTempPrivKey, devicePrevTempPrivKey, () => {
						getKeys(callback)
					})
				} else {
					throw new Error('Incorrect mnemonic phrase!')
				}
			});
		} else {
			fs.readFile(KEYS_FILENAME, (err, data) => {
				if (err) throw err;
				rl.question("Passphrase: ", (passphrase) => {
					if (process.stdout.moveCursor) process.stdout.moveCursor(0, -1);
					if (process.stdout.clearLine) process.stdout.clearLine();
					let keys = JSON.parse(data.toString());
					let deviceTempPrivKey = Buffer.from(keys.temp_priv_key, 'base64');
					let devicePrevTempPrivKey = Buffer.from(keys.prev_temp_priv_key, 'base64');
					callback(keys.mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
				});

			});
		}
	});
}

function writeKeys(mnemonic_phrase, deviceTempPrivKey, devicePrevTempPrivKey, onDone) {
	let keys = {
		mnemonic_phrase: mnemonic_phrase,
		temp_priv_key: deviceTempPrivKey.toString('base64'),
		prev_temp_priv_key: devicePrevTempPrivKey.toString('base64')
	};
	fs.writeFile(KEYS_FILENAME, JSON.stringify(keys, null, '\t'), 'utf8', function (err) {
		if (err)
			throw Error("failed to write keys file");
		if (onDone)
			onDone();
	});
}

async function getWalletId(strXPubKey) {
	let rows = await db.query("SELECT * FROM extended_pubkeys WHERE extended_pubkey = ?", [strXPubKey]);
	if (rows.length) {
		return crypto.createHash("sha256").update(strXPubKey, "utf8").digest("base64");
	} else {
		return await createWallet(strXPubKey);
	}
}

function createWallet(strXPubKey) {
	return new Promise(resolve => {
		wallet_defined_by_keys.createWalletByDevices(strXPubKey, 0, 1, [], 'any walletName', false, function (wallet_id) {
			return resolve(wallet_id);
		});
	})
}

function addAddressToDatabase(wallet, is_change, index) {
	return new Promise(resolve => {
		wallet_defined_by_keys.issueAddress(wallet, is_change, index, function (addressInfo) {
			return resolve()
		});
	});
}

setTimeout(() => {
	getKeys(async (mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey) => {
		let saveTempKeys = function (new_temp_key, new_prev_temp_key, onDone) {
			writeKeys(mnemonic_phrase, new_temp_key, new_prev_temp_key, onDone);
		};
		let mnemonic = new Mnemonic(mnemonic_phrase);
		let xPrivKey = mnemonic.toHDPrivateKey(passphrase);
		let devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({size: 32});
		const device = require('ocore/device.js');
		require('ocore/wallet.js'); // we don't need any of its functions but it listens for hub/* messages
		device.setDeviceHub(conf.hub);
		device.setTempKeys(deviceTempPrivKey, devicePrevTempPrivKey, saveTempKeys);
		device.setDevicePrivateKey(devicePrivKey);
		let strXPubKey = Bitcore.HDPublicKey(xPrivKey.derive("m/44'/0'/0'")).toString();
		let resultOfCheck = await checkPubkeyCountAndDeleteThem(strXPubKey);
		rl.close();
		if (!resultOfCheck) {
			console.error('Okay, you choose "No". Bye!');
			return process.exit(0);
		}
		if (conf.bLight) {
			const light_wallet = require('ocore/light_wallet.js');
			light_wallet.setLightVendorHost(conf.hub);
		}
		replaceConsoleLog();
		let result = await generateAndCheckAddresses(xPrivKey, devicePrivKey);
		if (result.not_change >= 0) {
			let wallet_id = await getWalletId(strXPubKey);
			for (let i = 0; i <= result.not_change; i++) {
				await addAddressToDatabase(wallet_id, 0, i);
			}
			if (result.is_change >= 0) {
				for (let i = 0; i <= result.is_change; i++) {
					await addAddressToDatabase(wallet_id, 1, i);
				}
			}
			console.error("Recovery successfully done!");
			process.exit(0);
		} else {
			console.error('Not found used addresses!');
			process.exit(0);
		}
	})
}, 1000);


async function generateAndCheckAddresses(xPrivKey, devicePrivKey) {
	let strXPubKey = Bitcore.HDPublicKey(xPrivKey.derive("m/44'/0'/0'")).toString();
	let firstCheck = true;
	let lastActiveIndex = -1;
	let maxNotUsedAddresses = argv.limit || 20;
	let currentIndex = -1;
	let maxNotChangeAddressIndex = -1;
	let isChange = 0;
	while (true) {
		if (firstCheck) {
			firstCheck = false;
			let address = objectHash.getChash160(["sig", {"pubkey": wallet_defined_by_keys.derivePubkey(strXPubKey, 'm/' + isChange + '/' + 0)}]);
			if (await checkAddresses([address])) {
				lastActiveIndex = 0;
			}
			currentIndex = 0;
		} else {
			if (currentIndex - lastActiveIndex < maxNotUsedAddresses) {
				let rangeIndexes = (maxNotUsedAddresses - (currentIndex - lastActiveIndex)) < maxNotUsedAddresses ? maxNotUsedAddresses - (currentIndex - lastActiveIndex) : maxNotUsedAddresses;
				let arrAddresses = [];
				for (let i = 0; i < rangeIndexes; i++) {
					let index = currentIndex + i + 1;
					let address = objectHash.getChash160(["sig", {"pubkey": wallet_defined_by_keys.derivePubkey(strXPubKey, 'm/' + isChange + '/' + index)}]);
					arrAddresses.push(address);
				}
				currentIndex += rangeIndexes;
				if (arrAddresses.length && await checkAddresses(arrAddresses)) {
					lastActiveIndex = currentIndex;
				}
			} else {
				if (isChange === 0) {
					isChange = 1;
					firstCheck = true;
					currentIndex = -1;
					maxNotChangeAddressIndex = lastActiveIndex;
					lastActiveIndex = -1;
				} else {
					return {
						not_change: maxNotChangeAddressIndex,
						is_change: lastActiveIndex,
					};
				}
			}
		}
	}

	function checkAddresses(addresses) {
		return new Promise(resolve => {
			if (conf.bLight) {
				myWitnesses.readMyWitnesses(function (arrWitnesses) {
					network.requestFromLightVendor('light/get_history', {
						addresses: addresses,
						witnesses: arrWitnesses
					}, function (ws, request, response) {
						if (response && response.error) {
							throw Error(response.error);
						}
						return resolve(!!Object.keys(response).length);
					})
				}, 'wait')
			} else {
				db.query("SELECT 1 FROM outputs WHERE address IN(?) LIMIT 1", [addresses], function (outputsRows) {
					if (outputsRows.length === 1)
						return resolve(true);
					else {
						db.query("SELECT 1 FROM unit_authors WHERE address IN(?) LIMIT 1", [addresses], function (unitAuthorsRows) {
							return resolve(unitAuthorsRows.length === 1);
						});
					}
				});
			}
		})
	}
}

async function checkPubkeyCountAndDeleteThem(strXPubKey) {
	let rows = await db.query("SELECT * FROM extended_pubkeys");
	if (rows.length === 0) {
		await removeAddressesAndWallets();
		return true;
	} else if (rows.length > 1) {
		let result = await reqRemoveData();
		if (result) {
			await removeAddressesAndWallets();
		}
		return result;
	} else {
		if (rows[0].extended_pubkey === strXPubKey) {
			return true;
		} else {
			let result = await reqRemoveData();
			if (result) {
				await removeAddressesAndWallets();
			}
			return result;
		}
	}
}

function reqRemoveData() {
	return new Promise(resolve => {
		rl.question('Another key found, remove it? (Yes / No)', (answer) => {
			answer = answer.trim().toLowerCase();
			if (answer === 'yes' || answer === 'y') {
				return resolve(true);
			} else if (answer === 'no' || answer === 'n') {
				return resolve(false);
			} else {
				return resolve(reqRemoveData());
			}
		})
	});
}

function removeAddressesAndWallets() {
	return new Promise(resolve => {
		let arrQueries = [];
		db.addQuery(arrQueries, "DELETE FROM pending_shared_address_signing_paths");
		db.addQuery(arrQueries, "DELETE FROM shared_address_signing_paths");
		db.addQuery(arrQueries, "DELETE FROM pending_shared_addresses");
		db.addQuery(arrQueries, "DELETE FROM shared_addresses");
		db.addQuery(arrQueries, "DELETE FROM my_addresses");
		db.addQuery(arrQueries, "DELETE FROM wallet_signing_paths");
		db.addQuery(arrQueries, "DELETE FROM extended_pubkeys");
		db.addQuery(arrQueries, "DELETE FROM wallets");
		db.addQuery(arrQueries, "DELETE FROM correspondent_devices");
		async.series(arrQueries, resolve);
	});
}

function replaceConsoleLog() {
	let log_filename = conf.LOG_FILENAME || (appDataDir + '/log.txt');
	let writeStream = fs.createWriteStream(log_filename);
	console.log('---------------');
	console.log('From this point, output will be redirected to ' + log_filename);
	console.log("To release the terminal, type Ctrl-Z, then 'bg'");
	console.log = function () {
		writeStream.write(Date().toString() + ': ');
		writeStream.write(util.format.apply(null, arguments) + '\n');
	};
	console.warn = console.log;
	console.info = console.log;
}
