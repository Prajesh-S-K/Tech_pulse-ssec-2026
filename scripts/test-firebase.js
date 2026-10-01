// Runs the Firestore + Auth emulator integration tests. Requires JDK 21+
// (firebase-tools 15 refuses older Java). Uses a throwaway demo project:
// no real Firebase project, credentials or data are touched.
import { spawnSync } from "node:child_process";
import { p, findJava21 } from "./lib/common.js";

const java = findJava21();
if (!java) {
  console.error(
    "Firebase emulator tests: NOT RUN. firebase-tools 15 needs Java 21+; none found. Install one (brew install openjdk) or set JAVA_HOME.",
  );
  process.exit(2);
}
const env = { ...process.env };
if (java.bin !== "java")
  env.PATH = `${java.bin.replace(/\/java$/, "")}:${env.PATH}`;
const cli = p("node_modules", ".bin", "firebase");
const r = spawnSync(
  cli,
  [
    "emulators:exec",
    "--only",
    "auth,firestore",
    "--project",
    "demo-tech-pulse",
    "node --test tests/firebase/*.test.js && npx playwright test -c playwright.firebase.config.js",
  ],
  { cwd: p(), stdio: "inherit", env },
);
process.exit(r.status ?? 1);
