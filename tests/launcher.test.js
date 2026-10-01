import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  cpSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  repo,
  freePort,
  project,
  stamp,
  demo,
  listeningServer,
} from "./launch-helpers.js";

test("unsupported Node stops before anything is installed", () => {
  const dir = project();
  const r = demo(dir, { TP_FAKE_NODE_VERSION: "20.1.0" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /too old/);
  assert.match(r.stderr, /Node 24/);
  assert.ok(!existsSync(join(dir, "node_modules")));
});

test("missing lockfile is a clear error, never a silent npm install", () => {
  const dir = project({ lock: false });
  const r = demo(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /package-lock\.json is missing/);
});

test("stale dependency stamp triggers npm ci; a failed install exits nonzero without a ready message", () => {
  const dir = project();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "stub",
      type: "module",
      dependencies: { "tp-test-nonexistent-package": "9.9.9" },
      scripts: { build: "true" },
    }),
  );
  stamp(dir);
  writeFileSync(join(dir, "package-lock.json"), '{"changed":true}');
  const r = demo(dir, {
    npm_config_offline: "true",
    npm_config_fetch_retries: "0",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /Installing locked dependencies/);
  assert.match(r.stderr, /Dependency installation failed/);
  assert.doesNotMatch(r.stdout, /Open:/);
});

test("failed build exits nonzero with a clear error", () => {
  const dir = project({ build: 'node -e "process.exit(7)"' });
  stamp(dir, { build: false });
  const r = demo(dir);
  assert.equal(r.status, 7);
  assert.match(r.stderr, /build failed/);
  assert.doesNotMatch(r.stdout, /Open:/);
});

test("server that dies on startup never prints a ready banner", () => {
  const dir = project({ server: "console.error('boom'); process.exit(3)" });
  stamp(dir);
  const r = demo(dir);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /stopped before it became ready/);
  assert.doesNotMatch(r.stdout, /Open:/);
});

test("ready banner only after the server answers; build is skipped when current; Ctrl+C stops the child", async () => {
  const port = await freePort();
  const dir = project({ server: listeningServer });
  stamp(dir);
  const child = spawn(process.execPath, ["scripts/demo.js"], {
    cwd: dir,
    env: { ...process.env, PORT: String(port) },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const until = async (re, ms = 20000) => {
    const end = Date.now() + ms;
    while (!re.test(out) && Date.now() < end)
      await new Promise((r) => setTimeout(r, 100));
    assert.match(out, re);
  };
  await until(new RegExp(`Open:\\s+http://127\\.0\\.0\\.1:${port}`));
  assert.doesNotMatch(out, /Building the web client|Installing/);
  assert.doesNotMatch(out, /password\s*[:=]/i);
  const exit = new Promise((r) =>
    child.on("exit", (code, sig) => r({ code, sig })),
  );
  child.kill("SIGINT");
  const res = await exit;
  assert.equal(res.code, 0);
  const free = await new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
  assert.equal(free, true, "port released after shutdown");
});

test("occupied preferred port is left alone and the next free port is announced", async () => {
  const dir = project({ server: listeningServer });
  stamp(dir);
  const blocker = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => blocker.once("listening", r));
  const taken = blocker.address().port;
  const child = spawn(process.execPath, ["scripts/demo.js"], {
    cwd: dir,
    env: { ...process.env, PORT: String(taken) },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const end = Date.now() + 20000;
  while (!/Open:/.test(out) && Date.now() < end)
    await new Promise((r) => setTimeout(r, 100));
  child.kill("SIGINT");
  await new Promise((r) => child.on("exit", r));
  blocker.close();
  assert.match(out, new RegExp(`${taken} is in use by another program`));
  const m = /Open:\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
  assert.ok(m && Number(m[1]) !== taken);
});

test("connected launcher fails clearly on missing/invalid Firebase configuration and never falls back", () => {
  const dir = project({ server: listeningServer });
  stamp(dir);
  mkdirSync(join(dir, "server/firebase"), { recursive: true });
  mkdirSync(join(dir, "private"), { recursive: true });
  cpSync(
    join(repo, "server/firebase/config.js"),
    join(dir, "server/firebase/config.js"),
  );
  cpSync(
    join(repo, "scripts/lib/serviceAccount.js"),
    join(dir, "scripts/lib/serviceAccount.js"),
  );
  const r = demo(dir, {}, ["--connected"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /FIREBASE_CONFIG_INVALID/);
  assert.match(r.stderr, /npm run demo/);
  assert.doesNotMatch(r.stdout, /Open:/);
});

test("default demo ignores broken private runtime configuration", () => {
  const src = readFileSync(join(repo, "scripts/demo.js"), "utf8");
  assert.match(src, /TP_IGNORE_RUNTIME/);
  assert.match(src, /AUTH_MODE: connected \? "firebase" : "local"/);
});

test("dependency freshness is decided by content, not timestamps", () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "stub" },
      "node_modules/a": { version: "1.0.0" },
      "node_modules/win-only": { version: "9.9.9", os: ["win32"] },
    },
  });
  const probe = (dir) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { depsCurrent } from "./scripts/lib/common.js"; console.log(depsCurrent({ adopt: false }));`,
      ],
      { cwd: dir, encoding: "utf8" },
    ).stdout.trim();
  const dir = project();
  stamp(dir, { deps: false });
  writeFileSync(join(dir, "package-lock.json"), lock);
  const hidden = join(dir, "node_modules", ".package-lock.json");
  // no stamp and no installed record -> not current
  assert.equal(probe(dir), "false");
  // installed tree matches the lock (platform-only package ignored) -> current, no stamp needed
  writeFileSync(
    hidden,
    JSON.stringify({ packages: { "node_modules/a": { version: "1.0.0" } } }),
  );
  assert.equal(probe(dir), "true");
  // a different installed version is stale, however new the files are
  writeFileSync(
    hidden,
    JSON.stringify({ packages: { "node_modules/a": { version: "1.0.1" } } }),
  );
  assert.equal(probe(dir), "false");
  // missing package -> stale
  writeFileSync(hidden, JSON.stringify({ packages: {} }));
  assert.equal(probe(dir), "false");
});

test("build freshness covers lockfile and config changes, not only source", () => {
  const dir = project();
  stamp(dir);
  const probe = () =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { buildCurrent } from "./scripts/lib/common.js"; console.log(buildCurrent());`,
      ],
      { cwd: dir, encoding: "utf8" },
    ).stdout.trim();
  assert.equal(probe(), "true");
  writeFileSync(join(dir, "package-lock.json"), '{"changed":1}');
  assert.equal(probe(), "false");
  stamp(dir);
  assert.equal(probe(), "true");
  writeFileSync(join(dir, "vite.config.js"), "export default {};");
  assert.equal(probe(), "false");
  stamp(dir);
  writeFileSync(join(dir, "src/a.js"), "2");
  assert.equal(probe(), "false");
});
