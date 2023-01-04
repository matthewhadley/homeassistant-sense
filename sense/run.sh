#!/usr/bin/with-contenv bashio

SENSE_EMAIL="$(bashio::config 'sense_email')"
SENSE_PASSWORD="$(bashio::config 'sense_password')"
INTERVAL="$(bashio::config 'interval')"

SENSE_VERSION=$(cat VERSION)

# add date to default bashio log timestamp
declare __BASHIO_LOG_TIMESTAMP="%Y-%m-%d %T"

bashio::log.info "Sense $SENSE_VERSION"

SENSE_API_URI="https://api.sense.com/apiservice/api/v1"

CONF=$(curl -sq "$SENSE_API_URI/authenticate" --data "email=$SENSE_EMAIL" --data "password=$SENSE_PASSWORD")

SENSE_ACCESS_TOKEN=$(echo "$CONF" | jq -r '.access_token')
SENSE_MONITOR_0_ID=$(echo "$CONF" | jq -r '.monitors[0].id')

URI="wss://clientrt.sense.com/monitors/$SENSE_MONITOR_0_ID/realtimefeed?access_token=$SENSE_ACCESS_TOKEN"
i=1
RE='^[0-9]+$'

# bashio::log.info "Connecting to WebSocket"

websocat "$URI" |
while read -r PAYLOAD; do
    STATE=$(echo "$PAYLOAD" | jq '.payload.d_w  | select( . != null )')
    if [[ $STATE =~ $RE ]] ; then
        if [ "$i" -eq "$INTERVAL" ]; then
            timestamp=$(date '+%Y-%m-%dT%H:%M:%S')
            data='{"state":"'"$STATE"'", "timestamp":"'"$timestamp"'", "attributes":{"friendly_name":"Sense Realtime Energy Usage", "state_class": "measurement", "unit_of_measurement": "W", "device_class": "energy", "icon": "mdi:flash"}}'
            curl --silent -X POST -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" -H "Content-Type: application/json" "http://supervisor/core/api/states/sensor.sense_realtime_energy_usage" -d "$data" > /dev/null
            # bashio::log.info "$STATE"
            i=1
        else
            ((i++))
        fi
    fi
done
