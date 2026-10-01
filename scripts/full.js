// `npm run full` — one command for the complete setup: Firebase + phones (+ ESP32 check).
//   npm run full              connected mode (Firebase) if configured, else local
//   npm run full -- --local   force local mode (no Firebase)
//   npm run full -- --no-open do not open Finder
// It stops older Tech Pulse processes from this folder, installs mkcert/Caddy if
// Homebrew is available, puts the public CA file in Downloads (and reveals it),
// picks free ports instead of failing, and starts the phone launcher.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  requireNode,
  which,
  run,
  p,
  readJson,
  runtimePath,
  lanAddresses,
  portFree,
} from "./lib/common.js";
import { stopOurs } from "./lib/instances.js";
import { candidates } from "./lib/serial.js";

const args = process.argv.slice(2);
const local = args.includes("--local");
const say = (m) => console.log(`[full] ${m}`);
const die = (m) => {
  console.error(`\n[full] PROBLEM: ${m}`);
  process.exit(1);
};
requireNode();

// 1. Older versions of this project: stop them (only ours).
const stopped = await stopOurs();
if (stopped) say(`Stopped ${stopped} older Tech Pulse process(es).`);

// 2. Mode check, before anything is started.
const runtime = readJson(runtimePath) || {};
const wantsFirebase = !local && runtime.mode === "firebase";
if (wantsFirebase) {
  const { validateFirebaseConfig } =
    await import("../server/firebase/config.js");
  try {
    validateFirebaseConfig(runtime, p());
    say("Mode: CONNECTED (Firebase project tech-pulse-ssec).");
  } catch (e) {
    die(
      `${e.message}\n  Fix private/runtime.json / the Admin key (npm run doctor), or run  npm run full -- --local`,
    );
  }
} else
  say(
    local ? "Mode: LOCAL (forced)." : "Mode: LOCAL (no Firebase configured).",
  );

// 3. mkcert + Caddy: install automatically (Homebrew on macOS, winget on Windows).
const win = process.platform === "win32";
const missing = ["mkcert", "caddy"].filter((t) => !which(t));
if (missing.length) {
  if (win) {
    if (!which("winget"))
      die(
        `Missing ${missing.join(" and ")}. Install them once: open the Microsoft Store, install "App Installer" (winget), or download mkcert and Caddy from their websites; then run this again.`,
      );
    const ids = { mkcert: "FiloSottile.mkcert", caddy: "CaddyServer.Caddy" };
    say(
      `Installing ${missing.join(" + ")} with winget (one time; Windows may ask permission)...`,
    );
    for (const t of missing)
      run(
        "winget",
        [
          "install",
          "--id",
          ids[t],
          "-e",
          "--accept-source-agreements",
          "--accept-package-agreements",
        ],
        { stdio: "inherit" },
      );
    if (!["mkcert", "caddy"].every((t) => which(t)))
      die(
        "The tools were installed but this window cannot see them yet. CLOSE this window and start again (Windows needs a fresh window to find new programs).",
      );
  } else {
    if (!which("brew"))
      die(
        `Missing ${missing.join(" and ")}. Install Homebrew (https://brew.sh) then run again, or: brew install mkcert caddy`,
      );
    say(`Installing ${missing.join(" + ")} with Homebrew (one time)...`);
    if (run("brew", ["install", ...missing], { stdio: "inherit" }).status !== 0)
      die(
        "Homebrew could not install the tools. Run: brew install mkcert caddy",
      );
  }
}

// 4. Local CA: create/trust it once (the system asks for your password / permission).
const caroot = run("mkcert", ["-CAROOT"]).stdout.trim();
const caFile = join(caroot, "rootCA.pem");
if (!existsSync(caFile)) {
  say(
    "Creating the local certificate authority (your computer may ask for permission)...",
  );
  if (run("mkcert", ["-install"], { stdio: "inherit" }).status !== 0)
    die("mkcert -install failed. Run it yourself once:  mkcert -install");
}

// 5. Public CA file → Downloads, revealed in the file manager (the private key is never copied).
const dl = join(homedir(), "Downloads");
mkdirSync(dl, { recursive: true });
const dest = join(dl, "TechPulse-rootCA.pem");
copyFileSync(caFile, dest);
say(`Phone certificate ready: ${dest}`);
if (!args.includes("--no-open") && !process.env.TP_NO_OPEN) {
  if (process.platform === "darwin") run("open", ["-R", dest]);
  else if (win) run("explorer", [`/select,${dest}`]);
}

// 6. Network + ESP32 hints (informational, never blocking).
const lan = lanAddresses();
if (!lan.length)
  die("No Wi-Fi/network address found. Join the shared Wi-Fi and run again.");
const ports = candidates();
say(
  ports.length
    ? `ESP32 board detected on ${ports[0]} (already flashed? if not: npm run esp32:upload).`
    : "No ESP32 plugged in (fine: baseline sessions need none; power the board from an adapter for ESP32 sessions).",
);

// 7. Start the phone launcher; it picks free ports and prints the phone URL + QR code.
if (
  process.env.TECHPULSE_HTTPS_PORT &&
  !(await portFree(Number(process.env.TECHPULSE_HTTPS_PORT), lan[0].address))
)
  say("Your TECHPULSE_HTTPS_PORT is busy; the launcher will say so.");
const child = spawn(process.execPath, [p("scripts", "phones.js")], {
  cwd: p(),
  stdio: "inherit",
  env: { ...process.env, ...(local ? { AUTH_MODE: "local" } : {}) },
});
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
