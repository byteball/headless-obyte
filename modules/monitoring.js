var conf = require('ocore/conf.js');
var bfirstPrint = true;
var lineLengths = [];

function start(){
	printCompleteStatus();
	setInterval(printCompleteStatus, 10000);
}

function printCompleteStatus(){

	if (!process.stdout.isTTY)
		return;
	var text;

	if (conf.bLight){
		var lightWallet =  require('ocore/light_wallet.js');

		if (bfirstPrint){
			bfirstPrint = false;
			process.stdout.write("\n");
		}
		else
			process.stdout.moveCursor(0, -2);

		printConnections();
		text = lightWallet.isFirstHistoryReceived() ? "First history received and processed" : "History not received yet";
		process.stdout.write("\n");
		process.stdout.write(text);
		lineLengths.push(text.length)
		process.stdout.clearLine(1);

	} else {
		var device = require('ocore/device.js');
		var storage = require('ocore/storage.js');
		return device.requestFromHub("get_last_mci", null, function(hubErr, last_hub_mci){

			storage.readLastMainChainIndex(function(local_mci){
				var linesCounter = 0;
				if (bfirstPrint){
					bfirstPrint = false;
					process.stdout.write("\n");
				}else{
					lineLengths.forEach(function(textLength){	//we have to count how many lines were used for the previous print to move the cursor backward accordingly
						linesCounter+= Math.ceil(textLength/process.stdout.columns);
					});
					process.stdout.moveCursor(0, 1 - linesCounter);
					lineLengths = [];
				}
				process.stdout.clearLine(0);
				printConnections();
				
				if (!hubErr){
					text = "Hub MCI: " + last_hub_mci + " - Local MCI: " + local_mci;
					process.stdout.write("\n");
					process.stdout.write(text);
					lineLengths.push(text.length)

					
					process.stdout.clearLine(1);
					var ratio = local_mci/last_hub_mci;
					if (ratio > 1){
						console.log("local mci superior to hub mci");
						ratio = 1;
					}
					var fullBarLength = 50;
					var completedLength = Math.floor(ratio * fullBarLength) + 1;
					var uncompletedLength = fullBarLength - completedLength + 1;
					process.stdout.write("\n" );
					text = (completedLength >= 1 ? Array(completedLength).join('=') : "") + (uncompletedLength >=1 ? Array(uncompletedLength).join('-') : "") + " " +  (100*ratio).toFixed(2) + "%";
					process.stdout.write(text);
					lineLengths.push(text.length)
				}else{
					process.stdout.write("\n");
					text = "Hub MCI: Unknown " + " - Local MCI: " + local_mci;
					process.stdout.write(text);
					lineLengths.push(text.length)

					process.stdout.clearLine(1);
					process.stdout.write("\n");
					text = "Couldn't get hub MCI level";
					process.stdout.write(text);
					lineLengths.push(text.length)
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
	var text = objConnectionStatus.incoming+" incoming connections, "+objConnectionStatus.outgoing+" outgoing connections, "+
	objConnectionStatus.outgoing_being_opened+" outgoing connections being opened";
	process.stdout.write(text);
	lineLengths.push(text.length);
	process.stdout.clearLine(1);
}

exports.start = start;