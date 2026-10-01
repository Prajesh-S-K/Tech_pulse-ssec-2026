// `npm run demo`          local mode: no Firebase, Arduino tooling or ESP32 needed.
// `npm run demo:connected` Firebase mode: explicit, never a silent fallback.
// Both: check Node, install locked dependencies if needed, build if stale,
// start the server on loopback and announce readiness only once it answers.
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  requireNode,
  depsCurrent,
  recordDeps,
  buildCurrent,
  recordBuild,
  pickPort,
  run,
  p,
  credentialsFile,
  runtimePath,
  readJson,
} from "./lib/common.js";

const connected = process.argv.includes("--connected");
const say = (m) => console.log(`[demo] ${m}`);
const die = (m, code = 1) => {
  console.error(`[demo] ERROR: ${m}`);
  process.exit(code);
};

requireNode();

if (!existsSync(p("package-lock.json")))
  die(
    "package-lock.json is missing. Download the complete release again (the lockfile is required so everyone installs the same dependencies).",
  );

if (!depsCurrent()) {
  say("Installing locked dependencies (npm ci; first run only)...");
  const r = run("npm", ["ci"], { stdio: "inherit" });
  if (r.status !== 0)
    die(
      "Dependency installation failed. Check your network connection (https://registry.npmjs.org must be reachable) and run the command again.",
      r.status || 1,
    );
  recordDeps();
}

if (connected) {
  // Validate before building or starting anything: no fallback to local identities.
  const { readRuntime, validateFirebaseConfig } =
    await import("../server/firebase/config.js");
  try {
    validateFirebaseConfig(readRuntime(runtimePath), p());
  } catch (e) {
    die(
      `${e.message}\nConnected mode needs private/runtime.json (npm run setup) and a valid Admin credential. For the independent local demo run: npm run demo`,
    );
  }
}

if (!buildCurrent()) {
  say("Building the web client...");
  const r = run("npm", ["run", "build"], { stdio: "inherit" });
  if (r.status !== 0)
    die("The web client build failed (see the output above).", r.status || 1);
  recordBuild();
}

const wanted = Number(process.env.PORT || 5173);
let port;
try {
  port = await pickPort(wanted);
} catch (e) {
  die(e.message);
}
if (port !== wanted)
  say(
    `Port ${wanted} is in use by another program (left untouched); using ${port}.`,
  );

say(
  connected
    ? "Starting Tech Pulse in CONNECTED (Firebase) mode..."
    : "Starting Tech Pulse in LOCAL mode (no Firebase, no ESP32 required)...",
);
const child = spawn(
  process.execPath,
  [p("server", "index.js"), "--production"],
  {
    cwd: p(),
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      AUTH_MODE: connected ? "firebase" : "local",
      // The independent local demo never reads (or fails on) Firebase configuration.
      ...(connected ? {} : { TP_IGNORE_RUNTIME: "1" }),
    },
  },
);

let exited = false;
let ready = false;
child.on("exit", (code, signal) => {
  exited = true;
  if (!ready && !shuttingDown)
    die(
      "The server stopped before it became ready (see the messages above). Nothing is listening.",
      code || 1,
    );
  process.exit(signal ? 0 : (code ?? 0));
});
let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    shuttingDown = true;
    if (!exited) child.kill("SIGTERM");
    else process.exit(0);
  });

const url = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 60000;
while (!exited && Date.now() < deadline) {
  try {
    const r = await fetch(`${url}/api/config`);
    if (r.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
if (!ready && !exited) {
  child.kill("SIGTERM");
  die("The server did not become reachable within 60 seconds.");
}
if (ready) {
  const creds = credentialsFile();
  console.log(`
==============================================================
  Open:   ${url}
${
  connected
    ? `  Connected mode (Firebase). Sign in with a Firebase email account;
  the owner account was set up by npm run firebase:init.`
    : `  Sign in with an account from the generated, private file:
          ${creds}
  (open it in a text editor; it is created on first start and is
   never committed. Accounts: teacher, teacher-2, dev, student-1..6.)
  No attendance session exists yet: sign in as "teacher" and start one
  from Live Attendance. Your data persists between starts.`
}
  Stop with Ctrl+C.
==============================================================`);
}
