// `npm run demo:phones` — private HTTPS origin for phones on the shared Wi-Fi.
// Node stays on 127.0.0.1; Caddy exposes https://<LAN-IP>:8443 and proxies to it.
// Frontend and API share that one origin; origin checks and proxy trust stay strict.
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import https from "node:https";
import {
  requireNode,
  which,
  run,
  p,
  pickPort,
  portFree,
  lanAddresses,
  readJson,
  runtimePath,
  depsCurrent,
  recordDeps,
  buildCurrent,
  recordBuild,
} from "./lib/common.js";
import { startCertServer } from "./lib/certserver.js";
import { openTarget } from "./lib/open.js";
import { writeLogins } from "./lib/logins.js";

const die = (m, code = 1) => {
  console.error(`[phones] ERROR: ${m}`);
  process.exit(code);
};
const say = (m) => console.log(`[phones] ${m}`);
requireNode();

for (const tool of ["mkcert", "caddy"])
  if (!which(tool))
    die(
      `Missing ${tool}. Install with: brew install mkcert caddy   then run: mkcert -install   (see docs/PHONES.md).`,
    );

// 1. The address phones will use must be a real shared-Wi-Fi address of this machine.
const addresses = lanAddresses();
if (!addresses.length)
  die("No network address found. Join the shared Wi-Fi network first.");
const ip =
  process.env.TECHPULSE_LAN_IP ||
  (addresses.length === 1 ? addresses[0].address : null);
if (!ip || !addresses.some((a) => a.address === ip))
  die(
    `Choose your shared Wi-Fi address with TECHPULSE_LAN_IP=<address>. Available: ${addresses.map((a) => `${a.address} (${a.name})`).join(", ")}`,
  );

// 2. Changed address => the old certificate no longer matches; regenerate it.
const runtime = readJson(runtimePath) || {};
const certDir = p("private", "https");
const cert = p("private", "https", "cert.pem");
const key = p("private", "https", "key.pem");
const lastIp = runtime.phones?.lastIp;
const regenerate = !existsSync(cert) || !existsSync(key) || lastIp !== ip;
if (lastIp && lastIp !== ip)
  say(
    `Your LAN address changed (${lastIp} -> ${ip}). Generating a new certificate; phones keep trusting the same CA, but use the new URL.`,
  );

// 3. HTTPS port must be free on that address.
// An explicit TECHPULSE_HTTPS_PORT is respected (and reported if busy); otherwise the
// first free port from 8443 is used, so another program on 8443 never blocks startup.
let httpsPort = Number(process.env.TECHPULSE_HTTPS_PORT || 8443);
if (!process.env.TECHPULSE_HTTPS_PORT)
  for (let i = 0; i < 20 && !(await portFree(httpsPort, ip)); i++) httpsPort++;
if (!(await portFree(httpsPort, ip)))
  die(
    `Port ${httpsPort} on ${ip} is already in use by another program (left untouched). Stop it or set TECHPULSE_HTTPS_PORT.`,
  );

if (!depsCurrent()) {
  say("Installing locked dependencies...");
  if (
    run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"]).status !==
    0
  )
    die("Installing failed. Check that this computer is online and try again.");
  recordDeps();
}
if (!buildCurrent()) {
  say("Building the web client...");
  if (run("npm", ["run", "build", "--silent"]).status !== 0)
    die("The web client build failed.");
  recordBuild();
}

mkdirSync(certDir, { recursive: true });
if (regenerate) {
  const r = run("mkcert", [
    "-cert-file",
    cert,
    "-key-file",
    key,
    ip,
    "localhost",
    "127.0.0.1",
    "::1",
  ]);
  if (r.status !== 0) {
    console.error(`${r.stdout || ""}${r.stderr || ""}`);
    die("mkcert failed. Run  mkcert -install  once, then try again.");
  }
  mkdirSync(p("private"), { recursive: true });
  writeFileSync(
    runtimePath,
    JSON.stringify({ ...runtime, phones: { lastIp: ip } }, null, 2) + "\n",
    { mode: 0o600 },
  );
}

const nodePort = await pickPort(Number(process.env.PORT || 5173));
const origin = `https://${ip}:${httpsPort}`;
const cfg = p("private", "https", "Caddyfile");
writeFileSync(
  cfg,
  `{\n auto_https off\n admin off\n log {\n  level ERROR\n }\n}\n${origin} {\n bind ${ip}\n tls "${cert}" "${key}"\n reverse_proxy 127.0.0.1:${nodePort} {\n  flush_interval -1\n }\n}\n`,
  { mode: 0o600 },
);
{
  const v = run("caddy", [
    "validate",
    "--config",
    cfg,
    "--adapter",
    "caddyfile",
  ]);
  if (v.status !== 0) {
    console.error(`${v.stdout || ""}${v.stderr || ""}`);
    die("The generated Caddy configuration did not validate.");
  }
}

const env = {
  ...process.env,
  TP_QUIET: "1",
  HOST: "127.0.0.1",
  PORT: String(nodePort),
  PUBLIC_ORIGIN: origin,
  TRUST_PROXY: "loopback",
  AUTH_MODE: process.env.AUTH_MODE || runtime.mode || "local",
};
const caroot = run("mkcert", ["-CAROOT"]).stdout.trim();
let ready = false;
let stopping = false;
const children = [];
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
};
const start = (name, cmd, args) => {
  const c = spawn(cmd, args, { cwd: p(), env, stdio: "inherit" });
  children.push(c);
  c.on("error", (e) => {
    console.error(`[phones] ${name} could not start: ${e.message}`);
    stop(1);
  });
  c.on("exit", (code) => {
    if (!stopping) {
      console.error(
        `[phones] ${name} stopped${ready ? "" : " before it became ready"} (exit ${code}).`,
      );
      stop(code || 1);
    }
  });
};
start("Node server", process.execPath, [
  p("server", "index.js"),
  "--production",
]);
start("Caddy proxy", "caddy", [
  "run",
  "--config",
  cfg,
  "--adapter",
  "caddyfile",
]);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stop(0));

// 4. Announce the phone URL only when Node answers locally AND the proxy answers on the LAN address.
const get = (opts) =>
  new Promise((resolve) => {
    const req = https.request(opts, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", () => resolve(0));
    req.setTimeout(2000, () => req.destroy());
    req.end();
  });
const caFile = `${caroot}/rootCA.pem`;
const ca = existsSync(caFile) ? readFileSync(caFile) : undefined;
const deadline = Date.now() + 60000;
while (!stopping && Date.now() < deadline) {
  let local = 0;
  try {
    local = (await fetch(`http://127.0.0.1:${nodePort}/api/config`)).status;
  } catch {}
  const proxied = await get({
    host: ip,
    port: httpsPort,
    path: "/api/config",
    ca,
    servername: ip,
  });
  if (local === 200 && proxied === 200) {
    ready = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 400));
}
if (!ready && !stopping) {
  console.error(
    "[phones] The HTTPS origin did not become reachable within 60 seconds.",
  );
  stop(1);
} else if (ready) {
  // Certificate page on the LAN so phones can install the public CA by scanning a QR code.
  let certUrl = null;
  let certServer = null;
  try {
    let certPort = 8765; // uncommon port: 8080 is used by many tools (and the Firestore emulator)
    for (let i = 0; i < 30 && !(await portFree(certPort, ip)); i++) certPort++;
    certServer = await startCertServer({
      ip,
      port: certPort,
      caFile,
      appUrl: origin,
    });
    certUrl = `http://${ip}:${certPort}/`;
    children.push({ exitCode: null, kill: () => certServer.close() });
  } catch {}
  let qrs = "";
  try {
    const QR = (await import("qrcode")).default;
    const q = (t) => QR.toString(t, { type: "terminal", small: true });
    if (certUrl)
      qrs += `  STEP 1 — scan to trust the demo certificate (once per phone):\n${await q(certUrl)}\n`;
    qrs += `  STEP ${certUrl ? 2 : 1} — scan to open Tech Pulse:\n${await q(origin)}\n`;
  } catch {}
  const loginsFile = p("private", "DEMO-LOGINS.txt");
  if ((env.AUTH_MODE || "local") === "local") {
    const fresh = !existsSync(loginsFile);
    if (
      writeLogins(
        {
          credentialsPath:
            process.env.CREDENTIALS_PATH ||
            p("private", "account-passwords.json"),
          url: `http://127.0.0.1:${nodePort}`,
          phoneUrl: origin,
        },
        loginsFile,
      ) &&
      fresh
    )
      openTarget(loginsFile);
  }
  console.log(qrs);
  console.log(`
==============================================================
  Phone URL:  ${origin}
${certUrl ? `  Certificate page:  ${certUrl}\n` : ""}  Phones must be on the same Wi-Fi as this computer. After the ESP32
  step, rejoin this Wi-Fi: mobile data cannot reach this private server.
  Computer certificate file: ~/Downloads/TechPulse-rootCA.pem (if made).
  Keep this window open. Stop with Ctrl+C.
==============================================================`);
}
