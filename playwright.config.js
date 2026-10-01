import { defineConfig } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DemoStore } from "./server/store.js";
import { buildCurrent, recordBuild } from "./scripts/lib/common.js";
import { hashPassword } from "./server/auth.js";

// Tests exercise the production bundle (what judges get), built once if stale.
if (!buildCurrent()) {
  execSync("npm run build", { stdio: "inherit" });
  recordBuild();
}

// Every server below uses its own throwaway data directory: nothing here can
// touch the working database or private/ credentials.
function isolated(port, extraEnv = {}) {
  const data = mkdtempSync(join(tmpdir(), `techpulse-browser-${port}-`));
  writeFileSync(
    join(data, "presence.json"),
    JSON.stringify({
      deviceId: "ssec-room-1",
      roomId: "room-1",
      ssid: "Test-Classroom",
      secret: "a".repeat(64),
    }),
  );
  const seed = new DemoStore();
  for (const u of seed.users)
    u.passwordHash = hashPassword("test-password-123");
  writeFileSync(
    join(data, "store.json"),
    JSON.stringify({
      users: seed.users,
      classrooms: seed.classrooms,
      schedules: seed.schedules,
      sessions: [],
      attempts: [],
      attendance: [],
      logs: [],
    }),
  );
  return {
    command: "node server/index.js --production",
    env: {
      PORT: String(port),
      AUTH_MODE: "local",
      TP_IGNORE_RUNTIME: "1",
      CREDENTIALS_PATH: join(data, "passwords.json"),
      STORE_PATH: join(data, "store.json"),
      PRESENCE_CONFIG: join(data, "presence.json"),
      ...extraEnv,
    },
    url: `http://127.0.0.1:${port}/api/demo-accounts`,
    reuseExistingServer: false,
    timeout: 60000,
  };
}

export default defineConfig({
  testDir: "./tests",
  // Every browser spec runs; the Firebase UI spec has its own config.
  testMatch: ["browser.spec.js", "ui-*.spec.js"],
  workers: 1,
  use: { headless: true, channel: "chrome" },
  reporter: "list",
  webServer: [
    isolated(5188),
    // Short evidence lifetime so expiry is observable without waiting 15 minutes.
    isolated(5189, { TP_REVIEW_TTL_MS: "6000", TP_SSE_INTERVAL_MS: "2000" }),
  ],
});
