/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('ocore/event_bus.js');

function onError(err){
	throw Error(err);
}

function createAsset(){
	var composer = require('ocore/composer.js');
	var network = require('ocore/network.js');
	var callbacks = composer.getSavingCallbacks({
		ifNotEnoughFunds: onError,
		ifError: onError,
		ifOk: function(objJoint){
			network.broadcastJoint(objJoint);
			console.error('==== Asset ID:'+ objJoint.unit.unit);
		}
	});
	var asset = {
		cap: (1+2*2+5+10+20*2+50+100+200*2+500+1000+2000*2+5000+10000+20000*2+50000+100000)*1e10,
		//cap: 1000000,
		is_private: true,
		is_transferrable: true,
		auto_destroy: false,
		fixed_denominations: true, // if true then it's IndivisibleAsset, if false then it's DivisibleAsset
		issued_by_definer_only: true,
		cosigned_by_definer: false,
		spender_attested: false,
	//    issue_condition: ["in data feed", [["MO7ZZIU5VXHRZGGHVSZWLWL64IEND5K2"], "timestamp", ">=", 1453139371111]],
	//    transfer_condition: ["has one equal", 
	//        {equal_fields: ["address", "amount"], search_criteria: [{what: "output", asset: "base"}, {what: "output", asset: "this asset"}]}
	//    ],

		denominations: [
			{denomination: 1, count_coins: 1e10},
			{denomination: 2, count_coins: 2e10},
			{denomination: 5, count_coins: 1e10},
			{denomination: 10, count_coins: 1e10},
			{denomination: 20, count_coins: 2e10},
			{denomination: 50, count_coins: 1e10},
			{denomination: 100, count_coins: 1e10},
			{denomination: 200, count_coins: 2e10},
			{denomination: 500, count_coins: 1e10},
			{denomination: 1000, count_coins: 1e10},
			{denomination: 2000, count_coins: 2e10},
			{denomination: 5000, count_coins: 1e10},
			{denomination: 10000, count_coins: 1e10},
			{denomination: 20000, count_coins: 2e10},
			{denomination: 50000, count_coins: 1e10},
			{denomination: 100000, count_coins: 1e10}
		],
		//attestors: ["X5ZHWBYBF4TUYS35HU3ROVDQJC772ZMG", "GZSEKMEQVOW2ZAHDZBABRTECDSDFBWVH", "2QLYLKHMUG237QG36Z6AWLVH4KQ4MEY6"].sort()
	};
	headlessWallet.readFirstAddress(function(definer_address){
		composer.composeAssetDefinitionJoint(definer_address, asset, headlessWallet.signer, callbacks);
	});
}

eventBus.on('headless_wallet_ready', createAsset);
