// `npm run release` — builds release/tech-pulse-<version>.zip from an EXPLICIT
// allow-list (nothing is included just because it exists), scans the result and
// refuses to finish if a private value is found. Findings print file:line only.
//   node scripts/make-release.js --scan-only <dir>   scan an extracted copy
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  cpSync,
  mkdtempSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { p, root, readJson } from "./lib/common.js";

// ---- allow-list ----------------------------------------------------------
export const INCLUDE_FILES = [
  "package.json",
  "package-lock.json",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  ".nvmrc",
  ".gitignore",
  ".editorconfig",
  ".prettierignore",
  "index.html",
  "firebase.json",
  ".firebaserc",
  "firestore.rules",
  "firestore.indexes.json",
  "playwright.config.js",
  "playwright.firebase.config.js",
  "Tech_pulse-ssec-2026.code-workspace",
  "Start Tech Pulse.command",
  "Start Tech Pulse with Phones.command",
  "Start Tech Pulse.bat",
  "Stop Tech Pulse.command",
];
export const INCLUDE_DIRS = [
  "src",
  "server",
  "scripts",
  "tests",
  "docs",
  "examples",
  "showcase",
  "firmware",
  ".vscode",
];
// Excluded anywhere under an included directory.
export const EXCLUDE = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)dist-web(\/|$)/,
  /(^|\/)private(\/|$)/,
  /^server\/data(\/|$)/,
  /^firmware\/build(\/|$)/,
  /^firmware\/[^/]+\/config\.h$/,
  /(^|\/)test-results(\/|$)/,
  /(^|\/)playwright-report(\/|$)/,
  /(^|\/)release(\/|$)/,
  /\.log$/,
  /(^|\/)\.DS_Store$/,
  /\.(pem|key)$/,
  /service-?account.*\.json$/i,
  /firebase-adminsdk.*\.json$/i,
  /(^|\/)\.env(\.|$)/,
  /\.pdf$/i,
];
const TEXT =
  /\.(js|jsx|json|md|html|css|ino|h|txt|yml|yaml|mjs|cjs|rules|code-workspace)$|(^|\/)\.[a-z]+$/i;

export function collect(base = root) {
  const out = [];
  const walk = (rel) => {
    const abs = join(base, rel);
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (EXCLUDE.some((re) => re.test(r))) continue;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  for (const f of INCLUDE_FILES) if (existsSync(join(base, f))) out.push(f);
  for (const d of INCLUDE_DIRS) if (existsSync(join(base, d))) walk(d);
  return out.sort();
}

// ---- scan ------------------------------------------------------------------
function privateValues() {
  const values = [];
  const presence = readJson(p("private", "presence.json"));
  if (presence?.secret) values.push(["ESP32 signing secret", presence.secret]);
  if (presence?.password) values.push(["Wi-Fi password", presence.password]);
  if (presence?.wifiPassword)
    values.push(["Wi-Fi password", presence.wifiPassword]);
  const creds = readJson(p("private", "account-passwords.json")) || {};
  for (const [id, c] of Object.entries(creds))
    if (c?.password) values.push([`generated password (${id})`, c.password]);
  return values.filter(([, v]) => typeof v === "string" && v.length >= 8);
}
export function scan(files, base = root) {
  const findings = [];
  const notes = [];
  const secrets = privateValues();
  for (const rel of files) {
    const abs = join(base, rel);
    if (!TEXT.test(rel) && statSync(abs).size > 2_000_000) continue;
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    text.split("\n").forEach((line, i) => {
      const at = `${rel}:${i + 1}`;
      if (
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line) &&
        !/\.test\.js$|release\.test|make-release|serviceAccount/.test(rel)
      )
        findings.push([at, "private key block"]);
      if (/"private_key"\s*:\s*"-----BEGIN/.test(line))
        findings.push([at, "service-account private_key"]);
      for (const [label, value] of secrets)
        if (line.includes(value)) findings.push([at, label]);
      if (/\/Users\/[A-Za-z0-9_.-]+\//.test(line) && !/make-release/.test(rel))
        findings.push([at, "machine-specific absolute path"]);
      if (/AIza[0-9A-Za-z_-]{30,}/.test(line))
        notes.push([
          at,
          "Firebase web API key (public client configuration, not an Admin secret)",
        ]);
    });
  }
  return { findings, notes };
}

// ---- main --------------------------------------------------------------------
const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (args[0] === "--scan-only") {
    const dir = args[1];
    if (!dir || !existsSync(dir)) {
      console.error("Usage: make-release.js --scan-only <directory>");
      process.exit(1);
    }
    const files = [];
    const walk = (rel) => {
      for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        e.isDirectory() ? walk(r) : files.push(r);
      }
    };
    walk("");
    const { findings, notes } = scan(files, dir);
    for (const [at, what] of findings) console.log(`FINDING ${at}  ${what}`);
    for (const [at, what] of notes) console.log(`note    ${at}  ${what}`);
    console.log(
      `scanned ${files.length} files: ${findings.length} finding(s), ${notes.length} public-config note(s)`,
    );
    process.exit(findings.length ? 1 : 0);
  }
  const version = readJson(p("package.json")).version;
  const files = collect();
  const { findings, notes } = scan(files);
  for (const [at, what] of findings) console.error(`FINDING ${at}  ${what}`);
  for (const [at, what] of notes) console.log(`note    ${at}  ${what}`);
  if (findings.length) {
    console.error(
      `Release refused: ${findings.length} finding(s) above (values are never printed).`,
    );
    process.exit(1);
  }
  const outDir = p("release");
  mkdirSync(outDir, { recursive: true });
  const stage = mkdtempSync(join(tmpdir(), "tp-release-"));
  const top = join(stage, `tech-pulse-${version}`);
  for (const f of files) {
    mkdirSync(join(top, f, ".."), { recursive: true });
    cpSync(p(f), join(top, f));
  }
  const manifest = files
    .map(
      (f) =>
        `${createHash("sha256")
          .update(readFileSync(p(f)))
          .digest("hex")}  ${f}`,
    )
    .join("\n");
  writeFileSync(join(outDir, "MANIFEST.txt"), manifest + "\n");
  const zip = join(outDir, `tech-pulse-${version}.zip`);
  rmSync(zip, { force: true });
  const r = spawnSync("zip", ["-q", "-r", "-X", zip, `tech-pulse-${version}`], {
    cwd: stage,
  });
  if (r.status !== 0) {
    console.error("zip failed (the macOS/Linux zip command is required).");
    process.exit(1);
  }
  rmSync(stage, { recursive: true, force: true });
  console.log(
    `Release archive: ${relative(root, zip)} (${files.length} files, ${Math.round(statSync(zip).size / 1024)} KB)`,
  );
  console.log(
    `Manifest: release/MANIFEST.txt   public-config notes: ${notes.length}`,
  );
}
