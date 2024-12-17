import dayjs from "dayjs";
import WebSocket from "ws";
import fetch from "node-fetch";
import fs from "fs/promises";

const CONFIG_FILE = process.env.SENSE_CONFIG_FILE || "/data/sense.conf";

const SENSE_VERSION = process.env.SENSE_VERSION || 'dev';
const SENSE_EMAIL = process.env.SENSE_EMAIL;
const SENSE_PASSWORD = process.env.SENSE_PASSWORD;
const SENSE_INTERVAL = parseInt(process.env.SENSE_INTERVAL);
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;
const DEBUG = process.env.SENSE_DEBUG === "true";
const DEBUG_DISABLE_HA = process.env.SENSE_DISABLE_HA === "true"

const SENSE_API_URI = "https://api.sense.com/apiservice/api/v1";
const SENSE_WS_URI = "wss://clientrt.sense.com/monitors";
const SENSE_TIMEOUT = ((parseInt(process.env.SENSE_TIMEOUT) || 120) * 1000);
const SENSE_AUTH_RETRY_TIMEOUT = 60;

const logger = function (level, ...messages) {
  let timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");

  let combinedMessage = messages
    .map(message => {
      if (message instanceof Error) {
        return message.stack.replace('Error: ','').replaceAll('\n    ',' ');
      } else if (typeof message === "object") {
        return JSON.stringify(message);
      } else {
        return message;
      }
    })
    .join(" ");

  console.log(`[${timestamp}] ${level}: ${combinedMessage}`);
};

logger.info = function (...messages) {
  logger("INFO", ...messages);
};
logger.warn = function (...messages) {
  logger("WARN", ...messages);
};
logger.error = function (...messages) {
  logger("ERROR", ...messages);
};
logger.debug = function (...messages) {
  if (DEBUG) {
    logger("DEBUG", ...messages);
  }
};

logger.info(`Sense ${SENSE_VERSION}`);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// handle authenticating to websocket API
async function auth(reauth) {
  let conf = {};
  try {
    conf = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));
  } catch (error) {
    logger.info("No cached Access Token found");
  }

  try {
    if (conf.access_token && !reauth) {
      logger.info("Using cached Access Token");
      return conf;
    }

    if (conf.refresh_token) {
      logger.info("Requesting new Access Token via Refresh Token");

      const conf = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));

      const params = new URLSearchParams();
      params.append("user_id", conf.user_id);
      params.append("refresh_token", conf.refresh_token);

      const response = await fetch(`${SENSE_API_URI}/renew`, {
        method: "POST",
        body: params,
      });
      const data = await response.json();

      logger.info("Got Access Token");

      conf.access_token = data.access_token;
      conf.refresh_token = data.refresh_token;

      await fs.writeFile(CONFIG_FILE, JSON.stringify(conf));
    } else {
      logger.info("Requesting new Access Token");

      const params = new URLSearchParams();
      params.append("email", SENSE_EMAIL);
      params.append("password", SENSE_PASSWORD);

      const response = await fetch(`${SENSE_API_URI}/authenticate`, {
        method: "POST",
        body: params,
      });
      const data = await response.json();

      if (data.status && data.status === "error") {
        throw new Error(`Error fetching Access Token - ${data.error_reason}`);
      }

      logger.info("Got Access Token");
      conf.access_token = data.access_token;
      conf.refresh_token = data.refresh_token;
      conf.user_id = data.user_id;
      conf.monitor_id = data.monitors[0].id;

      await fs.writeFile(CONFIG_FILE, JSON.stringify(conf));
    }
    return conf;
  } catch (error) {
    logger.error(error);
    logger.warn(`Attempting to re-auth in ${SENSE_AUTH_RETRY_TIMEOUT} seconds...`);
    await delay((SENSE_AUTH_RETRY_TIMEOUT * 1000));
    return auth(reauth);
  }
}

// save previous recorded state so that only record new entries in cases
// where sense api is not reporting (new) values
let lastRecordedState = {
  state: null,
  timestamp: null
};

// post data to homeassistant
async function recordEnergyUsage(data) {
  if (!data.state) {
    return;
  }
  if (lastRecordedState.timestamp === data.timestamp) {
    return;
  }
  if (DEBUG_DISABLE_HA !== true) {
    try {
      const response = await fetch(
        "http://supervisor/core/api/states/sensor.sense_realtime_power",
        {
          method: "POST",
          body: JSON.stringify({
            state: data.state,
            // not needed?
            // timestamp: dayjs().format('YYYY-MM-DDTHH:mm:ss'),
            attributes: {
              friendly_name: "Sense Realtime Power",
              state_class: "measurement",
              unit_of_measurement: "W",
              device_class: "power",
              icon: "mdi:flash",
              devices: data.devices,
              voltage: data.voltage
            },
          }),
          headers: {
            Authorization: `Bearer ${SUPERVISOR_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );
      logger.debug(data.state, data.devices, '(recorded)');
      lastRecordedState = data;
    } catch (error) {
      console.log(error);
    }
  }
}

// connect to sense websocket API
const connect = async function (conf) {
  logger.info('Connecting to websocket...');

  const URI = `${SENSE_WS_URI}/${conf.monitor_id}/realtimefeed?access_token=${conf.access_token}`;
  const ws = new WebSocket(URI);

  let sense_data = {
    state: null,
    timestamp: null
  };
  ws.isAlive = false;
  let recordIntervalFn;
  let pingIntervalFn;
  const pingInterval = 30000;

  // acknowledge pong events as meaning the websocket connect is alive
  ws.on("pong", function () {
    logger.debug("pong");
    ws.isAlive = true;
  });

  // cleanup on websocket close, then attempt to reconnect
  ws.on("close", function (code, reason) {
    clearInterval(pingIntervalFn);
    clearInterval(recordIntervalFn);
    logger.warn("Connection Closed");
    logger.warn(`Code: ${code}`);
    logger.warn(`Reason: ${reason.toString()}`);
    logger.warn("Attempting to reconnect");
    setTimeout(async function () {
      let conf = await auth(true);
      connect(conf);
    }, 5000);
  });

  ws.on("error", function (error) {
    logger.warn(`Error: ${error}`);
  });

  ws.on("open", function open() {
    // begin reording interval
    recordIntervalFn = setInterval(async function report() {
      recordEnergyUsage(sense_data);
    }, (SENSE_INTERVAL * 1000));

    // begin ping/pong interval to ensure websocket connection stays alive
    ws.isAlive = true;
    pingIntervalFn = setInterval(function ping() {
      if (ws.isAlive === false) {
        logger.debug("pong timeout");
        return ws.terminate();
      }
      ws.isAlive = false;
      logger.debug("ping");

      let now = Date.now();
      if ((sense_data.timestamp + SENSE_TIMEOUT) < now) {
        logger.debug(`Sense data timeout detected (${((now - sense_data.timestamp)/1000)} seconds), restarting connection`);
        return ws.terminate();
      } else {
        logger.debug(`Sense data rate good (${((now - sense_data.timestamp)/1000)} seconds)`);
      }
      ws.ping();
    }, pingInterval);

    // process messages
    ws.on("message", async function message(data) {
      data = JSON.parse(data);
      let type = data.type;
      // logger.info(type);
      if (type == "hello") {
        logger.info("Connection established");
      } else if (type == "error") {
        const error = data.payload.error_reason;
        logger.error(error);
        if (error === "Unauthorized") {
        } else if (error === "Unavailable") {
        }
      } else if (type === "realtime_update") {
        let now = Date.now();
        sense_data = {
          state: data.payload.d_w,
          devices: data.payload.devices.reduce((result, device) => {
            result[device.name.toLowerCase().replace(/\s+/g, '_')] = parseInt((device.w));
            return result;
          }, {}),
          voltage: {
            l1: parseFloat(data.payload.voltage[0].toFixed(1)),
            l2: parseFloat(data.payload.voltage[1].toFixed(1))
          },
          timestamp: now,
          // timestamp: dayjs(now).format('YYYY-MM-DDTHH:mm:ss'),
        };
        // logger.debug(data.payload);
        // logger.debug(sense_data);
        logger.debug(sense_data.state);
      }
      // } else if (type === "monitor_info" || type === "data_change" || type === "device_states" || type === "new_timeline_event" || type === "recent_history") {
      //     logger.debug(type);
      //     logger.debug(data);
      // } else {
      //     logger.debug(type);
      //     logger.debug(data);
      // }
    });
  });
};

let conf = await auth();
connect(conf);
