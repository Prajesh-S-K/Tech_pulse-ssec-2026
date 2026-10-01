// Generates docs/screenshots/*.png from an ISOLATED server with synthetic data.
//   node tests/diagnostics/screenshots.mjs
// It never touches server/data or private/: a temporary data directory is seeded
// and discarded. Map tiles are replaced by a plain stub so the output is offline-safe.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DemoStore } from "../../server/store.js";
import { hashPassword } from "../../server/auth.js";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { signPresence } from "../../server/presence.js";

const root = new URL("../../", import.meta.url).pathname;
const out = join(root, "docs/screenshots");
mkdirSync(out, { recursive: true });
const PORT = 5197;
const base = `http://127.0.0.1:${PORT}`;
const pw = "demo-password-123";
const data = mkdtempSync(join(tmpdir(), "tp-shots-"));
const secret = "b".repeat(64);
writeFileSync(
  join(data, "presence.json"),
  JSON.stringify({
    deviceId: "ssec-room-1",
    roomId: "room-1",
    ssid: "Demo-Classroom",
    wifiPassword: "demo",
    secret,
  }),
);
const seed = new DemoStore();
for (const u of seed.users) u.passwordHash = hashPassword(pw);
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
const server = spawn(process.execPath, ["server/index.js", "--production"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    AUTH_MODE: "local",
    TP_IGNORE_RUNTIME: "1",
    STORE_PATH: join(data, "store.json"),
    CREDENTIALS_PATH: join(data, "pw.json"),
    PRESENCE_CONFIG: join(data, "presence.json"),
    TP_SSE_INTERVAL_MS: "1500",
  },
  stdio: "ignore",
});
const stop = () => server.kill("SIGTERM");
process.on("exit", stop);
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${base}/api/config`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
// Neutral grid tile (replaces street-map tiles so screenshots need no network).
const tile = new PNG({ width: 256, height: 256 });
for (let y = 0; y < 256; y++)
  for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) << 2;
    const line = x % 64 === 0 || y % 64 === 0;
    tile.data[i] = line ? 205 : 234;
    tile.data[i + 1] = line ? 214 : 239;
    tile.data[i + 2] = line ? 222 : 243;
    tile.data[i + 3] = 255;
  }
const png = PNG.sync.write(tile);
const goodPhoto =
  "data:image/jpeg;base64," +
  jpeg
    .encode({ width: 32, height: 32, data: Buffer.alloc(32 * 32 * 4, 200) }, 70)
    .data.toString("base64");
const api = async (path, token, body, method) => {
  const r = await fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};
const login = async (id) =>
  (await api("/api/login", null, { id, password: pw })).token;
const tT = await login("teacher");
const venue = { latitude: 13.0827, longitude: 80.2707 };
const browser = await chromium.launch({ channel: "chrome" });
const cam = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    const x = c.getContext("2d");
    x.fillStyle = "#1e5145";
    x.fillRect(0, 0, 320, 240);
    return c.captureStream(30);
  };
};
async function student(
  id,
  geo = venue,
  accuracy = 8,
  size = { width: 390, height: 844 },
) {
  const ctx = await browser.newContext({
    viewport: size,
    permissions: ["geolocation"],
    geolocation: { ...geo, accuracy },
  });
  await ctx.addInitScript(cam);
  return { ctx, page: await ctx.newPage(), id };
}
async function signIn(page, id) {
  await page.getByLabel("Student Roll No, Faculty ID, or Email").fill(id);
  await page.getByLabel("Password", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Sign in to Portal ➔" }).click();
}
async function submit(s, link) {
  await s.page.goto(link);
  await signIn(s.page, s.id);
  await s.page
    .getByRole("button", { name: "Claim attendance attempt" })
    .click();
  await s.page.getByRole("button", { name: /Read my location/ }).click();
  await s.page.getByRole("button", { name: /Open camera/ }).click();
  await s.page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  await s.page
    .getByRole("button", { name: "Capture photo", exact: true })
    .click();
  await s.page
    .getByRole("button", { name: "Submit attendance evidence" })
    .click();
}
const tPage = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
});
await tPage.route("https://tile.openstreetmap.org/**", (r) =>
  r.fulfill({ status: 200, contentType: "image/png", body: png }),
);
await tPage.goto(base);
await signIn(tPage, "teacher");
const shot = (page, name, opts = {}) =>
  page.screenshot({ path: join(out, name), ...opts });
const stopOpen = async () => {
  for (const s of (await api("/api/state", tT)).sessions.filter((x) => x.open))
    await api(`/api/sessions/${s.id}/stop`, tT, {});
};

// 1. hardware-free session
await tPage.getByLabel("Session type", { exact: true }).selectOption("demo");
await tPage.getByRole("button", { name: "Start selected session" }).click();
await tPage.getByTestId("policy-badge").waitFor();
const link1 = await tPage.getByLabel("Student check-in link").inputValue();
const s1 = await student("student-1");
await submit(s1, link1);
await tPage.getByRole("button", { name: "Approve identity" }).first().click();
await tPage.getByTestId("occupancy-count").waitFor();
await tPage.evaluate(() => window.scrollTo(0, 0));
await shot(tPage, "01-hardware-free-session.png", { fullPage: true });

// 5. estimated occupancy with checkout (same session)
await shot(s1.page, "05b-student-presence-checkout.png");
await tPage
  .getByTestId("occupancy-panel")
  .screenshot({ path: join(out, "05a-estimated-occupancy.png") });
await s1.page.getByRole("button", { name: "Check out of room" }).click();
await tPage.getByText("No active check-ins").first().waitFor();
await tPage
  .getByTestId("occupancy-panel")
  .screenshot({ path: join(out, "05c-occupancy-after-checkout.png") });

// 4. teacher review drawer
const s2 = await student("student-2");
await submit(s2, link1);
await tPage
  .getByRole("button", { name: /Review Photos/ })
  .first()
  .click();
await tPage.getByRole("dialog").waitFor();
await shot(tPage, "04-teacher-review.png");
await tPage.keyboard.press("Escape");

// 6. anomaly states from synthetic fixtures
const s3 = await student("student-3", { latitude: 13.2, longitude: 80.4 });
await submit(s3, link1); // outside geofence -> rejected
const s4 = await student("student-4", venue, 900);
await submit(s4, link1); // poor GPS accuracy -> needs action
await tPage
  .getByTestId("anomaly-panel")
  .getByText(/Rejected checks/)
  .waitFor({ timeout: 20000 });
await tPage.getByTestId("anomaly-panel").scrollIntoViewIfNeeded();
await tPage
  .getByTestId("anomaly-panel")
  .screenshot({ path: join(out, "06a-anomalies-rejected-needs-action.png") });

// 2. ESP32-required policy + guidance + suspicious proof
await stopOpen();
await tPage.reload();
await tPage.getByLabel("Session type", { exact: true }).selectOption("demo");
await tPage.getByLabel("Classroom proof policy").selectOption("local");
await tPage.getByTestId("policy-help").waitFor();
await shot(tPage, "02a-policy-selector-esp32.png", {
  clip: { x: 0, y: 150, width: 1440, height: 950 },
});
await tPage.getByRole("button", { name: "Start selected session" }).click();
await tPage.getByTestId("policy-badge").waitFor();
const link2 = await tPage.getByLabel("Student check-in link").inputValue();
const s5 = await student("student-5");
await s5.page.goto(link2);
await signIn(s5.page, "student-5");
await s5.page.getByRole("button", { name: "Claim attendance attempt" }).click();
await s5.page.getByText("ESP32 classroom proof required").waitFor();
await shot(s5.page, "02b-student-esp32-guidance.png", { fullPage: true });
const sT6 = await login("student-6");
const st = await api("/api/state", tT);
const ch = st.sessions.find((x) => x.open).challenge.id;
const a6 = await api("/api/claim", sT6, { challengeId: ch });
const req = await api(`/api/attempts/${a6.id}/presence-request`, sT6, {});
const payload = req.requestCode.split(".").slice(0, 4).join(".");
const bad = payload + "." + signPresence("proof", payload, secret) + "x";
await api(`/api/attempts/${a6.id}/submit`, sT6, {
  photo: goodPhoto,
  location: { lat: 13.0827, lng: 80.2707, accuracy: 5 },
  presenceProof: bad,
}).catch(() => {});
await tPage.getByTestId("policy-badge").scrollIntoViewIfNeeded();
await tPage.waitForTimeout(2500);
await tPage
  .getByTestId("anomaly-panel")
  .screenshot({ path: join(out, "06b-anomalies-suspicious-proof.png") })
  .catch(() => {});
await shot(tPage, "02c-teacher-esp32-session.png");

// 3. classroom map / geofence
await tPage.locator('.nav-item[aria-label="Classrooms & Venues"]').click();
await tPage.getByLabel("Classroom location map").waitFor();
await tPage.waitForTimeout(800);
await shot(tPage, "03-classroom-map-geofence.png");

await browser.close();
stop();
console.log("screenshots written to docs/screenshots");
