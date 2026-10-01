// Finds and stops OLDER Tech Pulse processes started from THIS folder (the Node server,
// the phone launcher, and the Caddy proxy using this folder's Caddyfile). Anything else —
// including unrelated Caddy or Node programs — is never touched.
import { spawnSync } from "node:child_process";
import { root } from "./common.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cwdOf(pid) {
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

export function findOurs(folder = root) {
  const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  const mine = new Set([process.pid, process.ppid]);
  const found = [];
  for (const line of (ps.stdout || "").split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmd = m[2];
    if (mine.has(pid)) continue;
    const base = folder.replace(/\/$/, "");
    let label = null;
    if (cmd.includes(`${base}/server/index.js`)) label = "Tech Pulse server";
    else if (cmd.includes(`${base}/private/https/Caddyfile`))
      label = "Tech Pulse HTTPS proxy";
    else if (
      /node .*scripts\/(phones|full|demo)\.js/.test(cmd) &&
      cwdOf(pid).startsWith(base)
    )
      label = "Tech Pulse launcher";
    if (label) found.push({ pid, label });
  }
  return found;
}

export async function stopOurs({ quiet = false, folder = root } = {}) {
  const list = findOurs(folder);
  // launchers first so they do not respawn or report their children dying
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
