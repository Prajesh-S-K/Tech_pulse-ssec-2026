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
import { openTarget } from "./lib/open.js";
import { writeLogins } from "./lib/logins.js";

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

const showOutput = (r) => {
  const text = `${r.stdout || ""}${r.stderr || ""}`
    .trim()
    .split("\n")
    .slice(-25)
    .join("\n");
  if (text) console.error(`\n${text}\n`);
};

if (!depsCurrent()) {
  say(
    "Step 1 of 3 — installing what the program needs (first time only, about 1–2 minutes)...",
  );
  // Output is hidden on success (npm prints harmless "deprecated"/"vulnerabilities" notes).
  const r = run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"]);
  if (r.status !== 0) {
    showOutput(r);
    die(
      "Installing failed. Please check that this computer is online (it downloads about 100 MB once), then start again.",
      r.status || 1,
    );
  }
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
  say("Step 2 of 3 — preparing the app...");
  const r = run("npm", ["run", "build", "--silent"]);
  if (r.status !== 0) {
    showOutput(r);
    die("The web client build failed (see the lines above).", r.status || 1);
  }
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
    `Port ${wanted} is busy (another program is using it), so Tech Pulse uses ${port} instead. This is normal.`,
  );

say(
  connected
    ? "Step 3 of 3 — starting Tech Pulse in CONNECTED (Firebase) mode..."
    : "Step 3 of 3 — starting Tech Pulse (nothing else to set up)...",
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
      TP_QUIET: "1",
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
  const loginsFile = p("private", "DEMO-LOGINS.txt");
  let note = "";
  if (!connected) {
    const fresh = !existsSync(loginsFile);
    if (writeLogins({ credentialsPath: credentialsFile(), url }, loginsFile)) {
      note = `  Login list:  ${loginsFile}`;
      if (fresh) openTarget(loginsFile);
    }
  }
  openTarget(url);
  console.log(`
==============================================================
  Open:   ${url}   (your browser should open by itself)
${
  connected
    ? `  Connected mode (Firebase). Sign in with a Firebase email account;
  the owner account was set up by npm run firebase:init.`
    : `${note}
  Accounts and passwords for this copy are in that file (opened for you
  the first time): teacher, teacher-2, dev, student-1..6.
  No attendance session exists yet: sign in as "teacher" and start one
  from Live Attendance. Your data persists between starts.`
}
  Stop with Ctrl+C (or close this window).
==============================================================`);
}
