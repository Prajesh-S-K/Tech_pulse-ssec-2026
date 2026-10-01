import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect, scan, EXCLUDE } from "../scripts/make-release.js";

test("release manifest contains source, lockfile, examples and docs but nothing private", () => {
  const files = collect();
  for (const must of [
    "package.json",
    "package-lock.json",
    ".nvmrc",
    ".gitignore",
    "README.md",
    "examples/runtime.example.json",
    "docs/FIREBASE.md",
    "scripts/demo.js",
    "server/app.js",
    "src/main.jsx",
    "firestore.rules",
  ])
    assert.ok(files.includes(must), `missing ${must}`);
  for (const f of files) {
    assert.doesNotMatch(f, /^private\//);
    assert.doesNotMatch(f, /^server\/data\//);
    assert.doesNotMatch(f, /^firmware\/build\//);
    assert.doesNotMatch(f, /config\.h$/);
    assert.doesNotMatch(f, /node_modules|^dist\/|\.log$|\.pdf$|\.DS_Store/);
    assert.doesNotMatch(
      f,
      /service-?account.*\.json$|adminsdk.*\.json$|\.pem$|\.key$|(^|\/)\.env/i,
    );
  }
  assert.ok(EXCLUDE.length > 8);
});

test("scanner reports file:line only, never the value, and classifies web API keys separately", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-scan-"));
  mkdirSync(join(dir, "docs"));
  const secretish = "SuperSecretValue-" + "x".repeat(24);
  writeFileSync(
    join(dir, "docs/a.md"),
    [
      "fine line",
      "-----BEGIN PRIVATE KEY-----",
      "path /Users" + "/someone/project/file",
      'apiKey: "AIza' + "B".repeat(35) + '"',
    ].join("\n"),
  );
  const { findings, notes } = scan(["docs/a.md"], dir);
  const text = JSON.stringify({ findings, notes });
  assert.deepEqual(
    findings.map(([at]) => at),
    ["docs/a.md:2", "docs/a.md:3"],
  );
  assert.deepEqual(
    notes.map(([at]) => at),
    ["docs/a.md:4"],
  );
  assert.doesNotMatch(text, new RegExp(secretish));
  assert.doesNotMatch(text, /BBBBBBBB/);
  assert.match(notes[0][1], /public client configuration/);
});

test("the real release manifest scans clean (no secrets, no machine paths)", () => {
  const { findings } = scan(collect());
  assert.deepEqual(findings, []);
});
