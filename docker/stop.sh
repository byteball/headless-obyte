#!/bin/bash

DEFAULT_TAGNAME="latest"
TAGNAME=${1:-$DEFAULT_TAGNAME}
CONTAINER_NAME="headless-obyte-$TAGNAME"

if [[ $(docker ps -a | grep "$CONTAINER_NAME") ]]; then
  docker rm -f $CONTAINER_NAME > /dev/null
  echo "The previous container '$CONTAINER_NAME' was stoped."
else
  echo "The '$CONTAINER_NAME' container was not started earlier."
fi