var conf = require('ocore/conf.js');
var bfirstPrint = true;

function start(){
	printCompleteStatus();
	setInterval(printCompleteStatus, 10000);
}

function printCompleteStatus(){

	if (conf.bLight){
		var lightWallet =  require('ocore/light_wallet.js');

		if (bfirstPrint)
			bfirstPrint = false;
		else
			process.stdout.moveCursor(0, -2);

		printConnections();
		process.stdout.write("\n" + (lightWallet.isFirstHistoryReceived() ? "First history received and processed" : "History not received yet"));
		process.stdout.clearLine(1);

	} else {
		var device = require('ocore/device.js');
		var storage = require('ocore/storage.js');

		return device.requestFromHub("get_last_mci", null, function(hubErr, last_hub_mci){

			storage.readLastMainChainIndex(function(local_mci){
				
				if (bfirstPrint)
					bfirstPrint = false;
				else
					process.stdout.moveCursor(0, -3)
					
				process.stdout.clearLine(0);
				printConnections();
				
				if (!hubErr){
					process.stdout.write("\nHub MCI: " + last_hub_mci + " - Local MCI: " + local_mci);
					process.stdout.clearLine(1);
					var ratio = local_mci/last_hub_mci;
					if (ratio > 1){
						console.log("local mci superior to hub mci");
						ratio = 1;
					}
					var fullBarLength = 50;
					var completedLength = Math.floor(ratio * fullBarLength) + 1;
					var uncompletedLength = fullBarLength - completedLength + 1;
					process.stdout.write("\n" + (completedLength >= 1 ? Array(completedLength).join('=') : "") + (uncompletedLength >=1 ? Array(uncompletedLength).join('-') : "") + " " +  (100*ratio).toFixed(2) + "%");
				}else{
					process.stdout.write("\nHub MCI: Unknown " + " - Local MCI: " + local_mci);
					process.stdout.clearLine(1);
					process.stdout.write("\nCouldn't get hub MCI level");
				}
				process.stdout.clearLine(1);
			});
		});
	}

}


function printConnections(){
	var network = require('ocore/network.js');
	var objConnectionStatus = network.getConnectionStatus();
	process.stdout.cursorTo(0);
	process.stdout.clearLine(0);
	process.stdout.write("\n" + objConnectionStatus.incoming+" incoming connections, "+objConnectionStatus.outgoing+" outgoing connections, "+
	objConnectionStatus.outgoing_being_opened+" outgoing connections being opened");
	process.stdout.clearLine(1);
}

exports.start = start;