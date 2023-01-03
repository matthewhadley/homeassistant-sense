#!/usr/bin/with-contenv bashio

SENSE_EMAIL="$(bashio::config 'sense_email')"
SENSE_PASSWORD="$(bashio::config 'sense_password')"

SENSE_VERSION=$(cat VERSION)

# add date to default bashio log timestamp
declare __BASHIO_LOG_TIMESTAMP="%Y-%m-%d %T"

bashio::log.info "Sense $SENSE_VERSION"

SENSE_API_URI="https://api.sense.com/apiservice/api/v1"

SENSE_ACCESS_TOKEN=$(curl -sq "$SENSE_API_URI/authenticate" \
  --data "email=$SENSE_EMAIL" \
  --data "password=$SENSE_PASSWORD" \
  | jq -r '.access_token')

SENSE_MONITOR_0_ID=$(curl -sq "$SENSE_API_URI/authenticate" \
  --data "email=$SENSE_EMAIL" \
  --data "password=$SENSE_PASSWORD" \
  | jq -r '.monitors[0].id')

URI="wss://clientrt.sense.com/monitors/$SENSE_MONITOR_0_ID/realtimefeed?access_token=$SENSE_ACCESS_TOKEN"
i=1
RE='^[0-9]+$'
INTERVAL=3

websocat "$URI" |
while read -r PAYLOAD; do
    VALUE=$(echo "$PAYLOAD" | jq '.payload.w  | select( . != null ) | round')
    if [[ $VALUE =~ $RE ]] ; then
        if [ "$i" -eq "$INTERVAL" ]; then
            state="$VALUE"
            timestamp=$(date '+%Y-%m-%dT%H:%M:%S')
            payload='{"state":"'"$state"'", "attributes":{"friendly_name":"Sense Realtime Energy Usage", "state_class": "measurement", "unit_of_measurement": "W", "device_class": "energy", "icon": "mdi:flash", "timestamp":"'"$timestamp"'"}}'
            curl --silent -X POST -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" -H "Content-Type: application/json" "http://supervisor/core/api/states/sensor.sense_realtime_energy_usage" -d "$payload" > /dev/null
            bashio::log.info "$VALUE"
            i=1
        else
            ((i++))
        fi

    fi
done
