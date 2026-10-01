import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLogins, writeLogins } from "../scripts/lib/logins.js";
import {
  startCertServer,
  mobileconfig,
  pemToDerBase64,
} from "../scripts/lib/certserver.js";
import { openTarget } from "../scripts/lib/open.js";

const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from("not-a-real-certificate-but-fine-for-format-tests").toString("base64")}\n-----END CERTIFICATE-----\n`;

test("login list is readable, complete and lists every generated account once", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-logins-"));
  const creds = join(dir, "pw.json");
  const data = {};
  for (const id of [
    "teacher",
    "teacher-2",
    "dev",
    "student-1",
    "student-2",
    "student-3",
    "student-4",
    "student-5",
    "student-6",
  ])
    data[id] = { email: `${id}@ssec.edu`, password: `pw-${id}-ABC123` };
  writeFileSync(creds, JSON.stringify(data));
  const text = buildLogins({
    credentialsPath: creds,
    url: "http://127.0.0.1:5173",
    phoneUrl: "https://192.168.0.5:8443",
  });
  for (const id of Object.keys(data)) {
    assert.equal(
      text.split("\n").filter((l) => l.trim().startsWith(id + " ")).length,
      1,
      id,
    );
    assert.ok(text.includes(data[id].password));
  }
  assert.match(text, /http:\/\/127\.0\.0\.1:5173/);
  assert.match(text, /https:\/\/192\.168\.0\.5:8443/);
  assert.match(text, /TRY THIS/);
  const out = join(dir, "private", "DEMO-LOGINS.txt");
  assert.equal(writeLogins({ credentialsPath: creds, url: "x" }, out), true);
  assert.equal(statSync(out).mode & 0o077, 0, "private file, owner only");
  assert.equal(
    writeLogins(
      { credentialsPath: join(dir, "missing.json"), url: "x" },
      join(dir, "o2.txt"),
    ),
    false,
  );
});

test("certificate page serves only the public CA and profile; never keys or other paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-ca-"));
  const caFile = join(dir, "rootCA.pem");
  writeFileSync(caFile, pem);
  writeFileSync(
    join(dir, "rootCA-key.pem"),
    "-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n",
  );
  const server = await startCertServer({
    ip: "127.0.0.1",
    port: 0,
    caFile,
    appUrl: "https://192.168.0.5:8443",
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /iPhone/);
    assert.match(html, /Android/);
    assert.match(html, /https:\/\/192\.168\.0\.5:8443/);
    const crt = await fetch(base + "/rootCA.pem");
    assert.equal(crt.headers.get("content-type"), "application/x-x509-ca-cert");
    assert.equal(await crt.text(), pem);
    const prof = await fetch(base + "/TechPulse.mobileconfig");
    assert.equal(
      prof.headers.get("content-type"),
      "application/x-apple-aspen-config",
    );
    const xml = await prof.text();
    assert.match(xml, /com\.apple\.security\.root/);
    assert.ok(xml.replace(/\s+/g, "").includes(pemToDerBase64(pem)));
    for (const bad of [
      "/rootCA-key.pem",
      "/../rootCA-key.pem",
      "/%2e%2e/rootCA-key.pem",
      "/etc/passwd",
      "/private/x",
    ]) {
      const r = await fetch(base + bad);
      const body = await r.text();
      assert.equal(r.status, 404, bad);
      assert.doesNotMatch(body, /PRIVATE KEY|SECRET/);
    }
    assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
  } finally {
    server.close();
  }
  assert.doesNotMatch(mobileconfig(pem), /PRIVATE KEY/);
});

test("openTarget is a silent no-op when TP_NO_OPEN is set", () => {
  const before = process.env.TP_NO_OPEN;
  process.env.TP_NO_OPEN = "1";
  assert.equal(openTarget("http://127.0.0.1:1"), false);
  if (before === undefined) delete process.env.TP_NO_OPEN;
  else process.env.TP_NO_OPEN = before;
});
