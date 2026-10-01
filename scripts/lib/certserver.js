// Tiny LAN web page that hands out ONLY the public mkcert root certificate so a phone
// can install it by scanning a QR code: /  (instructions), /rootCA.pem (Android / generic),
// /TechPulse.mobileconfig (iPhone profile). The CA private key is never read.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

export function pemToDerBase64(pem) {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
}

export function mobileconfig(pem) {
  const b64 = pemToDerBase64(pem).replace(/(.{64})/g, "$1\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><array><dict>
<key>PayloadCertificateFileName</key><string>TechPulse-rootCA.cer</string>
<key>PayloadContent</key><data>
${b64}
</data>
<key>PayloadDescription</key><string>Lets this phone trust the Tech Pulse demo server on your Wi-Fi</string>
<key>PayloadDisplayName</key><string>Tech Pulse demo certificate</string>
<key>PayloadIdentifier</key><string>local.techpulse.rootca.cert</string>
<key>PayloadType</key><string>com.apple.security.root</string>
<key>PayloadUUID</key><string>7B1C2A0E-4F3D-4C55-9A61-6E0D2B7F3A10</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></array>
<key>PayloadDisplayName</key><string>Tech Pulse demo certificate</string>
<key>PayloadIdentifier</key><string>local.techpulse.rootca</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadUUID</key><string>0D9E5B3C-8A12-4B77-B1C4-2F6A9E4D5C21</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></plist>
`;
}

export function page(appUrl) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tech Pulse phone setup</title>
<style>body{font:17px/1.55 system-ui,sans-serif;margin:0;background:#f5f7fb;color:#14243b}main{max-width:560px;margin:0 auto;padding:20px}
section{background:#fff;border:1px solid #dce3ec;border-radius:12px;padding:16px 18px;margin:14px 0}h1{font-size:24px}h2{font-size:18px;margin:0 0 6px}
a.btn{display:block;background:#0f766e;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:600;margin:10px 0}ol{padding-left:20px;margin:6px 0}</style>
<main><h1>Tech Pulse — phone setup (1 minute)</h1>
<p>Your phone must trust this demo server once, so the camera and location work. Pick your phone:</p>
<section><h2>iPhone</h2><a class="btn" href="/TechPulse.mobileconfig">1 · Download certificate profile</a>
<ol><li>Tap <b>Allow</b>, then open <b>Settings → Profile Downloaded → Install</b>.</li>
<li><b>Settings → General → About → Certificate Trust Settings</b> → switch on <b>Tech Pulse demo certificate</b>.</li></ol></section>
<section><h2>Android</h2><a class="btn" href="/rootCA.pem">1 · Download certificate</a>
<ol><li>Open the downloaded file (or <b>Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate</b>) and confirm.</li></ol></section>
<section><h2>Then</h2><a class="btn" href="${appUrl}">2 · Open Tech Pulse</a>
<p>Stay on the same Wi-Fi as the computer. You can remove the certificate afterwards in Settings.</p></section></main></html>`;
}

export function startCertServer({ ip, port, caFile, appUrl }) {
  const pem = readFileSync(caFile, "utf8");
  const server = createServer((req, res) => {
    const send = (code, type, body, extra = {}) => {
      res.writeHead(code, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        ...extra,
      });
      res.end(body);
    };
    if (req.method !== "GET")
      return send(405, "text/plain", "Method not allowed");
    const path = (req.url || "/").split("?")[0];
    if (path === "/")
      return send(200, "text/html; charset=utf-8", page(appUrl));
    if (path === "/rootCA.pem")
      return send(200, "application/x-x509-ca-cert", pem, {
        "Content-Disposition": 'attachment; filename="TechPulse-rootCA.crt"',
      });
    if (path === "/TechPulse.mobileconfig")
      return send(200, "application/x-apple-aspen-config", mobileconfig(pem), {
        "Content-Disposition": 'attachment; filename="TechPulse.mobileconfig"',
      });
    return send(404, "text/plain", "Not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, ip, () => resolve(server));
  });
}
