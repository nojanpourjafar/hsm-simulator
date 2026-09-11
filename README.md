# Arduino Uno HSM

A small hardware security module built on an Arduino Uno. Private keys are stored
AES-256 encrypted on an external 24LC256 EEPROM, unlocked with a master password,
and used to sign messages with HMAC-SHA256. The plaintext key only ever exists in
the Uno's RAM for the few milliseconds it takes to sign, and it never goes back
out over USB.

There's a Node.js bridge that talks to the board over serial and a React page
for storing keys and requesting signatures.

```
React page  --HTTP-->  Node bridge  --USB serial-->  Arduino Uno  --I2C-->  24LC256
                                                     (AES, HMAC)            (encrypted keys)
```

## Why an Uno

I only had an Uno. It has 2 KB of RAM and 32 KB of flash, so the firmware has to
be careful: no JSON library, all string literals kept in flash with `F()`, keys
handled as raw bytes instead of hex strings wherever possible. Getting SHA-256,
AES-256 and an I2C EEPROM driver to fit comfortably was most of the work.

## Parts

| Part | Notes |
|------|-------|
| Arduino Uno | |
| 24LC256 EEPROM (DIP-8) | 32 KB, I2C, about $2 |
| 2 x 4.7 kΩ resistors | I2C pull-ups |
| Breadboard + jumpers | |

### Wiring

```
24LC256 pin   ->  Uno
1,2,3 (A0-A2) ->  GND        (sets address 0x50)
4 (GND)       ->  GND
5 (SDA)       ->  A4   + 4.7k to 5V
6 (SCL)       ->  A5   + 4.7k to 5V
7 (WP)        ->  GND
8 (VCC)       ->  5V
```

The notch/dot on the chip marks pin 1.

## Setup

**Firmware**

1. Arduino IDE > Library Manager > install **Crypto** by Rhys Weatherley.
2. Open `firmware/arduino_hsm.ino`, select Arduino Uno and its port, upload.
3. Open Serial Monitor at 9600 baud. You should see `{"status":"hsm_ready",...}`.
   Type `{"type":"status"}` and check `"eeprom":true` — if it's false the wiring is off.
4. Close Serial Monitor before running the backend (only one program can hold the port).

**Backend**

```
cd backend
npm install
npm start
```

It scans for the board automatically. If it picks the wrong port, run
`HSM_PORT=/dev/cu.usbmodem1101 npm start` (or whatever `ls /dev/cu.*` shows on macOS).

**Frontend**

```
cd frontend
npm install
npm run build
```

Then open http://localhost:3001. The backend serves the built page.

## Serial protocol

One JSON object per line, one reply per line.

| Command | Reply |
|---------|-------|
| `{"type":"init","password":"..."}` | `{"status":"unlocked"}` — sets the password on first use, verifies it afterwards |
| `{"type":"store_key","key_id":"eth_main","private_key":"<64 hex>"}` | `{"status":"stored","key_id":"eth_main"}` |
| `{"type":"sign","key_id":"eth_main","message":"..."}` | `{"status":"signed","key_id":"eth_main","signature":"<64 hex>"}` |
| `{"type":"list_keys"}` | `{"keys":["eth_main"]}` |
| `{"type":"status"}` | `{"status":"online","unlocked":false,"initialized":true,"eeprom":true,...}` |
| `{"type":"wipe"}` | `{"status":"wiped"}` — erases keys and password |

Errors come back as `{"error":"..."}`.

## How the storage works

- The master password is hashed with SHA-256 and re-hashed 2000 times to get a
  32-byte master key. A hash of *that* is saved in the Uno's internal EEPROM so
  the board can check the password later without storing the key itself.
- Each private key (32 bytes) is encrypted with AES-256 under the master key and
  written to a 64-byte slot on the 24LC256 along with a 15-char ID.
- On `sign`, the slot is read, decrypted into RAM, used for HMAC, and zeroed.
- Power cycling the board locks it again; the master key is only ever in RAM.

Limits: 16 key slots, 15-char IDs, 99-char messages.

## Known limitations

This is a learning project, not a real Ledger.

- HMAC-SHA256 isn't what blockchains use for transaction signatures; that would
  be ECDSA on secp256k1, which is too slow/large for an Uno to do well. HMAC
  demonstrates the same "sign inside the device" property.
- The USB serial link is plaintext, so someone with your laptop and your password
  can request signatures. That's the same threat model as any USB hardware wallet
  without a screen for confirmation.
- Password check has no lockout, so it's brute-forceable over serial (slowly).
- AES is used in ECB mode. That's acceptable here only because the plaintext is
  32 bytes of random key material with no structure to leak.
- The Uno has no secure element; anyone with a programmer can dump the EEPROM
  and attack the password hash offline.

Things I'd do on an ESP32: proper secp256k1 signing, a button to confirm each
signature, and encrypting the host link.

## Layout

```
firmware/arduino_hsm.ino    Uno sketch
backend/server.js           express + serialport bridge
frontend/src/               React UI
```
