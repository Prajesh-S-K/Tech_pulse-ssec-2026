import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classify, parseWindowsList } from "../scripts/lib/instances.js";
import { buildCaddyfile } from "../scripts/lib/caddyfile.js";
import { chooseLan } from "../scripts/lib/common.js";
import { setupPage, startCertServer } from "../scripts/lib/certserver.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const repo = new URL("../", import.meta.url).pathname;

test("Windows process list parsing and ownership: only this folder's server/proxy match", () => {
  const out = [
    "4120\tC:\\Program Files\\nodejs\\node.exe C:\\Users\\Judge\\TechPulse\\server\\index.js --production",
    "4188\tcaddy.exe run --config C:\\Users\\Judge\\TechPulse\\private\\https\\Caddyfile --adapter caddyfile",
    "5000\tcaddy.exe run --config C:\\Other\\Project\\private\\https\\Caddyfile",
    "5100\tC:\\Program Files\\nodejs\\node.exe C:\\Other\\Project\\server\\index.js",
    "",
  ].join("\r\n");
  const list = parseWindowsList(out);
  assert.equal(list.length, 4);
  const folder = "C:\\Users\\Judge\\TechPulse\\";
  const verdict = Object.fromEntries(
    list.map((x) => [x.pid, classify(x.cmd, folder, { windows: true })]),
  );
  assert.equal(verdict[4120], "Tech Pulse server");
  assert.equal(verdict[4188], "Tech Pulse HTTPS proxy");
  assert.equal(verdict[5000], null);
  assert.equal(verdict[5100], null);
  // case-insensitive drive/path on Windows
  assert.equal(
    classify("node c:\\users\\judge\\techpulse\\SERVER\\index.js", folder, {
      windows: true,
    }),
    "Tech Pulse server",
  );
});

test("Unix launchers are only claimed when their working folder matches", () => {
  assert.equal(
    classify("node scripts/phones.js", "/p/tp", {
      windows: false,
      cwd: () => "/p/tp",
    }),
    "Tech Pulse launcher",
  );
  assert.equal(
    classify("node scripts/phones.js", "/p/tp", {
      windows: false,
      cwd: () => "/elsewhere",
    }),
    null,
  );
});

test("Caddyfile uses forward slashes so Windows paths are valid", () => {
  const text = buildCaddyfile({
    origin: "https://192.168.0.5:8443",
    ip: "192.168.0.5",
    cert: "C:\\Users\\Judge\\TechPulse\\private\\https\\cert.pem",
    key: "C:\\Users\\Judge\\TechPulse\\private\\https\\key.pem",
    nodePort: 5173,
  });
  assert.match(
    text,
    /tls "C:\/Users\/Judge\/TechPulse\/private\/https\/cert\.pem" "C:\/Users\/Judge\/TechPulse\/private\/https\/key\.pem"/,
  );
  assert.doesNotMatch(text, /\\/);
  assert.match(text, /flush_interval -1/);
  assert.match(text, /bind 192\.168\.0\.5/);
});

test("Wi-Fi address choice ignores virtual adapters and prefers home/office LAN ranges", () => {
  const pick = (l) => chooseLan(l)?.address;
  assert.equal(
    pick([
      { name: "vEthernet (WSL)", address: "172.20.1.1" },
      { name: "Wi-Fi", address: "192.168.1.44" },
    ]),
    "192.168.1.44",
  );
  assert.equal(
    pick([
      { name: "VirtualBox Host-Only", address: "192.168.56.1" },
      { name: "Ethernet", address: "10.0.0.7" },
    ]),
    "10.0.0.7",
  );
  assert.equal(
    pick([
      { name: "en0", address: "10.1.2.3" },
      { name: "en1", address: "192.168.0.9" },
    ]),
    "192.168.0.9",
  );
  assert.equal(
    pick([{ name: "docker0", address: "172.17.0.1" }]),
    "172.17.0.1",
  );
  assert.equal(pick([]), undefined);
});

test("big QR page shows both codes and the typeable addresses; /setup is served", async () => {
  const qr = { cert: "<svg id='c'></svg>", app: "<svg id='a'></svg>" };
  const html = setupPage({
    certUrl: "http://10.0.0.2:8765/",
    appUrl: "https://10.0.0.2:8443",
    qr,
  });
  assert.match(html, /<svg id='c'>/);
  assert.match(html, /<svg id='a'>/);
  assert.match(html, /http:\/\/10\.0\.0\.2:8765\//);
  assert.match(html, /https:\/\/10\.0\.0\.2:8443/);
  const dir = mkdtempSync(join(tmpdir(), "tp-s-"));
  writeFileSync(
    join(dir, "rootCA.pem"),
    "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
  );
  const server = await startCertServer({
    ip: "127.0.0.1",
    port: 0,
    caFile: join(dir, "rootCA.pem"),
    appUrl: "https://10.0.0.2:8443",
    setup: {
      certUrl: "http://10.0.0.2:8765/",
      appUrl: "https://10.0.0.2:8443",
      qr,
    },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/setup`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Step 1/);
  } finally {
    server.close();
  }
});

test("Windows launchers exist, use Windows paths and no Unix-only commands", () => {
  for (const [f, needle] of [
    ["Start Tech Pulse.bat", "scripts\\demo.js"],
    ["Start Tech Pulse with Phones.bat", "scripts\\full.js"],
    ["Stop Tech Pulse.bat", "scripts\\stop.js"],
  ]) {
    const t = readFileSync(join(repo, f), "utf8");
    assert.ok(t.includes(needle), f);
    assert.match(t, /nodejs\.org|pause/);
    assert.doesNotMatch(t, /\/bin\/bash|brew |lsof/);
  }
  const full = readFileSync(join(repo, "scripts/full.js"), "utf8");
  assert.match(full, /winget/);
  assert.match(full, /explorer/);
});
