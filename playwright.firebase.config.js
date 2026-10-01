import { defineConfig } from "@playwright/test";
import { buildCurrent, recordBuild } from "./scripts/lib/common.js";
import { execSync } from "node:child_process";

if (!buildCurrent()) {
  execSync("npm run build", { stdio: "inherit" });
  recordBuild();
}
// Runs inside `firebase emulators:exec` (see scripts/test-firebase.js).
export default defineConfig({
  testDir: "./tests/firebase",
  testMatch: "firebase-ui.spec.js",
  workers: 1,
  use: { headless: true, channel: "chrome" },
  reporter: "list",
  webServer: {
    command: "node tests/firebase/serve.js --production",
    env: { PORT: "5190" },
    url: "http://127.0.0.1:5190/api/config",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
