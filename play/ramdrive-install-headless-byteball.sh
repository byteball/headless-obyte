#!/usr/bin/env bash

# only tested on ubuntu 16.4LTS with 32GB RAM
# don't forget to chmod a+x this file

sudo mkdir -p /media/ramdrive
mkdir -p ~/obyte
sudo mount -t tmpfs -o size=31G tmpfs /media/ramdrive/
cd /media/ramdrive
mkdir /media/ramdrive/obyte_app_storage

rm -rf ./headless-obyte
git clone https://github.com/byteball/headless-obyte.git
cd headless-obyte
yarn

rm -rf ~/.config/headless-obyte
ln -s /media/ramdrive/obyte_app_storage ~/.config/headless-obyte

echo "exports.LOG_FILENAME = '/dev/null';" >> conf.js

node start.js

function finish {
  rsync -rue --info=progress2 /media/ramdrive ~/obyte
}

trap finish EXIT
