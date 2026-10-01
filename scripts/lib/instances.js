// Finds and stops OLDER Tech Pulse processes started from THIS folder (the Node server,
// the launcher, and the Caddy proxy using this folder's Caddyfile). Anything else —
// including unrelated Caddy or Node programs — is never touched.
// macOS/Linux: `ps` + `lsof`. Windows: PowerShell process list (command lines only).
import { spawnSync } from "node:child_process";
import { root } from "./common.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const win = process.platform === "win32";

function cwdOf(pid) {
  if (win) return "";
  const r = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
  });
  return (/^n(.*)$/m.exec(r.stdout || "") || [])[1] || "";
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function processList() {
  if (win) {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }',
      ],
      { encoding: "utf8" },
    );
    return parseWindowsList(r.stdout || "");
  }
  const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  return (ps.stdout || "")
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), cmd: m[2] }));
}

// Pure (unit-tested): "PID<TAB>COMMANDLINE" lines from PowerShell.
export function parseWindowsList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => /^(\d+)\t(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), cmd: m[2] }));
}

// Pure (unit-tested): decides whether a command line belongs to the given folder.
export function classify(cmd, folder, { windows = win, cwd = () => "" } = {}) {
  const norm = (t) => (windows ? t.replaceAll("\\", "/").toLowerCase() : t);
  const base = norm(folder.replace(/[\\/]+$/, ""));
  const c = norm(cmd);
  if (c.includes(`${base}/server/index.js`)) return "Tech Pulse server";
  if (c.includes(`${base}/private/https/${norm("Caddyfile")}`))
    return "Tech Pulse HTTPS proxy";
  // Launchers are started with relative paths, so on macOS/Linux confirm the folder via cwd.
  if (
    !windows &&
    /node .*scripts\/(phones|full|demo)\.js/.test(cmd) &&
    norm(cwd()).startsWith(base)
  )
    return "Tech Pulse launcher";
  return null;
}

export function findOurs(folder = root) {
  const mine = new Set([process.pid, process.ppid]);
  const found = [];
  for (const { pid, cmd } of processList()) {
    if (mine.has(pid)) continue;
    const label = classify(cmd, folder, { cwd: () => cwdOf(pid) });
    if (label) found.push({ pid, label });
  }
  return found;
}

export async function stopOurs({ quiet = false, folder = root } = {}) {
  const list = findOurs(folder);
  // launchers first so they do not report their children dying
  list.sort((a) => (a.label === "Tech Pulse launcher" ? -1 : 1));
  for (const { pid, label } of list) {
    if (!quiet) console.log(`[full] Stopping older ${label} (pid ${pid})`);
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  for (let i = 0; i < 20 && list.some((x) => alive(x.pid)); i++)
    await sleep(250);
  for (const { pid } of list)
    if (alive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  return list.length;
}
