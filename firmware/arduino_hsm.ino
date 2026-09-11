// Arduino Uno HSM
// Nojan Pourjafar, 2026
//
// Private keys live encrypted on a 24LC256 eeprom. The host sends a message
// over serial, the Uno signs it with HMAC-SHA256 and sends the signature back.
// The raw key never gets written to serial.
//
// Wiring (24LC256 DIP-8):
//   pin 1,2,3 (A0,A1,A2) -> GND     address 0x50
//   pin 4 (GND)          -> GND
//   pin 5 (SDA)          -> A4      4.7k pullup to 5V
//   pin 6 (SCL)          -> A5      4.7k pullup to 5V
//   pin 7 (WP)           -> GND
//   pin 8 (VCC)          -> 5V
//
// Needs the "Crypto" library by Rhys Weatherley (Library Manager).

#include <Wire.h>
#include <EEPROM.h>
#include <SHA256.h>
#include <AES.h>

#define EXT_ADDR   0x50
#define SLOT_SIZE  64
#define MAX_KEYS   16
#define MAGIC      0x5A
#define KDF_ROUNDS 2000

// internal eeprom: [0] magic, [1..32] sha256 of the master password
// external eeprom, one 64 byte slot per key:
//   [0] used flag, [1..16] key id (null terminated), [17..48] aes256 encrypted key

char    line[200];
uint8_t lineLen = 0;

bool    unlocked = false;
uint8_t masterKey[32];

SHA256 sha;
AES256 aes;

// ---- external eeprom -------------------------------------------------------

void extWrite(uint16_t addr, const uint8_t *data, uint8_t len) {
  // wire buffer is 32 bytes and 2 of those are the address, so chunk it
  while (len) {
    uint8_t n = len > 16 ? 16 : len;
    Wire.beginTransmission(EXT_ADDR);
    Wire.write(addr >> 8);
    Wire.write(addr & 0xFF);
    Wire.write(data, n);
    Wire.endTransmission();
    delay(6);
    addr += n;
    data += n;
    len  -= n;
  }
}

void extRead(uint16_t addr, uint8_t *out, uint8_t len) {
  Wire.beginTransmission(EXT_ADDR);
  Wire.write(addr >> 8);
  Wire.write(addr & 0xFF);
  Wire.endTransmission();
  Wire.requestFrom((uint8_t)EXT_ADDR, len);
  for (uint8_t i = 0; i < len && Wire.available(); i++) out[i] = Wire.read();
}

bool extPresent() {
  Wire.beginTransmission(EXT_ADDR);
  return Wire.endTransmission() == 0;
}

// ---- small helpers ---------------------------------------------------------

int8_t hexVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool hexToBytes(const char *hex, uint8_t *out, uint8_t n) {
  for (uint8_t i = 0; i < n; i++) {
    int8_t hi = hexVal(hex[i * 2]);
    int8_t lo = hexVal(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = (hi << 4) | lo;
  }
  return hex[n * 2] == 0;
}

void printHex(const uint8_t *b, uint8_t n) {
  const char *digits = "0123456789abcdef";
  for (uint8_t i = 0; i < n; i++) {
    Serial.write(digits[b[i] >> 4]);
    Serial.write(digits[b[i] & 0x0F]);
  }
}

// pull "key":"value" out of the current line, no json lib to save flash
bool field(const char *key, char *out, uint8_t max) {
  char pat[24];
  snprintf(pat, sizeof(pat), "\"%s\":\"", key);
  char *p = strstr(line, pat);
  if (!p) return false;
  p += strlen(pat);
  uint8_t i = 0;
  while (*p && *p != '"' && i < max - 1) out[i++] = *p++;
  out[i] = 0;
  return true;
}

bool isType(const char *t) {
  char buf[16];
  return field("type", buf, sizeof(buf)) && strcmp(buf, t) == 0;
}

void err(const __FlashStringHelper *msg) {
  Serial.print(F("{\"error\":\""));
  Serial.print(msg);
  Serial.println(F("\"}"));
}

// ---- password handling -----------------------------------------------------

// stretch the password a bit so brute forcing the stored hash is slower.
// not pbkdf2 but it's the same idea and it fits.
void deriveKey(const char *pw, uint8_t *out) {
  sha.reset();
  sha.update(pw, strlen(pw));
  sha.finalize(out, 32);
  for (uint16_t i = 0; i < KDF_ROUNDS; i++) {
    sha.reset();
    sha.update(out, 32);
    sha.update(pw, strlen(pw));
    sha.finalize(out, 32);
  }
}

void hashKey(const uint8_t *key, uint8_t *out) {
  sha.reset();
  sha.update(key, 32);
  sha.finalize(out, 32);
}

// ---- slot lookup -----------------------------------------------------------

int8_t findSlot(const char *id) {
  uint8_t hdr[17];
  for (uint8_t i = 0; i < MAX_KEYS; i++) {
    extRead(i * SLOT_SIZE, hdr, 17);
    if (hdr[0] != 1) continue;
    hdr[16] = 0;
    if (strcmp((char *)hdr + 1, id) == 0) return i;
  }
  return -1;
}

int8_t freeSlot() {
  uint8_t flag;
  for (uint8_t i = 0; i < MAX_KEYS; i++) {
    extRead(i * SLOT_SIZE, &flag, 1);
    if (flag != 1) return i;
  }
  return -1;
}

// ---- commands --------------------------------------------------------------

void cmdInit() {
  char pw[48];
  if (!field("password", pw, sizeof(pw)) || strlen(pw) < 8) {
    err(F("password too short"));
    return;
  }

  uint8_t candidate[32], check[32];
  deriveKey(pw, candidate);
  hashKey(candidate, check);

  if (EEPROM.read(0) == MAGIC) {
    // already set up, compare against what we stored
    for (uint8_t i = 0; i < 32; i++) {
      if (EEPROM.read(1 + i) != check[i]) {
        memset(candidate, 0, 32);
        err(F("wrong password"));
        return;
      }
    }
  } else {
    // first boot, save the hash
    for (uint8_t i = 0; i < 32; i++) EEPROM.update(1 + i, check[i]);
    EEPROM.update(0, MAGIC);
  }

  memcpy(masterKey, candidate, 32);
  memset(candidate, 0, 32);
  unlocked = true;
  Serial.println(F("{\"status\":\"unlocked\"}"));
}

void cmdStore() {
  if (!unlocked) { err(F("locked")); return; }

  char id[16], hex[66];
  if (!field("key_id", id, sizeof(id)) || !id[0]) { err(F("missing key_id")); return; }
  if (!field("private_key", hex, sizeof(hex))) { err(F("missing private_key")); return; }

  uint8_t raw[32];
  if (!hexToBytes(hex, raw, 32)) { err(F("private_key must be 64 hex chars")); return; }

  if (findSlot(id) >= 0) { err(F("key_id already exists")); return; }
  int8_t slot = freeSlot();
  if (slot < 0) { err(F("no free slots")); return; }

  // 32 byte key is exactly two aes blocks
  uint8_t enc[32];
  aes.setKey(masterKey, 32);
  aes.encryptBlock(enc, raw);
  aes.encryptBlock(enc + 16, raw + 16);
  memset(raw, 0, 32);

  uint8_t hdr[17] = {0};
  hdr[0] = 1;
  strncpy((char *)hdr + 1, id, 15);

  uint16_t base = slot * SLOT_SIZE;
  extWrite(base, hdr, 17);
  extWrite(base + 17, enc, 32);

  Serial.print(F("{\"status\":\"stored\",\"key_id\":\""));
  Serial.print(id);
  Serial.println(F("\"}"));
}

void cmdSign() {
  if (!unlocked) { err(F("locked")); return; }

  char id[16], msg[100];
  if (!field("key_id", id, sizeof(id))) { err(F("missing key_id")); return; }
  if (!field("message", msg, sizeof(msg)) || !msg[0]) { err(F("missing message")); return; }

  int8_t slot = findSlot(id);
  if (slot < 0) { err(F("key not found")); return; }

  uint8_t enc[32], key[32], sig[32];
  extRead(slot * SLOT_SIZE + 17, enc, 32);

  aes.setKey(masterKey, 32);
  aes.decryptBlock(key, enc);
  aes.decryptBlock(key + 16, enc + 16);

  sha.resetHMAC(key, 32);
  sha.update(msg, strlen(msg));
  sha.finalizeHMAC(key, 32, sig, 32);
  memset(key, 0, 32);

  Serial.print(F("{\"status\":\"signed\",\"key_id\":\""));
  Serial.print(id);
  Serial.print(F("\",\"signature\":\""));
  printHex(sig, 32);
  Serial.println(F("\"}"));
}

void cmdList() {
  uint8_t hdr[17];
  bool first = true;
  Serial.print(F("{\"keys\":["));
  for (uint8_t i = 0; i < MAX_KEYS; i++) {
    extRead(i * SLOT_SIZE, hdr, 17);
    if (hdr[0] != 1) continue;
    hdr[16] = 0;
    if (!first) Serial.print(',');
    Serial.print('"');
    Serial.print((char *)hdr + 1);
    Serial.print('"');
    first = false;
  }
  Serial.println(F("]}"));
}

void cmdStatus() {
  Serial.print(F("{\"status\":\"online\",\"unlocked\":"));
  Serial.print(unlocked ? F("true") : F("false"));
  Serial.print(F(",\"initialized\":"));
  Serial.print(EEPROM.read(0) == MAGIC ? F("true") : F("false"));
  Serial.print(F(",\"eeprom\":"));
  Serial.print(extPresent() ? F("true") : F("false"));
  Serial.println(F(",\"platform\":\"Arduino Uno\"}"));
}

// factory reset. wipes the slots and the password so you can start over.
void cmdWipe() {
  uint8_t zero = 0;
  for (uint8_t i = 0; i < MAX_KEYS; i++) extWrite(i * SLOT_SIZE, &zero, 1);
  EEPROM.update(0, 0);
  memset(masterKey, 0, 32);
  unlocked = false;
  Serial.println(F("{\"status\":\"wiped\"}"));
}

void handle() {
  if      (isType("init"))      cmdInit();
  else if (isType("store_key")) cmdStore();
  else if (isType("sign"))      cmdSign();
  else if (isType("list_keys")) cmdList();
  else if (isType("status"))    cmdStatus();
  else if (isType("wipe"))      cmdWipe();
  else                          err(F("unknown command"));
}

// ---- main ------------------------------------------------------------------

void setup() {
  Serial.begin(9600);
  Wire.begin();
  delay(500);
  Serial.println(F("{\"status\":\"hsm_ready\",\"platform\":\"Arduino Uno\"}"));
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      line[lineLen] = 0;
      if (lineLen) handle();
      lineLen = 0;
    } else if (c != '\r' && lineLen < sizeof(line) - 1) {
      line[lineLen++] = c;
    }
  }
}
