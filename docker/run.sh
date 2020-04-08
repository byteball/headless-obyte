#!/bin/bash

DEFAULT_TAGNAME="latest"
DEFAULT_VOLUME_PATH="$(pwd)/docker/configs"
TAGNAME=${1:-$DEFAULT_TAGNAME}
VOLUME_PATH=${2:-$DEFAULT_VOLUME_PATH}

# remove container if it is still running
docker rm -f headless_obyte
# run container
docker run -it \
  --name headless_obyte \
  -v $VOLUME_PATH:/home/node/.config \
  headless-obyte:$TAGNAME

# the  start.js script asks for the passphrase, so the user should input the passphrase 
# and let the script running in the background. (hit Ctrl+P+Q)