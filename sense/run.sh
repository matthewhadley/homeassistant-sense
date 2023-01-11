#!/usr/bin/with-contenv bashio

SENSE_EMAIL="$(bashio::config 'sense_email')"
SENSE_PASSWORD="$(bashio::config 'sense_password')"
INTERVAL="$(bashio::config 'interval')"

SENSE_VERSION=$(cat VERSION)
CONFIG_FILE="/data/sense.conf"
SENSE_API_URI="https://api.sense.com/apiservice/api/v1"
SENSE_WS_URI="wss://clientrt.sense.com/monitors"

# add date to default bashio log timestamp
declare __BASHIO_LOG_TIMESTAMP="%Y-%m-%d %T"

bashio::log.info "Sense $SENSE_VERSION"

auth() {

    if [ -e "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"

        if [ -z ${1+x} == "reauth" ]; then
            bashio::log.info "Using Refresh Token to get new Access Token"

            CONF=$(curl -sq "$SENSE_API_URI/renew" --data "user_id=$SENSE_USER_ID" --data "refresh_token=$SENSE_REFRESH_TOKEN")

            bashio::log.info "Got Access Token"
            # TODO need error checking

            SENSE_ACCESS_TOKEN=$(echo "$CONF" | jq -r '.access_token | select( . != null )')
            SENSE_REFRESH_TOKEN=$(echo "$CONF" | jq -r '.refresh_token | select( . != null )')
        else
            bashio::log.info "Using cached Access Token"
        fi

    else
        bashio::log.info "No config file found, requesting Access Token..."
        CONF=$(curl -sq "$SENSE_API_URI/authenticate" --data "email=$SENSE_EMAIL" --data "password=$SENSE_PASSWORD")
        # TODO need error checking
        bashio::log.info "Got Access Token"

        SENSE_USER_ID=$(echo "$CONF" | jq -r '.user_id | select( . != null )')
        SENSE_MONITOR_ID=$(echo "$CONF" | jq -r '.monitors[0].id | select( . != null )')

        SENSE_ACCESS_TOKEN=$(echo "$CONF" | jq -r '.access_token | select( . != null )')
        SENSE_REFRESH_TOKEN=$(echo "$CONF" | jq -r '.refresh_token | select( . != null )')
    fi

    # update config
    echo "SENSE_USER_ID=$SENSE_USER_ID" > "$CONFIG_FILE"
    echo "SENSE_MONITOR_ID=$SENSE_MONITOR_ID" >> "$CONFIG_FILE"
    echo "SENSE_ACCESS_TOKEN=$SENSE_ACCESS_TOKEN" >> "$CONFIG_FILE"
    echo "SENSE_REFRESH_TOKEN=$SENSE_REFRESH_TOKEN" >> "$CONFIG_FILE"
}

realtime() {
    bashio::log.info "Connecting to websocket... (message interval rate: $INTERVAL)"
    URI="$SENSE_WS_URI/$SENSE_MONITOR_ID/realtimefeed?access_token=$SENSE_ACCESS_TOKEN"

    # RE='^[0-9]+$'
    i=0
    count=1
    # max=7
    # websocat -E -t "$URI" 2>/dev/null |
    websocat -v -v -E -t "$URI" |
    while read -r PAYLOAD; do

        TYPE=$(echo "$PAYLOAD" | jq -r '.type | select( . != null )')
        if [ "$TYPE" == "error" ]; then
            ERROR=$(echo "$PAYLOAD" | jq -r '.payload.error_reason | select( . != null )')
            bashio::log.info "ERROR: $ERROR"
            bashio::log.info "Connection closed"
            # break

            if [ "$ERROR" == "Unauthorized" ]; then
                auth reauth
                # need some kind of backoff
                realtime
            elif [ "$ERROR" == "Service Unavailable" ]; then
                # need some kind of backoff
                bashio::log.warn "Unavailable"
            fi

        elif [ "$TYPE" == "realtime_update" ]; then
            if [[ "$i" -eq "0" || "$i" -eq "$INTERVAL" ]]; then
                STATE=$(echo "$PAYLOAD" | jq '.payload.d_w  | select( . != null )')
                # bashio::log.debug "$STATE"

                timestamp=$(date '+%Y-%m-%dT%H:%M:%S')
                data='{"state":"'"$STATE"'", "timestamp":"'"$timestamp"'", "attributes":{"friendly_name":"Sense Realtime Energy Usage", "state_class": "measurement", "unit_of_measurement": "W", "device_class": "energy", "icon": "mdi:flash"}}'
                curl --silent -X POST -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" -H "Content-Type: application/json" "http://supervisor/core/api/states/sensor.sense_realtime_energy_usage" -d "$data" > /dev/null

                i=1
                # if [[ $STATE =~ $RE ]] ; then
                #     echo "$STATE"
                #     i=1
                # fi
                # if [ "$count" -eq "$max" ]; then
                #     break
                # fi
                ((count++))
            else
                ((i++))
            fi
        elif [ "$TYPE" == "hello" ]; then
            bashio::log.info "Connection established"
        else
            bashio::log.info "$PAYLOAD"
        fi
    done
}

auth
realtime

bashio::log.info "Done"
