#!/bin/bash

DEFAULT_TAGNAME="latest"
DEFAULT_VOLUME_PATH="$(pwd)/docker/configs"
TAGNAME=${1:-$DEFAULT_TAGNAME}
VOLUME_PATH=${2:-$DEFAULT_VOLUME_PATH}
CONTAINER_NAME="headless-obyte-$TAGNAME"

# remove container if it is still running
docker/stop.sh $TAGNAME
# run container
docker run -it \
  --name $CONTAINER_NAME \
  -v $VOLUME_PATH:/home/node/.config \
  headless-obyte:$TAGNAME

# the  start.js script asks for the passphrase, so the user should input the passphrase 
# and let the script running in the background. (hit Ctrl+P+Q)