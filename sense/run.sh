#!/usr/bin/with-contenv bashio

# add date to default bashio log timestamp
declare __BASHIO_LOG_TIMESTAMP="%Y-%m-%d %T"

SENSE_VERSION=$(cat VERSION)
SENSE_EMAIL="$(bashio::config 'sense_email')"
SENSE_PASSWORD="$(bashio::config 'sense_password')"
SENSE_INTERVAL="$(bashio::config 'interval')"

export SENSE_VERSION
export SENSE_EMAIL
export SENSE_PASSWORD
export SENSE_INTERVAL

bashio::log.info "Starting node service."
npm run --silent start

