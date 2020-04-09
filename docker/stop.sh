#!/bin/bash

DEFAULT_TAGNAME="latest"
TAGNAME=${1:-$DEFAULT_TAGNAME}

docker rm -f "headless-obyte-$TAGNAME"