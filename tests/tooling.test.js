import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseChip,
  parseFlashMB,
  candidates,
  isCandidate,
} from "../scripts/lib/serial.js";
import { checkServiceAccount } from "../scripts/lib/serviceAccount.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
// A plain file stands in for an idle serial device in the dry run.
const fakePort = join(mkdtempSync(join(tmpdir(), "tp-port-")), "cu.fake");
writeFileSync(fakePort, "");

test("chip parsing accepts plain ESP32 variants only", () => {
  const ok = [
    "Chip type:          ESP32-D0WD-V3 (revision v3.1)",
    "Chip type: ESP32-D0WDQ6 (revision v1.0)",
    "Chip type: ESP32-PICO-D4 (revision v1.1)",
    "Chip type: ESP32-D2WD",
  ];
  for (const t of ok) assert.equal(parseChip(t).ok, true, t);
  const refused = [
    "Chip type: ESP32-S3 (QFN56) (revision v0.2)",
    "Chip type: ESP32-S2",
    "Chip type: ESP32-C3 (revision v0.4)",
    "Chip type: ESP32-C6",
    "Chip type: ESP32-H2",
    "Chip type: ESP8266EX",
    "no chip information at all",
  ];
  for (const t of refused) assert.equal(parseChip(t).ok, false, t);
});

test("flash size parsing", () => {
  assert.equal(parseFlashMB("Detected flash size: 4MB"), 4);
  assert.equal(parseFlashMB("Detected flash size: 2 MB"), 2);
  assert.equal(parseFlashMB("nothing"), null);
});

test("serial candidates exclude Bluetooth, audio and debug ports", () => {
  const list = [
    "cu.Bluetooth-Incoming-Port",
    "cu.debug-console",
    "cu.soundcoreLifeQ30",
    "cu.usbserial-110",
    "cu.usbmodem1101",
    "tty.usbserial-110",
  ];
  assert.deepEqual(candidates(list), [
    "/dev/cu.usbserial-110",
    "/dev/cu.usbmodem1101",
  ]);
  assert.equal(isCandidate("cu.Bluetooth-Incoming-Port"), false);
});

test("every upload path verifies the chip; aliases route through the safe script", () => {
  const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));
  for (const name of Object.keys(pkg.scripts).filter((n) =>
    n.startsWith("esp32:upload"),
  ))
    assert.match(pkg.scripts[name], /esp32-upload\.js/, name);
  const compile = readFileSync(root + "scripts/compile-companion.js", "utf8");
  assert.ok(compile.indexOf("verifyChip(port)") > 0);
  assert.ok(compile.indexOf("verifyChip(port)") < compile.indexOf('"upload"'));
  assert.doesNotMatch(compile, /erase|--no-stub|filesystem|spiffs|littlefs/i);
});

test("esp32:upload --dry-run reports stages and never probes, compiles or writes", () => {
  const r = spawnSync(
    process.execPath,
    ["scripts/esp32-upload.js", "--dry-run", fakePort],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.match(r.stdout, /\[1\/5\] Discovery/);
  assert.match(r.stdout, /Chip verification: not run \(dry run\)/);
  assert.match(r.stdout, /Flash: not run/);
});

test("phone launcher stops with install guidance when mkcert/caddy are missing", () => {
  const r = spawnSync(process.execPath, ["scripts/phones.js"], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: dirname(process.execPath), HOME: process.env.HOME },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Missing (mkcert|caddy)/);
  assert.match(r.stderr, /brew install mkcert caddy/);
});

test("service-account validator never leaks contents and rejects wrong files", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-sa-"));
  const snippet = join(dir, "a.json");
  writeFileSync(snippet, 'var admin = require("firebase-admin");');
  const r1 = checkServiceAccount(snippet);
  assert.equal(r1.ok, false);
  assert.doesNotMatch(JSON.stringify(r1), /firebase-admin/);
  const other = join(dir, "b.json");
  writeFileSync(
    other,
    JSON.stringify({
      type: "service_account",
      project_id: "someone-else",
      private_key: "-----BEGIN PRIVATE KEY-----\nx",
      client_email: "a@b.c",
    }),
  );
  const r2 = checkServiceAccount(other);
  assert.equal(r2.ok, false);
  assert.match(r2.problem, /different project/);
  assert.doesNotMatch(JSON.stringify(r2), /BEGIN PRIVATE/);
  const good = join(dir, "c.json");
  writeFileSync(
    good,
    JSON.stringify({
      type: "service_account",
      project_id: "tech-pulse-ssec",
      private_key: "-----BEGIN PRIVATE KEY-----\nx",
      client_email: "a@b.c",
    }),
    { mode: 0o600 },
  );
  assert.equal(checkServiceAccount(good).ok, true);
});
