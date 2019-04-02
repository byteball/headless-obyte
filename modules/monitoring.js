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
			process.stderr.moveCursor(0, -2);

		printConnections();
		process.stderr.write("\n" + (lightWallet.isFirstHistoryReceived() ? "First history received and processed" : "History not received yet"));
		process.stderr.clearLine(1);

	} else {
		var network = require('ocore/network.js');
		var storage = require('ocore/storage.js');

		return network.requestFromHub("get_last_mci", null, false, function(ws, request, last_hub_mci){

			storage.readLastMainChainIndex(function(local_mci){
				
				if (bfirstPrint)
					bfirstPrint = false;
				else
					process.stderr.moveCursor(0, -3)
					process.stderr.clearLine(0);
				printConnections();
				
				if (typeof last_hub_mci == "number"){
					process.stderr.write("\nHub MCI: " + last_hub_mci + " - Local MCI: " + local_mci);
					process.stderr.clearLine(1);
					var ratio = local_mci/last_hub_mci;
					if (ratio > 1){
						console.log("local mci superior to hub mci");
						ratio = 1;
					}
					var fullBarLength = 50;
					var completedLength = Math.floor(ratio * fullBarLength) + 1;
					var uncompletedLength = fullBarLength - completedLength + 1;
					process.stderr.write("\n" + (completedLength >= 1 ? Array(completedLength).join('=') : "") + (uncompletedLength >=1 ? Array(uncompletedLength).join('-') : "") + " " +  (100*ratio).toFixed(2) + "%");
				}else{
					process.stderr.write("\nHub MCI: Unknown " + " - Local MCI: " + local_mci);
					process.stderr.clearLine(1);
					process.stderr.write("\nCouldn't get hub MCI level");
				}
				process.stderr.clearLine(1);
			});
		});
	}

}


function printConnections(){
	var network = require('ocore/network.js');
	var objConnectionStatus = network.getConnectionStatus();
	process.stderr.cursorTo(0);
	process.stderr.clearLine(0);
	process.stderr.write("\n" + objConnectionStatus.incoming+" incoming connections, "+objConnectionStatus.outgoing+" outgoing connections, "+
	objConnectionStatus.outgoing_being_opened+" outgoing connections being opened");
	process.stderr.clearLine(1);
}

exports.start = start;