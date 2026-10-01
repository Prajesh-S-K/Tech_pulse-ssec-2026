import { existsSync, readdirSync } from "node:fs";
import { run, which } from "./common.js";

const IDE_CLI =
  "/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli";
export const arduinoCli = () =>
  process.env.ARDUINO_CLI ||
  which("arduino-cli") ||
  (existsSync(IDE_CLI) ? IDE_CLI : "arduino-cli");
export const DEFAULT_FQBN =
  "esp32:esp32:esp32:UploadSpeed=115200,FlashSize=4M,PartitionScheme=default";
export const fqbn = process.env.ESP32_FQBN || DEFAULT_FQBN;

// USB-serial adapters only: Bluetooth, audio and debug consoles are never candidates.
export function isCandidate(name) {
  return /^cu\.(usbserial|usbmodem|wchusbserial|SLAB_USBtoUART)/i.test(name);
}
export function candidates(list = null) {
  const names =
    list ?? (process.platform === "darwin" ? readdirSync("/dev") : []);
  return names.filter(isCandidate).map((s) => `/dev/${s}`);
}

export function checkPort(port) {
  if (!port || !existsSync(port))
    throw Error("Serial port not found; connect a data-capable USB cable.");
  if (!which("lsof"))
    throw Error("lsof is required to check that the serial port is free.");
  const busy = run("lsof", ["-t", port]);
  if (busy.stdout.trim())
    throw Error(
      "Port is in use by another program (a serial monitor or Arduino IDE?). Close it and retry; nothing was probed.",
    );
}

function esptoolBinary() {
  const base = `${process.env.HOME}/Library/Arduino15/packages/esp32/tools/esptool_py`;
  if (!existsSync(base))
    throw Error(
      "ESP32 core esptool missing; install the ESP32 core in Arduino IDE.",
    );
  const bin = readdirSync(base)
    .sort()
    .reverse()
    .map((v) => `${base}/${v}/esptool`)
    .find(existsSync);
  if (!bin) throw Error("Bundled esptool executable not found.");
  return bin;
}

// Pure parser (unit-tested): decides from esptool output whether this is a plain ESP32.
export function parseChip(text) {
  const chip = /Chip type:\s*(ESP32[-A-Z0-9]*)/i.exec(text)?.[1];
  if (!chip) return { ok: false, reason: "chip type not reported" };
  if (/^ESP32-(S2|S3|C\d|H\d|P\d|E\d)/i.test(chip))
    return { ok: false, chip, reason: `${chip} is not a plain ESP32` };
  if (!/^ESP32(?:$|-(?:D0WD|D0WDQ6|D2WD|PICO|U4WDH|S0WD|SOLO))/i.test(chip))
    return { ok: false, chip, reason: `unrecognised chip ${chip}` };
  return { ok: true, chip };
}
export function parseFlashMB(text) {
  const m = /Detected flash size:\s*(\d+)\s*MB/i.exec(text);
  return m ? Number(m[1]) : null;
}

// Read-only identification (no flash writes). Returns separate facts, never "ok" by default.
export function verifyChip(port) {
  checkPort(port);
  const bin = esptoolBinary();
  const id = run(bin, ["--port", port, "chip-id"], { timeout: 25000 });
  const idText = `${id.stdout || ""}\n${id.stderr || ""}`;
  if (id.status !== 0)
    throw Error(
      "Chip identification failed (check cable, or hold BOOT while retrying). No upload performed.",
    );
  const chip = parseChip(idText);
  if (!chip.ok)
    throw Error(
      `Refusing to flash: ${chip.reason}. This tool only flashes the normal ESP32.`,
    );
  const fl = run(bin, ["--port", port, "flash-id"], { timeout: 25000 });
  const mb = parseFlashMB(`${fl.stdout || ""}\n${fl.stderr || ""}`);
  if (mb !== null && mb < 4)
    throw Error(
      `Refusing to flash: ${mb}MB flash detected; the firmware layout needs 4MB.`,
    );
  return { chip: chip.chip, flashMB: mb };
}
