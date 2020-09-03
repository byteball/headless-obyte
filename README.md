# Headless wallet for Obyte network

This is a headless alternative of the [GUI wallet](https://github.com/byteball/obyte-gui-wallet) for Obyte network.  It is designed for an always-online deployment on a server.

## Install

Install node.js, clone the repository, then say
```sh
npm install
```
If you want to accept incoming connections, you'll need to set up a proxy, such as nginx, to forward all websocket connections on a specific path to your daemon running this code.  See example configuration for nginx in [ocore](https://github.com/byteball/ocore) documentation.

## Testnet

Run `cp .env.testnet .env` to connect to TESTNET hub. Backup and delete the database if you already ran it on MAINNET. Wallet app for [TESTNET can be downloaded from Obyte.org](https://obyte.org/testnet.html) website.

## Run
```sh
node start.js 2>errlog
```
The first time you run it, it will generate a new extended private key (BIP44) and ask you for a passphrase to encrypt it.  The BIP39 mnemonic will be saved to the file keys.json in the app data directory (see [ocore](https://github.com/byteball/ocore) for its location), the passphrase is, of course, never saved.  Every time you start the wallet, you'll have to type the passphrase.  One implication of this is the wallet cannot be started automatically when your server restarts, you'll have to ssh the server and type the passphrase.

After you enter the passphrase, the wallet redirects all output to a log file in your app data directory but it still holds the terminal window.  To release it, type Ctrl-Z, then bg to resume the wallet in the background.  After that, you can safely terminate the ssh session.

### Running non-interactively

If you are unable to enter a passphrase every time the wallet starts and/or are willing to accept the security risks, set `bNoPassphrase` to `true` and daemonize the app when starting:
```sh
node start.js 1>log 2>errlog &
```
If you run the wallet in a non-permanent environment such as Heroku (where hard disks are ephemeral and deleted on each restart), supply your mnemonic as an environment variable `mnemonic` to ensure that the keys are not regenerated every time. Your private keys are derived from the mnemonic. Also set `bLight` and `bSingleAddress` to `true`. See below about conf options.

## Backup

If you run only a headless wallet, backing up `keys.json` (or just the mnemonic from this file) in your data folder is enough, the rest can be restored by syncing the node again (which takes several days) and running the below script.  If your headless wallet is included in a bigger application which stores its own data in addition to the public DAG data, you need to back up your entire data folder.

## Recovery from seed (mnemonic)
```sh
cd tools
node recovery.js --limit=20
```
The script generates your wallet addresses and stops when it finds `limit` (default 20) unused addresses in a row.  If using full wallet, your node should be synced before running the script.

If you already have `keys.json` file, copy it to the data folder, otherwise the script will ask you about your mnemonic.

## Customize

If you want to change any defaults, refer to the documentation of [ocore](https://github.com/byteball/ocore), the core Obyte library `require()`'d from here.  Below are some headless wallet specific settings you might want to change:

* `bLight`: some bots don't need to sync full node. If your bot is designed to work as light node or you just wish to get it working first, change `bLight` variable to `true` in configuration file. Changing this value will make it use a different SQLite database next time you run it.
* `bSingleAddress`: Should the wallet use single address or could generate new addresses?
* `bStaticChangeAddress`: Should the wallet issue new change addresses or always use the same static one?
* `control_addresses`: array of device addresses of your other (likely GUI) wallets that can chat with the wallet and give commands.  To learn the device address of your GUI wallet, click menu button, then Global preferences, and look for 'Device address'.  If your `control_addresses` is empty array or contains a single address that is invalid (this is the default), then nobody can remotely control your wallet.
* `payout_address`: if you give `pay` command over chat interface, funds will be sent to this Obyte address.
* `hub`: hub address without wss://, the default is `obyte.org/bb`.
* `deviceName`: the name of your device as seen in the chat interface.
* `permanent_pairing_secret`: the pairing secret used to authenticate pairing requests when you pair your GUI wallet for remote control.  The pairing secret is the part of the pairing code after #.
* `bNoPassphrase`: don't ask for passphrase when starting the wallet, assume it is an empty string. This option weakens the security of your funds but allows to start the wallet non-interactively.
* `LOG_FILENAME`: by default `log.txt` file in data folder, set to `/dev/null` to disable all logs.
* `logToSTDOUT`: by default `false` and writes logs to `LOG_FILENAME` file, set to `true` if you wish to keep the logs output to terminal screen, instead of file.

## Remote control

You can remotely control your wallet via chat interface from devices listed in `control_addresses`.  When the wallet starts, it prints out its pairing code.  Copy it, open your GUI wallet, menu button, paired devices, add a new device, accept invitation, paste the code.  Now your GUI wallet is paired to your headless wallet and you can find it in the list of correspondents (menu, paired devices) to start a chat.  These are the commands you can give:

* `balance`: to request the current balance on the headless wallet;
* `address`: to get to know one of the wallet's addresses, you use it to refill the wallet's balance;
* `pay <amount in bytes>` to withdraw Bytes to your `payout_address`;
* `pay all bytes` to withdraw all Bytes (including earned commissions) to your `payout_address`;
* `pay <amount> <asset>` to withdraw specific asset to your `payout_address`;
* `mci`: to get the last stable MCI on the headless wallet;
* `space`: to get the file sizes of data folder;

![Chat with headless wallet](chat-with-headless.png)

## Differences from GUI wallet

* Headless wallet (as software) can have only one wallet (as storage of funds) AKA account, its BIP44 derivation path is `m/44'/0'/0'`.  In GUI wallet (as software) you can create multiple wallets (as storage of funds).
* Headless wallet cannot be a member of multisig address because there is nobody to present confirmation messages to.  Hence, you can't have multisig security on headless wallets and have to have other security measures in place.

## Security recommendations

First, don't run the server wallet if you don't absolutely need to.  For example, if you want to only accept payments, you don't need it.  Consider server wallet only if you need to *send* payments in programmatic manner.

Having the keys encrypted by a passphrase helps protect against the most trivial theft of private keys in case an attacker gets access to your server.  Set a good passphrase that cannot be easily bruteforced and never store it on the server.  

However, that is not enough.  If an attacker gets access to your server, he could also modify your conf.json and change `control_addresses` and `payout_address`, then wait that you restart the wallet and steal its entire balance.  To help you prevent such attacks, every time the wallet starts it prints out the current values of `control_addresses` and `payout_address`, please pay attention to these values before entering your passphrase.

Use TOR ([conf.socksHost, conf.socksPort, and conf.socksLocalDNS](https://github.com/byteball/ocore#confsockshost-confsocksport-and-confsockslocaldns)) to hide your server IP address from potential attackers.

Don't keep more funds than necessary on the server wallet, withdraw the excess using `pay` command in the chat interface.

## Custom commands

Payments are the central but not the only type of data that Obyte stores.  In [tools/](tools/) subdirectory, you will find many small scripts that demonstrate how to create other message types that are not available through the GUI wallet.  In particular, you can declare and issue your own assets, post data as an oracle, create polls and cast votes.  Just edit any of these scripts and run it.

## RPC service

By default, no RPC service is enabled.  If you want to manage your headless wallet via JSON-RPC API, e.g. you run an exchange, run [tools/rpc_service.js](tools/rpc_service.js) instead.  See the [documentation about running RPC service](https://developer.obyte.org/json-rpc/running-rpc-service).

## Docker image

You can build and run your own docker image.

To build the docker image run:
```sh
docker build -t headless-obyte:latest -f docker/Dockerfile .
```

To run the docker container execute:
```sh
docker run -it \
  --name headless-obyte \
  -v "$(pwd)"/docker/configs:/home/node/.config \
  headless-obyte:latest
```

The start.js script asks for the passphrase, so the user should input the passphrase
and let the script running in the background. (hit Ctrl+P+Q)

To stop the docker container run:
```sh
docker stop headless-obyte
```

To remove the stoped docker container run:
```sh
docker rm headless-obyte
```

To remove not used docker image run:
```sh
docker rmi headless-obyte:latest
```

### You can also use scripts

Before running scripts, you must give permission to execute them:
```sh
chmod +x docker/*.sh
```

To build the docker image run:
```sh
docker/build.sh [tagname]
```

To run the docker container execute:
```sh
docker/run.sh [tagname] [volume_path]
```

To stop and remove the docker container run:
```sh
docker/stop.sh [tagname]
```