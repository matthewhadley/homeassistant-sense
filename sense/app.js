import dayjs from "dayjs";
import WebSocket from "ws";
import fetch from "node-fetch";
import fs from "fs/promises";

const CONFIG_FILE = process.env.SENSE_CONFIG_FILE || "/data/sense.conf";

const SENSE_VERSION = process.env.SENSE_VERSION;
const SENSE_EMAIL = process.env.SENSE_EMAIL;
const SENSE_PASSWORD = process.env.SENSE_PASSWORD;
const SENSE_INTERVAL = parseInt(process.env.SENSE_INTERVAL);
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;
const DEBUG = process.env.SENSE_DEBUG === "true";
const DEBUG_DISABLE_HA = process.env.SENSE_DISABLE_HA === "true"

const SENSE_API_URI = "https://api.sense.com/apiservice/api/v1";
const SENSE_WS_URI = "wss://clientrt.sense.com/monitors";
const SENSE_TIMEOUT = ((parseInt(process.env.SENSE_TIMEOUT) || 120) * 1000);

const logger = function (level, message) {
  let timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  console.log(`[${timestamp}] ${level}: ${message}`);
};
logger.info = function (message) {
  logger("INFO", message);
};
logger.warn = function (message) {
  logger("WARN", message);
};
logger.error = function (message) {
  logger("ERROR", message);
};
logger.debug = function (message) {
  if (DEBUG) {
    logger("DEBUG", message);
  }
};

logger.info(`Sense ${SENSE_VERSION}`);

// handle authenticating to websocket API
async function auth(reauth) {
  let conf = {};
  try {
    conf = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));
  } catch (error) {}

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

    logger.info("Got Access Token");

    conf.access_token = data.access_token;
    conf.refresh_token = data.refresh_token;
    conf.user_id = data.user_id;
    conf.monitor_id = data.monitors[0].id;

    await fs.writeFile(CONFIG_FILE, JSON.stringify(conf));
  }

  return conf;
}

// save previous recorded state so that only record new entries in cases
// where sense api is not reporting (new) values
let lastRecordedState = {
  value: null,
  timestamp: null
};

// post data to homeassistant
async function recordEnergyUsage(data) {
  if (!data.value) {
    return;
  }
  if (lastRecordedState.timestamp === data.timestamp) {
    return;
  }

  let devices = data.devices.reduce((result, device) => {
    result[device.name.toLowerCase().replace(/\s+/g, '_')] = (device.w).toFixed(0);
    return result;
  }, {});

  logger.debug(JSON.stringify(devices, 0,0));
  if (DEBUG_DISABLE_HA !== true) {
    try {
      const response = await fetch(
        "http://supervisor/core/api/states/sensor.sense_realtime_power",
        {
          method: "POST",
          body: JSON.stringify({
            state: data.value,
            // not needed?
            // timestamp: dayjs().format('YYYY-MM-DDTHH:mm:ss'),
            attributes: {
              friendly_name: "Sense Realtime Power",
              state_class: "measurement",
              unit_of_measurement: "W",
              device_class: "power",
              icon: "mdi:flash",
              devices: devices
            },
          }),
          headers: {
            Authorization: `Bearer ${SUPERVISOR_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );
      logger.debug(`${data.value} (recorded)`);
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
    value: null,
    timestamp: null,
    epoch: null
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
      if ((sense_data.epoch + SENSE_TIMEOUT) < now) {
        logger.debug(`Sense data timeout detected (${((now - sense_data.epoch)/1000)} seconds), restarting connection`);
        return ws.terminate();
      } else {
        logger.debug(`Sense data rate good (${((now - sense_data.epoch)/1000)} seconds)`);
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
        sense_data = {
          value: data.payload.d_w,
          devices: data.payload.devices,
          timestamp: dayjs().format('YYYY-MM-DDTHH:mm:ss'),
          epoch: Date.now()
        };
        logger.debug(data.payload.d_w);
        // logger.debug(JSON.stringify(data.payload, 0,0));
      }
      // } else if (type === "monitor_info" || type === "data_change" || type === "device_states" || type === "new_timeline_event" || type === "recent_history") {
      //     logger.debug(type);
      //     logger.debug(JSON.stringify(data, 0,0));
      // } else {
      //     logger.debug(type);
      //     logger.debug(JSON.stringify(data, 0,0));
      // }
    });
  });
};

let conf = await auth();
connect(conf);
