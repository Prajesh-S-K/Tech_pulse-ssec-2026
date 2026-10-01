import { randomBytes } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const file = join(root, "private/presence.json");
let cfg;
if (existsSync(file)) {
  cfg = JSON.parse(readFileSync(file, "utf8"));
  console.log("Reusing the existing device configuration.");
} else {
  cfg = {
    deviceId: arg("--device-id", "ssec-room-1"),
    roomId: arg("--room-id", "room-1"),
    ssid: arg("--ssid", "TechPulse-Classroom"),
    wifiPassword: randomBytes(8).toString("hex"),
    secret: randomBytes(32).toString("hex"),
  };
  if (
    !/^[\w-]{1,32}$/.test(cfg.deviceId) ||
    !/^[\w-]{1,64}$/.test(cfg.roomId) ||
    Buffer.byteLength(cfg.ssid) > 32 ||
    !cfg.ssid.length
  )
    throw Error("Invalid device, room, or SSID");
  mkdirSync(join(root, "private"), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}
const cpp = (v) => JSON.stringify(v);
writeFileSync(
  join(root, "firmware/TECH_PULSE_COMPANION/config.h"),
  `// Generated locally. Never commit this file.\n#pragma once\nstatic const char* DEVICE_ID = ${cpp(cfg.deviceId)};\nstatic const char* AP_SSID = ${cpp(cfg.ssid)};\nstatic const char* AP_PASSWORD = ${cpp(cfg.wifiPassword)};\nstatic const char* PROOF_SECRET = ${cpp(cfg.secret)};\n`,
  { mode: 0o600 },
);
console.log(
  `Ready: device ${cfg.deviceId}, room ${cfg.roomId}, Wi-Fi ${cfg.ssid}.`,
);
console.log(
  "Wi-Fi password is in private/presence.json. Shared signing key is installed in config.h.",
);
