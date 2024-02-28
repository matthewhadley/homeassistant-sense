#!/bin/bash

docker run \
    --rm \
    --privileged \
    -v "$(pwd)":/data \
    homeassistant/aarch64-builder \
    --all \
    --target sense \
    --docker-user $DOCKER_USER \
    --docker-password $DOCKER_PASSWORD
