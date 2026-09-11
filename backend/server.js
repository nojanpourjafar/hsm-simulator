const express = require('express');
const cors = require('cors');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const PORT = 3001;
const BAUD = 9600;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/build')));

let port = null;
let parser = null;
let ready = false;

// the uno handles one command at a time, so chain requests behind each other
let queue = Promise.resolve();

async function findArduino() {
  if (process.env.HSM_PORT) return process.env.HSM_PORT;

  const ports = await SerialPort.list();
  console.log('serial ports:');
  ports.forEach((p) => console.log(`  ${p.path}  ${p.manufacturer || ''}`));

  const hit = ports.find(
    (p) =>
      (p.manufacturer || '').toLowerCase().includes('arduino') ||
      /usbmodem|usbserial|ttyACM|ttyUSB/.test(p.path)
  );
  return hit ? hit.path : null;
}

async function connect() {
  let devPath;
  try {
    devPath = await findArduino();
  } catch (e) {
    console.log('could not list ports:', e.message);
  }

  if (!devPath) {
    console.log('no arduino found, retrying in 5s (or set HSM_PORT=/dev/...)');
    setTimeout(connect, 5000);
    return;
  }

  port = new SerialPort({ path: devPath, baudRate: BAUD });
  parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  parser.on('data', (l) => console.log('  <-', l.trim()));

  port.on('open', () => {
    console.log(`opened ${devPath}, waiting for board to boot`);
    // opening the port resets the uno, give it a moment
    const bootTimer = setTimeout(() => (ready = true), 3000);
    parser.once('data', () => {
      clearTimeout(bootTimer);
      ready = true;
      console.log('arduino ready');
    });
  });

  port.on('error', (e) => console.log('serial error:', e.message));

  port.on('close', () => {
    console.log('serial closed, reconnecting');
    ready = false;
    port = null;
    setTimeout(connect, 3000);
  });
}

function send(cmd, timeout = 4000) {
  const run = () =>
    new Promise((resolve, reject) => {
      if (!ready || !port) return reject(new Error('arduino not connected'));

      const onLine = (l) => {
        let msg;
        try {
          msg = JSON.parse(l);
        } catch {
          return; // not for us, keep listening
        }
        if (msg.status === 'confirm') return; // board is waiting on the button, keep waiting too
        clearTimeout(timer);
        parser.off('data', onLine);
        resolve(msg);
      };

      const timer = setTimeout(() => {
        parser.off('data', onLine);
        reject(new Error('arduino did not respond'));
      }, timeout);

      parser.on('data', onLine);
      console.log('  ->', JSON.stringify(cmd));
      port.write(JSON.stringify(cmd) + '\n');
    });

  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

async function forward(res, cmd, timeout) {
  try {
    const r = await send(cmd, timeout);
    res.status(r.error ? 400 : 200).json(r);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
}

app.get('/api/status', (req, res) => {
  res.json({ server: 'running', arduino_connected: ready, platform: 'Arduino Uno HSM' });
});

app.post('/api/hsm/init', (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  forward(res, { type: 'init', password });
});

app.post('/api/hsm/store-key', (req, res) => {
  let { key_id, private_key } = req.body || {};
  if (!key_id || !private_key) {
    return res.status(400).json({ error: 'key_id and private_key are required' });
  }
  private_key = private_key.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(private_key)) {
    return res.status(400).json({ error: 'private_key must be 64 hex characters' });
  }
  if (key_id.length > 15 || /[^A-Za-z0-9_-]/.test(key_id)) {
    return res.status(400).json({ error: 'key_id: max 15 chars, letters/digits/_/- only' });
  }
  forward(res, { type: 'store_key', key_id, private_key });
});

app.post('/api/hsm/sign', (req, res) => {
  const { key_id, message } = req.body || {};
  if (!key_id || !message) {
    return res.status(400).json({ error: 'key_id and message are required' });
  }
  if (message.length > 99 || /["\\\n]/.test(message)) {
    return res.status(400).json({ error: 'message: max 99 chars, no quotes or backslashes' });
  }
  // signing waits for a button press on the board, give it longer
  forward(res, { type: 'sign', key_id, message }, 14000);
});

app.get('/api/hsm/keys', (req, res) => forward(res, { type: 'list_keys' }));
app.get('/api/hsm/device', (req, res) => forward(res, { type: 'status' }));
app.post('/api/hsm/wipe', (req, res) => forward(res, { type: 'wipe' }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

app.listen(PORT, () => {
  console.log(`hsm backend on http://localhost:${PORT}`);
  connect();
});

process.on('SIGINT', () => {
  if (port && port.isOpen) port.close();
  process.exit(0);
});
