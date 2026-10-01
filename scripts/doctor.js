// `npm run doctor` — read-only environment report. Modifies nothing.
import { isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import {
  nodeVersionOk,
  depsCurrent,
  buildCurrent,
  portFree,
  lanAddresses,
  readJson,
  which,
  findJava21,
  p,
  runtimePath,
  credentialsFile,
} from "./lib/common.js";
import { checkServiceAccount } from "./lib/serviceAccount.js";

const rows = [];
const add = (level, name, detail = "") => rows.push({ level, name, detail });
const OK = "ok",
  WARN = "warn",
  FAIL = "FAIL",
  INFO = "info";

nodeVersionOk()
  ? add(
      OK,
      "Node",
      process.versions.node +
        (process.versions.node.startsWith("24.")
          ? ""
          : " (Node 24 LTS recommended)"),
    )
  : add(
      FAIL,
      "Node",
      `${process.versions.node}; need >= 22.12 (install Node 24)`,
    );
add(
  depsCurrent({ adopt: false }) ? OK : WARN,
  "Dependencies",
  depsCurrent({ adopt: false })
    ? "installed and matching package-lock.json"
    : "run npm run demo (installs automatically)",
);
add(
  buildCurrent() ? OK : WARN,
  "Web build (dist/)",
  buildCurrent() ? "current" : "missing/stale; npm run demo rebuilds it",
);
add(
  existsSync(credentialsFile()) ? OK : INFO,
  "Local credentials file",
  existsSync(credentialsFile())
    ? "present (private)"
    : "created on first start",
);
add(
  existsSync(p("server", "data", "store.json")) ? INFO : INFO,
  "Local data",
  existsSync(p("server", "data", "store.json"))
    ? "existing store preserved on start"
    : "none yet (fresh start)",
);
add(
  (await portFree(5173)) ? OK : INFO,
  "Port 5173",
  (await portFree(5173))
    ? "free"
    : "in use; demo will choose the next free port",
);

const presence = readJson(p("private", "presence.json"));
add(
  presence ? OK : INFO,
  "ESP32 presence config",
  presence
    ? `device ${presence.deviceId}, room ${presence.roomId}`
    : "absent (not needed for default demo)",
);

const runtime = readJson(runtimePath);
if (!runtime)
  add(
    INFO,
    "Connected-mode config",
    "private/runtime.json absent (local mode; run npm run setup for Firebase)",
  );
else {
  add(INFO, "Configured mode", runtime.mode || "local");
  if (runtime.mode === "firebase") {
    const web = runtime.firebase?.web || {};
    const missing = ["apiKey", "authDomain", "projectId", "appId"].filter(
      (k) => !web[k],
    );
    add(
      missing.length || web.projectId !== "tech-pulse-ssec" ? FAIL : OK,
      "Firebase web config",
      missing.length
        ? `missing ${missing.join(", ")}`
        : `project ${web.projectId}`,
    );
  }
}
const saPath = runtime?.firebase?.serviceAccountPath
  ? isAbsolute(runtime.firebase.serviceAccountPath)
    ? runtime.firebase.serviceAccountPath
    : p(runtime.firebase.serviceAccountPath)
  : p("private", "firebase-service-account.json");
if (existsSync(saPath)) {
  const r = checkServiceAccount(saPath);
  add(
    r.ok ? (r.looseMode ? WARN : OK) : FAIL,
    "Firebase Admin credential",
    r.ok
      ? `valid for tech-pulse-ssec${r.looseMode ? `; file mode ${r.mode} should be 600` : ""}`
      : r.problem,
  );
} else
  add(
    INFO,
    "Firebase Admin credential",
    "absent (only needed for connected mode)",
  );

const jdk = findJava21();
add(
  jdk ? OK : INFO,
  "Java 21+ (Firestore emulator)",
  jdk
    ? `JDK ${jdk.major} at ${jdk.bin}`
    : "not found; only needed for npm run test:firebase (brew install openjdk)",
);

const cli =
  process.env.ARDUINO_CLI ||
  "/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli";
add(
  existsSync(cli) || which("arduino-cli") ? OK : WARN,
  "arduino-cli",
  existsSync(cli) ? cli : which("arduino-cli") || "not found (set ARDUINO_CLI)",
);
add(
  existsSync(p("firmware", "TECH_PULSE_COMPANION", "config.h")) ? OK : INFO,
  "Firmware config.h",
  existsSync(p("firmware", "TECH_PULSE_COMPANION", "config.h"))
    ? "generated"
    : "run npm run esp32:prepare",
);
for (const tool of ["mkcert", "caddy"])
  add(
    which(tool) ? OK : INFO,
    tool,
    which(tool) ||
      "not installed (only for npm run demo:phones: brew install mkcert caddy)",
  );
const lan = lanAddresses();
add(
  INFO,
  "LAN address(es)",
  lan.map((a) => `${a.address} (${a.name})`).join(", ") || "none",
);
const runtimeOrigin = runtime?.phones?.publicOrigin;
if (runtimeOrigin) {
  const host = new URL(runtimeOrigin).hostname;
  add(
    lan.some((a) => a.address === host) ? OK : WARN,
    "Phone HTTPS origin",
    lan.some((a) => a.address === host)
      ? runtimeOrigin
      : `${runtimeOrigin} no longer matches a LAN address; regenerate certificate via npm run demo:phones`,
  );
}

const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows)
  console.log(`${r.level.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
process.exitCode = rows.some((r) => r.level === FAIL) ? 1 : 0;
