#!/usr/bin/env bash

# only tested on ubuntu 16.4LTS with 32GB RAM
# don't forget to chmod a+x this file

sudo mkdir -p /media/ramdrive
mkdir -p ~/byteball
sudo mount -t tmpfs -o size=31G tmpfs /media/ramdrive/
cd /media/ramdrive
mkdir /media/ramdrive/byteball_app_storage

rm -rf ./headless-byteball
git clone https://github.com/byteball/headless-byteball.git
cd headless-byteball
yarn

rm -rf ~/.config/headless-byteball
ln -s /media/ramdrive/byteball_app_storage ~/.config/headless-byteball

echo "exports.LOG_FILENAME = '/dev/null';" >> conf.js

node start.js

function finish {
  rsync -rue --info=progress2 /media/ramdrive ~/byteball
}

trap finish EXIT
