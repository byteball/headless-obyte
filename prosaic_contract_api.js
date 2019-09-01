/*jslint node: true */
"use strict";
var prosaic_contract = require('ocore/prosaic_contract.js');
var eventBus = require('ocore/event_bus.js');
var device = require('ocore/device.js');
var objectHash = require('ocore/object_hash.js');
var conf = require('ocore/conf.js');
var db = require('ocore/db.js');
var ecdsaSig = require('ocore/signature.js');
var walletDefinedByAddresses = require('ocore/wallet_defined_by_addresses.js');
var walletDefinedByKeys = require('ocore/wallet_defined_by_keys.js');
var headlessWallet = require('./start.js');

var contractsListened = [];
var wallet_id;

function offer(title, text, my_address, peer_address, peer_device_address, ttl, cosigners, signWithLocalPrivateKey, callbacks) {
	var creation_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
	var hash = prosaic_contract.getHash({title:title, text:text, creation_date:creation_date});

	prosaic_contract.createAndSend(hash, peer_address, peer_device_address, my_address, creation_date, ttl, title, text, cosigners, function(objContract){
		listenForPendingContracts(signWithLocalPrivateKey, callbacks);
		if (callbacks.onOfferCreated)
			callbacks.onOfferCreated(objContract);
	});
}

function listenForPendingContracts(signWithLocalPrivateKey, callbacks) {
	if (!callbacks)
		callbacks = {};
	if (!callbacks.onError)
		callbacks.onError = console.error;

	var start_listening = function(contract) {
		var sendUnit = function(accepted){
			if (callbacks.onResponseReceived)
					callbacks.onResponseReceived(accepted);
			if (!accepted) {
				return;
			}

			var arrDefinition = 
				['and', [
					['address', contract.my_address],
					['address', contract.peer_address]
				]];
			var assocSignersByPath = {
				'r.0': {
					address: contract.my_address,
					member_signing_path: 'r',
					device_address: device.getMyDeviceAddress()
				},
				'r.1': {
					address: contract.peer_address,
					member_signing_path: 'r',
					device_address: contract.peer_device_address
				}
			};
			walletDefinedByAddresses.createNewSharedAddress(arrDefinition, assocSignersByPath, {
				ifError: function(err){
					callbacks.onError(err);
				},
				ifOk: function(shared_address){
					composeAndSend(shared_address);
				}
			});
			
			// create shared address and deposit some bytes to cover fees
			function composeAndSend(shared_address){
				prosaic_contract.setField(contract.hash, "shared_address", shared_address);
				device.sendMessageToDevice(contract.peer_device_address, "prosaic_contract_update", {hash: contract.hash, field: "shared_address", value: shared_address});
				contract.cosigners.forEach(function(cosigner){
					if (cosigner != device.getMyDeviceAddress())
						prosaic_contract.share(contract.hash, cosigner);
				});

				var opts = {
					asset: "base",
					to_address: shared_address,
					amount: prosaic_contract.CHARGE_AMOUNT,
					arrSigningDeviceAddresses: contract.cosigners
				};

				headlessWallet.issueChangeAddressAndSendMultiPayment(opts, function(err){
					if (err){
						callbacks.onError(err);
						return;
					}

					// post a unit with contract text hash and send it for signing to correspondent
					var value = {"contract_text_hash": contract.hash};
					var objMessage = {
						app: "data",
						payload_location: "inline",
						payload_hash: objectHash.getBase64Hash(value),
						payload: value
					};

					headlessWallet.issueChangeAddressAndSendMultiPayment({
						arrSigningDeviceAddresses: contract.cosigners.length ? contract.cosigners.concat([contract.peer_device_address]) : [],
						shared_address: shared_address,
						messages: [objMessage]
					}, function(err, unit) { // can take long if multisig
						//indexScope.setOngoingProcess(gettext('proposing a contract'), false);
						if (err) {
							callbacks.onError(err);
							return;
						}
						prosaic_contract.setField(contract.hash, "unit", unit);
						device.sendMessageToDevice(contract.peer_device_address, "prosaic_contract_update", {hash: contract.hash, field: "unit", value: unit});
						var explorer = (process.env.testnet ? 'https://testnetexplorer.obyte.org/#' : 'https://explorer.obyte.org/#');
						var text = "unit with contract hash for \""+ contract.title +"\" was posted into DAG " + explorer + unit;
						device.sendMessageToDevice(contract.peer_device_address, "text", text);

						if (callbacks.onSigned)
							callbacks.onSigned(contract);
					});
				});
			}
		};
		eventBus.once("prosaic_contract_response_received" + contract.hash, sendUnit);
	}

	prosaic_contract.getAllByStatus("pending", function(contracts){
		contracts.forEach(function(contract){
			if (contractsListened.indexOf(contract.hash) === -1) {
				start_listening(contract);
				contractsListened.push(contract.hash);
			}
		});
	});
}

exports.offer = offer;
exports.listenForPendingContracts = listenForPendingContracts;