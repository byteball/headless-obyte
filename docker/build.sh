#!/bin/bash

DEFAULT_TAGNAME="latest"
TAGNAME=${1:-$DEFAULT_TAGNAME}

docker build -t headless-obyte:$TAGNAME -f docker/Dockerfile .