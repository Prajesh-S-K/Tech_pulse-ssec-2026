// Shared helpers for the startup tooling. Node built-ins only, so these scripts
// run before `npm ci` has installed anything.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const p = (...parts) => join(root, ...parts);
export const MIN_NODE = [22, 12, 0];

// TP_FAKE_NODE_VERSION exists only so the launcher tests can exercise the guard.
const reportedNode = () =>
  process.env.TP_FAKE_NODE_VERSION || process.versions.node;
export function nodeVersionOk(version = reportedNode()) {
  const have = version.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] > MIN_NODE[i]) return true;
    if (have[i] < MIN_NODE[i]) return false;
  }
  return true;
}

// Looks for a newer Node (nvm, Homebrew, /usr/local) when the default one is too old.
export function findNewerNode(home = process.env.HOME || "") {
  const dirs = [];
  try {
    const base = join(home, ".nvm", "versions", "node");
    if (existsSync(base))
      for (const v of readdirSync(base).sort().reverse())
        dirs.push(join(base, v, "bin"));
  } catch {}
  dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  for (const dir of dirs) {
    const bin = join(dir, "node");
    if (!existsSync(bin)) continue;
    const r = spawnSync(bin, ["-p", "process.versions.node"], {
      encoding: "utf8",
    });
    if (r.status === 0 && nodeVersionOk(r.stdout.trim())) return { bin, dir };
  }
  return null;
}

// If the default Node is too old but a good one is installed, silently continue with it
// (same script, same arguments). Otherwise explain, in plain words, what to install.
export function requireNode() {
  if (nodeVersionOk()) return;
  if (!process.env.TP_REEXEC) {
    const better = findNewerNode();
    if (better) {
      const npmDir = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        better.dir,
        ...(process.env.PATH || "").split(":"),
      ].find((d) => d && existsSync(join(d, "npm")));
      const PATH = [better.dir, npmDir, process.env.PATH]
        .filter(Boolean)
        .join(":");
      const r = spawnSync(better.bin, process.argv.slice(1), {
        stdio: "inherit",
        env: { ...process.env, PATH, TP_REEXEC: "1" },
      });
      process.exit(r.status ?? 1);
    }
  }
  console.error(
    `\nThis computer's Node.js (version ${reportedNode()}) is too old for Tech Pulse (needs ${MIN_NODE.join(".")} or newer).\n\n` +
      "  What to do (takes about 2 minutes, free):\n" +
      "   1. Open  https://nodejs.org/  and download the LTS installer (version 24).\n" +
      "   2. Run the installer, then CLOSE this window and open a new one.\n" +
      "   3. Start Tech Pulse again.\n",
  );
  process.exit(1);
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

// Never kills anything: simply moves to the next free port.
export async function pickPort(start, attempts = 25) {
  for (let port = start; port < start + attempts; port++)
    if (await portFree(port)) return port;
  throw new Error(`No free port between ${start} and ${start + attempts - 1}.`);
}

export function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(networkInterfaces()))
    for (const a of list || [])
      if (a.family === "IPv4" && !a.internal)
        found.push({ name, address: a.address });
  return found;
}

// Picks the address phones should use. Virtual adapters (VPN, Docker, WSL, Hyper-V,
// VirtualBox, VMware) are ignored; private LAN ranges are preferred (192.168 > 10 > 172.16-31).
export function chooseLan(list) {
  const virtual =
    /vethernet|virtualbox|vmware|vbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|utun|bridge|vnic|tun|tap/i;
  const rank = (a) =>
    /^192\.168\./.test(a)
      ? 0
      : /^10\./.test(a)
        ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(a)
          ? 2
          : 9;
  const real = list.filter((x) => !virtual.test(x.name));
  const pool = (real.length ? real : list)
    .slice()
    .sort((x, y) => rank(x.address) - rank(y.address));
  return pool[0] || null;
}

export function run(cmd, args, options = {}) {
  // On Windows npm is npm.cmd and needs a shell.
  const shell = process.platform === "win32" && cmd === "npm";
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    shell,
    ...options,
  });
}

export function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.split("\n")[0].trim() : null;
}

export function sha(...paths) {
  const h = createHash("sha256");
  for (const path of paths.flat()) {
    if (!existsSync(path)) continue;
    h.update(path.slice(root.length));
    h.update(readFileSync(path));
  }
  return h.digest("hex");
}

function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out.sort();
}

export const depsStamp = () => p("node_modules", ".tp-lock-hash");
export const buildStamp = () => p("dist", ".tp-build-hash");
export const lockDigest = () => sha(p("package-lock.json"));

// Content check (never timestamps): every non-optional package in package-lock.json must
// appear in npm's record of the installed tree (node_modules/.package-lock.json) at the
// same version.
export function installedMatchesLock() {
  try {
    const lock = JSON.parse(readFileSync(p("package-lock.json"), "utf8"));
    const hidden = JSON.parse(
      readFileSync(p("node_modules", ".package-lock.json"), "utf8"),
    );
    const installed = hidden.packages || {};
    for (const [key, meta] of Object.entries(lock.packages || {})) {
      if (key === "" || meta.optional || meta.os || meta.cpu || meta.link)
        continue;
      if (installed[key]?.version !== meta.version) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Dependencies are current when a successful install recorded this lockfile digest, or
// (for trees installed by plain `npm ci`/`npm install`) when the installed tree provably
// matches the lockfile — in which case the digest is adopted.
export function depsCurrent({ adopt = true } = {}) {
  if (!existsSync(p("package-lock.json"))) return false;
  if (
    existsSync(depsStamp()) &&
    readFileSync(depsStamp(), "utf8").trim() === lockDigest()
  )
    return true;
  if (installedMatchesLock()) {
    if (adopt) recordDeps();
    return true;
  }
  return false;
}
export function recordDeps() {
  writeFileSync(depsStamp(), lockDigest() + "\n");
}

export function buildInputs() {
  return [
    ...listFiles(p("src")),
    p("index.html"),
    p("package.json"),
    p("package-lock.json"),
    ...readdirSync(root)
      .filter((f) => /^vite\.config\./.test(f))
      .map((f) => p(f)),
  ];
}
export const buildDigest = () => sha(buildInputs());
export function buildCurrent() {
  return (
    existsSync(p("dist", "index.html")) &&
    existsSync(buildStamp()) &&
    readFileSync(buildStamp(), "utf8").trim() === buildDigest()
  );
}
export function recordBuild() {
  writeFileSync(buildStamp(), buildDigest() + "\n");
}

export const runtimePath = p("private", "runtime.json");
export const credentialsFile = () =>
  process.env.CREDENTIALS_PATH || p("private", "account-passwords.json");

// Firebase emulators need JDK 21+ (firebase-tools 15). Returns the first usable java binary.
export function findJava21() {
  const candidates = [
    process.env.JAVA_HOME && `${process.env.JAVA_HOME}/bin/java`,
    "/opt/homebrew/opt/openjdk/bin/java",
    "/usr/local/opt/openjdk/bin/java",
    "java",
  ].filter(Boolean);
  for (const bin of candidates) {
    if (bin !== "java" && !existsSync(bin)) continue;
    const r = run(bin, ["-version"]);
    const major = r.error
      ? 0
      : Number((/version "(\d+)/.exec(`${r.stderr}${r.stdout}`) || [])[1] || 0);
    if (major >= 21) return { bin, major };
  }
  return null;
}
