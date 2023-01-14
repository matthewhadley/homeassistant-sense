import {createWriteStream} from 'fs'
import Stream from 'stream';
import consoleStamp from 'console-stamp';
import dayjs from 'dayjs';
import WebSocket from 'ws';
import fetch from 'node-fetch';
import fs from 'fs/promises'

// consoleStamp(console, {
//     format: `:date(yyyy-mm-dd HH:MM:ss) :label() :msg()`,
//     tokens: {
//         label: (t) => {
//             return `${t.method.toUpperCase()}`;
//         }
//     }
// } );

const LOG_FILE = "/config/sense.log"
const log = createWriteStream(LOG_FILE, { flags: 'a' });
const logger = new console.Console(log, log);

const stdOutTransform = new Stream.Transform({
    transform(chunk, encoding, callback) {
        process.stdout.write(chunk);
        log.write(chunk);
        callback(null, chunk.toString());
    }
});

const stdErrTransform = new Stream.Transform({
    transform(chunk, encoding, callback) {
        process.stderr.write(chunk);
        log.write(chunk);
        callback(null, chunk.toString());
    }
});

consoleStamp(logger, {
    stdout: stdOutTransform,
    stderr: stdErrTransform,
    format: `:date(yyyy-mm-dd HH:MM:ss) :label() :msg()`,
      tokens: {
          label: (t) => {
              return `${t.method.toUpperCase()}`;
          }
      }
});


const CONFIG_FILE = "/data/sense.conf";

const SENSE_VERSION = process.env.SENSE_VERSION;
const SENSE_EMAIL = process.env.SENSE_EMAIL;
const SENSE_PASSWORD = process.env.SENSE_PASSWORD;
const SENSE_INTERVAL = parseInt(process.env.SENSE_INTERVAL);
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;

logger.info(`Sense ${SENSE_VERSION}`);

const SENSE_API_URI="https://api.sense.com/apiservice/api/v1"
const SENSE_WS_URI="wss://clientrt.sense.com/monitors"

async function auth(reauth) {
    let conf = {};
    try {
        conf = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
    } catch (error) {

    }

    if (conf.access_token && !reauth) {
        logger.info('Using cached Access Token');
        return conf;
    }

    if (conf.refresh_token) {
        logger.info('Requesting new Access Token via Refresh Token');

        const conf = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));

        const params = new URLSearchParams();
        params.append('user_id', conf.user_id);
        params.append('refresh_token', conf.refresh_token);

        const response = await fetch(`${SENSE_API_URI}/renew`, { method: 'POST', body: params });
        const data = await response.json();

        logger.info('Got Access Token');

        conf.access_token = data.access_token;
        conf.refresh_token = data.refresh_token;

        await fs.writeFile(CONFIG_FILE, JSON.stringify(conf));

    } else {
        logger.info('Requesting new Access Token');

        const params = new URLSearchParams();
        params.append('email', SENSE_EMAIL);
        params.append('password', SENSE_PASSWORD);

        const response = await fetch(`${SENSE_API_URI}/authenticate`, {method: 'POST', body: params});
        const data = await response.json();

        logger.info('Got Access Token');

        conf.access_token = data.access_token;
        conf.refresh_token = data.refresh_token;
        conf.user_id = data.user_id;
        conf.monitor_id = data.monitors[0].id;

        await fs.writeFile(CONFIG_FILE, JSON.stringify(conf));
    }

    return conf;
}

const connect = async function (conf) {

    const URI = `${SENSE_WS_URI}/${conf.monitor_id}/realtimefeed?access_token=${conf.access_token}`
    const ws = new WebSocket(URI)

    let i = 0
    logger.info(`Connecting to websocket... (message interval rate: ${SENSE_INTERVAL})`)
    ws.on('close', function(code, reason) {
        logger.warn('Connection Closed');
        logger.warn('Code:', code);
        logger.warn('Reason:', reason.toString());
        logger.warn('Attempting to reconnect');
        setTimeout(async function () {
            let conf = await auth(true);
            connect(conf);
        }, 1000);
    });
    ws.on('error', function(error) {
        logger.warn('Connection Error', error);
    });
    ws.on('open', function open() {
        ws.on('message', async function message(data) {
            data = JSON.parse(data);
            let type = data.type;
            logger.info(type);
            if (type == "hello") {
                logger.info("Connection established");
            } else if (type == "error") {
                const error = data.payload.error_reason;
                logger.error(error);
                if (error === "Unauthorized") {

                } else if (error === "Unavailable") {

                }
            } else if (type === "realtime_update") {
                if (i === SENSE_INTERVAL || i === 0) {
                    // logger.info(data.payload.d_w);
                    const response = await fetch("http://supervisor/core/api/states/sensor.sense_realtime_energy_usage", {
                        method: 'POST',
                        body: JSON.stringify({
                            state: data.payload.d_w,
                            timestamp: dayjs().format('YYYY-MM-DDTHH:mm:ss'),
                            attributes: {
                                friendly_name: "Sense Realtime Energy Usage",
                                state_class: "measurement",
                                unit_of_measurement: "W",
                                device_class: "energy",
                                icon: "mdi: flash"
                            }
                        }),
                        headers: {
                            'Authorization': `Bearer ${SUPERVISOR_TOKEN}`,
                            'Content-Type': 'application/json',

                        }
                    });

                    i = 0;
                }
                i++;
            } else if (type === "monitor_info" || type === "data_change") {
                logger.info(JSON.stringify(data, 0,0));
            } else {
                logger.info(JSON.stringify(data, 0,0));
            }
        });
    });
}

let conf = await auth();
connect(conf);