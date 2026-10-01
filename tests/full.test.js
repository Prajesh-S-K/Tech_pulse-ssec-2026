import test from "node:test";
import assert from "node:assert/strict";
import {
  accessSync,
  constants,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { repo, project, stamp, listeningServer } from "./launch-helpers.js";
import { findOurs, stopOurs } from "../scripts/lib/instances.js";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("stopOurs ends only processes belonging to this folder", async () => {
  const idle = "setInterval(()=>{},1e6)";
  // A fake project folder: the test must never stop a real running Tech Pulse.
  const fake = "/tmp/tp-fake-project";
  const ours = spawn(
    process.execPath,
    ["-e", idle, `${fake}/server/index.js`],
    { stdio: "ignore" },
  );
  const ourProxy = spawn(
    process.execPath,
    ["-e", idle, `${fake}/private/https/Caddyfile`],
    { stdio: "ignore" },
  );
  const foreignProxy = spawn(
    process.execPath,
    ["-e", idle, "/some/other/project/private/https/Caddyfile"],
    { stdio: "ignore" },
  );
  const foreignServer = spawn(
    process.execPath,
    ["-e", idle, "/some/other/project/server/index.js"],
    { stdio: "ignore" },
  );
  try {
    await sleep(400);
    const found = findOurs(fake).map((x) => x.pid);
    assert.ok(found.includes(ours.pid) && found.includes(ourProxy.pid));
    assert.ok(
      !found.includes(foreignProxy.pid) && !found.includes(foreignServer.pid),
    );
    await stopOurs({ quiet: true, folder: fake });
    await sleep(300);
    assert.equal(alive(ours.pid), false);
    assert.equal(alive(ourProxy.pid), false);
    assert.equal(
      alive(foreignProxy.pid),
      true,
      "an unrelated proxy is left running",
    );
    assert.equal(
      alive(foreignServer.pid),
      true,
      "an unrelated server is left running",
    );
  } finally {
    for (const c of [ours, ourProxy, foreignProxy, foreignServer])
      c.kill("SIGKILL");
  }
});

test("npm run full stops with a clear fix when Firebase is configured but unusable, and never starts anything", () => {
  const dir = project({ server: listeningServer });
  stamp(dir);
  for (const f of [
    "scripts/full.js",
    "scripts/lib/instances.js",
    "scripts/lib/serial.js",
    "scripts/lib/serviceAccount.js",
    "server/firebase/config.js",
  ]) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    cpSync(join(repo, f), join(dir, f));
  }
  mkdirSync(join(dir, "private"));
  writeFileSync(
    join(dir, "private/runtime.json"),
    JSON.stringify({
      mode: "firebase",
      firebase: { web: { projectId: "tech-pulse-ssec" } },
    }),
  );
  const r = spawnSync(process.execPath, ["scripts/full.js", "--no-open"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /PROBLEM: FIREBASE_CONFIG_INVALID/);
  assert.match(r.stderr, /npm run full -- --local/);
  assert.doesNotMatch(r.stdout + r.stderr, /Phone URL|Installing/);
});

test("double-click launchers are executable, valid shell, find Node themselves and never print secrets", () => {
  for (const f of [
    "Start Tech Pulse.command",
    "Start Tech Pulse with Phones.command",
    "Stop Tech Pulse.command",
    "scripts/find-node.sh",
  ]) {
    accessSync(join(repo, f), constants.X_OK);
    assert.equal(spawnSync("bash", ["-n", join(repo, f)]).status, 0, f);
  }
  const finder = readFileSync(join(repo, "scripts/find-node.sh"), "utf8");
  assert.match(finder, /nvm\/versions\/node/);
  assert.match(finder, /nodejs\.org/);
  const fast = readFileSync(join(repo, "Start Tech Pulse.command"), "utf8");
  assert.match(fast, /scripts\/demo\.js/);
  assert.doesNotMatch(fast, /full\.js/);
  const phones = readFileSync(
    join(repo, "Start Tech Pulse with Phones.command"),
    "utf8",
  );
  assert.match(phones, /scripts\/full\.js/);
  const bat = readFileSync(join(repo, "Start Tech Pulse.bat"), "utf8");
  assert.match(bat, /scripts\\demo\.js/);
  for (const t of [fast, phones, finder])
    assert.doesNotMatch(t, /password|rootCA-key/i);
  const full = readFileSync(join(repo, "scripts/full.js"), "utf8");
  assert.match(full, /TechPulse-rootCA\.pem/);
  assert.doesNotMatch(full, /rootCA-key/);
});

const lan = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && a.family === "IPv4" && !a.internal)?.address;
test(
  "phone launcher moves to the next free HTTPS port instead of failing",
  { skip: lan ? false : "no LAN" },
  async () => {
    const { chmodSync, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = project({ server: listeningServer });
    stamp(dir);
    const bin = mkdtempSync(join(tmpdir(), "tp-bin-"));
    mkdirSync(join(bin, "ca"));
    writeFileSync(
      join(bin, "mkcert"),
      `#!/bin/sh\nif [ "$1" = "-CAROOT" ]; then echo "${bin}/ca"; exit 0; fi\nwhile [ $# -gt 0 ]; do case "$1" in -cert-file) c="$2"; shift;; -key-file) k="$2"; shift;; esac; shift; done\necho c > "$c"; echo k > "$k"\n`,
    );
    writeFileSync(
      join(bin, "caddy"),
      `#!/bin/sh\nif [ "$1" = "validate" ]; then exit 0; fi\nexec "${process.execPath}" -e 'process.exit(4)'\n`,
    );
    chmodSync(join(bin, "mkcert"), 0o755);
    chmodSync(join(bin, "caddy"), 0o755);
    const blocker = createServer().listen(8443, lan);
    await new Promise((r) => {
      blocker.once("listening", r);
      blocker.once("error", r);
    });
    const env = {
      ...process.env,
      PATH: `${bin}:${join(process.execPath, "..")}:/usr/bin:/bin:/usr/sbin`,
      PORT: "0",
      TECHPULSE_LAN_IP: lan,
    };
    delete env.TECHPULSE_HTTPS_PORT;
    const r = spawnSync(process.execPath, ["scripts/phones.js"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 25000,
      killSignal: "SIGKILL",
      env,
    });
    blocker.close();
    assert.doesNotMatch(r.stderr, /already in use/);
    const cfg = readFileSync(join(dir, "private/https/Caddyfile"), "utf8");
    const port = Number(/https:\/\/[\d.]+:(\d+) \{/.exec(cfg)[1]);
    assert.ok(port >= 8443 && port < 8463);
  },
);
