#!/bin/bash

sedi () {
  sed --version >/dev/null 2>&1 && sed -i -- "$@" || sed -i "" "$@"
}

APP=sense

docker run \
    --rm \
    --privileged \
    -v ~/.docker:/root/.docker \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v "$(pwd)":/data \
    homeassistant/aarch64-builder \
    --all \
    --target $APP


