import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { project, stamp, listeningServer } from "./launch-helpers.js";

const lan = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && a.family === "IPv4" && !a.internal)?.address;
const skip = lan ? false : "no LAN address on this machine";

// Fake mkcert/caddy so the launcher's control flow is testable without installing them.
function fakeBin({ caddyRun = "setInterval(()=>{},1000)" } = {}) {
  const bin = mkdtempSync(join(tmpdir(), "tp-bin-"));
  const caroot = join(bin, "caroot");
  mkdirSync(caroot);
  const node = process.execPath;
  writeFileSync(
    join(bin, "mkcert"),
    `#!/bin/sh
if [ "$1" = "-CAROOT" ]; then echo "${caroot}"; exit 0; fi
while [ $# -gt 0 ]; do case "$1" in -cert-file) c="$2"; shift;; -key-file) k="$2"; shift;; esac; shift; done
echo cert > "$c"; echo key > "$k"; exit 0
`,
  );
  writeFileSync(
    join(bin, "caddy"),
    `#!/bin/sh
if [ "$1" = "validate" ]; then exit 0; fi
exec "${node}" -e '${caddyRun}'
`,
  );
  chmodSync(join(bin, "mkcert"), 0o755);
  chmodSync(join(bin, "caddy"), 0o755);
  return bin;
}
const phones = (dir, bin, env = {}) =>
  spawnSync(process.execPath, ["scripts/phones.js"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 25000,
    killSignal: "SIGKILL",
    env: {
      ...process.env,
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin`,
      PORT: "0",
      TECHPULSE_LAN_IP: lan,
      ...env,
    },
  });

test(
  "unknown LAN address is rejected with the available choices",
  { skip },
  () => {
    const dir = project({ server: listeningServer });
    stamp(dir);
    const r = phones(dir, fakeBin(), { TECHPULSE_LAN_IP: "203.0.113.9" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Choose your shared Wi-Fi address/);
    assert.match(r.stderr, new RegExp(lan.replaceAll(".", "\\.")));
  },
);

test(
  "an occupied HTTPS port is left alone and reported",
  { skip },
  async () => {
    const dir = project({ server: listeningServer });
    stamp(dir);
    const blocker = createServer().listen(0, lan);
    await new Promise((r) => blocker.once("listening", r));
    const port = blocker.address().port;
    const r = phones(dir, fakeBin(), { TECHPULSE_HTTPS_PORT: String(port) });
    blocker.close();
    assert.notEqual(r.status, 0);
    assert.match(
      r.stderr,
      new RegExp(
        `Port ${port} on ${lan.replaceAll(".", "\\.")} is already in use`,
      ),
    );
    assert.doesNotMatch(r.stdout, /Phone URL/);
  },
);

test(
  "proxy that dies at startup stops the Node server and never prints a phone URL",
  { skip },
  () => {
    const dir = project({ server: listeningServer });
    stamp(dir);
    const r = phones(dir, fakeBin({ caddyRun: "process.exit(4)" }), {
      TECHPULSE_HTTPS_PORT: "48443",
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Caddy proxy stopped before it became ready/);
    assert.doesNotMatch(r.stdout, /Phone URL/);
    // certificate generation, config validation and the address record happened
    assert.ok(existsSync(join(dir, "private/https/Caddyfile")));
    const cfg = readFileSync(join(dir, "private/https/Caddyfile"), "utf8");
    assert.match(cfg, new RegExp(`bind ${lan.replaceAll(".", "\\.")}`));
    assert.match(cfg, /flush_interval -1/);
    assert.match(cfg, /reverse_proxy 127\.0\.0\.1:\d+/);
  },
);

test(
  "a changed LAN address is announced and regenerates the certificate",
  { skip },
  () => {
    const dir = project({ server: listeningServer });
    stamp(dir);
    mkdirSync(join(dir, "private/https"), { recursive: true });
    writeFileSync(join(dir, "private/https/cert.pem"), "old");
    writeFileSync(join(dir, "private/https/key.pem"), "old");
    writeFileSync(
      join(dir, "private/runtime.json"),
      JSON.stringify({ phones: { lastIp: "10.99.99.99" } }),
    );
    const r = phones(dir, fakeBin({ caddyRun: "process.exit(4)" }), {
      TECHPULSE_HTTPS_PORT: "48444",
    });
    assert.match(r.stdout, /Your LAN address changed \(10\.99\.99\.99 ->/);
    assert.equal(
      readFileSync(join(dir, "private/https/cert.pem"), "utf8").trim(),
      "cert",
    );
    assert.equal(
      JSON.parse(readFileSync(join(dir, "private/runtime.json"), "utf8")).phones
        .lastIp,
      lan,
    );
  },
);
