# arduino hsm

my attempt at building a hardware wallet type thing on an Arduino Uno.

## what this is

Basically the idea is that if you keep a crypto private key on your laptop, anything on your laptop can read it. Hardware wallets (ledger, trezor etc) fix this by keeping the key on a separate device that can *sign* stuff but will never actually hand the key over. I wanted to see if I could build the same idea myself with what I had, which was an Uno and not much else.

So this is what it does:

- you plug the Uno into your mac over usb
- you type a master password in a web page, that unlocks the board
- you can give it private keys and it stores them encrypted on a little memory chip
- you can ask it to sign a message with one of those keys and it sends the signature back
- there is no command to get a key back out. that's kind of the whole point

I'm a first year ECE student so this is more of a learning project than something you'd actually trust with money. See the "stuff that's not great" section at the bottom.

## how it actually works

There's three parts and honestly the hardest bit was getting them to talk to each other.

**the arduino (firmware/arduino_hsm.ino)**

This is where all the important stuff happens. It reads one line of json at a time over serial, figures out what you asked for, and prints one line of json back. I didn't use a json library because the Uno only has 32KB of flash and the ones I looked at were huge, so it just does `strstr` for `"key_id":"` and copies chars until the next quote. Kind of jank but it works and it's tiny.

When you send a password it hashes it with sha256 like 2000 times to turn it into a 32 byte key. That key is the "master key" and it only ever lives in RAM. The board saves a hash of that key in its own internal eeprom so next time it can check if the password you typed is right, without actually storing the key anywhere.

Private keys get encrypted with AES-256 using the master key and written to an external eeprom chip (24LC256, it's like $2). Each key gets a 64 byte slot: 1 byte for "is this slot used", 16 bytes for a name, 32 bytes of encrypted key.

When you ask it to sign, it finds the slot by name, then blinks the LED and waits for you to physically press the button on the breadboard. If you don't press it within 10 seconds it says no. If you do, it reads the 32 encrypted bytes, decrypts them into a buffer, does HMAC-SHA256 over your message with that key, then zeros the buffer. The plaintext key exists for a few milliseconds and never goes near the serial port.

If you unplug the board, RAM is gone, master key is gone, it's locked again.

**the node server (backend/server.js)**

A browser can't open a serial port so this sits in the middle. It finds the arduino automatically (on mac it shows up as /dev/cu.usbmodem something), forwards http requests to it as serial lines, and waits for the reply. One thing I learned is that the Uno can only handle one command at a time, so if the web page sends two things at once it gets confused. The server queues them so they go one after the other.

Also opening the serial port resets the Uno, so the server waits for the board to print its "ready" line before it lets anything through.

**the web page (frontend/)**

Just a react page with a password box, a form to add a key, and a form to sign a message. Nothing fancy. It never sees a private key, it only knows the *names* of the keys on the board.

## parts

- Arduino Uno
- 24LC256 eeprom, the DIP-8 one (8 pins)
- 2x 4.7k resistors for the i2c pullups
- a pushbutton (for approving signatures)
- an LED and a 220 ohm resistor
- breadboard and some jumper wires

## wiring

The notch/dot on the chip is pin 1. Going counterclockwise:

```
chip pin        goes to
1, 2, 3         GND      (these set the i2c address to 0x50)
4               GND
5 (SDA)         A4       + 4.7k up to 5V
6 (SCL)         A5       + 4.7k up to 5V
7 (WP)          GND
8 (VCC)         5V
```

Button: one leg to D2, other leg to GND. The Uno's internal pullup handles the rest.

LED: long leg to D3, short leg through the 220 ohm resistor to GND.

The LED means: off = locked, on = unlocked, blinking = it's waiting for you to press the button.

## getting it running

1. In the Arduino IDE install the "Crypto" library by Rhys Weatherley from the library manager. That's where the SHA256 and AES come from.
2. Open firmware/arduino_hsm.ino, pick Arduino Uno and your port, upload.
3. Open the serial monitor at 9600 baud with "newline" selected and send `{"type":"status"}`. You want to see `"eeprom":true`. If it says false the chip isn't wired right.
4. Close the serial monitor. Only one program can use the port at a time.
5. `cd backend && npm install && npm start`. Wait for it to say `arduino ready`.
6. In another terminal `cd frontend && npm install && npm run build`.
7. Go to http://localhost:3001

If the server grabs the wrong port you can force it with `HSM_PORT=/dev/cu.usbmodem1101 npm start`.

## the serial commands

if you want to poke at it directly from the serial monitor:

```
{"type":"init","password":"whatever123"}
{"type":"store_key","key_id":"test","private_key":"<64 hex chars>"}
{"type":"sign","key_id":"test","message":"hello"}
{"type":"list_keys"}
{"type":"status"}
{"type":"wipe"}        <- erases everything including the password
```

Errors come back as `{"error":"..."}`.

Limits are 16 keys, 15 character names, 99 character messages. Those numbers are mostly because of RAM (the Uno has 2KB, total).

## stuff that's not great

I want to be upfront about this because I learned most of it while building it.

- Real wallets sign with ECDSA on secp256k1, that's what bitcoin and ethereum actually verify. That's way too slow and too big for an Uno so I used HMAC-SHA256 instead. It proves the same thing (the key never leaves the device) but you couldn't send one of these signatures to an actual blockchain.
- The usb link is plain text. The button helps (nothing gets signed unless someone physically presses it) but there's no screen, so you're trusting that the message the laptop sent is the one you meant to sign. A real ledger shows it to you on the device.
- No lockout on wrong passwords, so you could brute force it over serial, slowly.
- AES is in ECB mode which is normally a bad idea. I think it's ok here because the thing being encrypted is 32 random bytes with no pattern in it, but I'm not a cryptographer.
- The Uno has no secure element. Anyone with a programmer can dump the eeprom and attack the password hash on a real computer.

If I did it again on an ESP32 I'd do proper secp256k1 signing, add a little OLED so you can see what you're approving, and encrypt the link to the computer.

## layout

```
firmware/arduino_hsm.ino    the sketch
backend/server.js           express + serialport
frontend/src/               react
```
