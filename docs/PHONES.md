# Phones on a private HTTPS address

Camera and location only work on **HTTPS** (or localhost, which on a phone means the phone itself). `npm run demo:phones` serves the whole app and API from one trusted private HTTPS origin on your Wi-Fi. Nothing is published to the internet and no tunnel is created.

> Status: launcher logic is tested with stand-in mkcert/Caddy programs; a real iPhone and Android run is **not tested** until performed (see FINAL_CHECKLIST).

## Easiest way

Double-click **`Start Tech Pulse.command`** (or `npm run full`). It installs the prerequisites if needed, puts the certificate at `~/Downloads/TechPulse-rootCA.pem` (revealed in Finder), stops older instances of this project, picks free ports and prints the phone URL with a QR code. The sections below explain what it does.

## Prerequisites (once)

```sh
brew install mkcert caddy
mkcert -install        # creates a local certificate authority on this computer
```

`npm run doctor` shows whether both are present. The command refuses to start without them and tells you what is missing.

## Start

1. Join the **shared Wi-Fi** that students' phones will use (not the ESP32's network).
2. `npm run demo:phones`
   - If you have several addresses set `TECHPULSE_LAN_IP=<your Wi-Fi address>`.
   - Port 8443 busy? Set `TECHPULSE_HTTPS_PORT`. Nothing running there is stopped.
3. Wait for the banner `Phone URL: https://<address>:8443`. It prints only after Node **and** the proxy answer.

What runs: Node on `127.0.0.1` only; Caddy on `https://<address>:8443` forwarding to it with streaming enabled. The server trusts only a loopback proxy, accepts only that exact origin and keeps every origin check.

**Changed address?** If your Wi-Fi address changes the launcher says so, generates a new certificate for it and prints the new URL. Phones keep trusting the same CA; only the URL changes.

## Trust the certificate authority on each phone (once)

Install **only the public file `rootCA.pem`** from the folder printed by `mkcert -CAROOT`. **Never copy `rootCA-key.pem`** anywhere.

- **iPhone:** AirDrop/email `rootCA.pem` to the phone → open it → _Settings → General → VPN & Device Management_ → install the profile → _Settings → General → About → Certificate Trust Settings_ → enable full trust for the mkcert root.
- **Android:** copy `rootCA.pem` → _Settings → Security → Encryption & credentials → Install a certificate → CA certificate_ (wording varies) → choose the file. Chrome on Android trusts user CAs.

Then open the Phone URL in Safari/Chrome; there should be no certificate warning. Remove the CA from phones after the demonstration (and `mkcert -uninstall` on the computer if you wish).

## Shared Wi-Fi vs the ESP32 network

The ESP32 creates its own Wi-Fi (`TechPulse-Classroom`). With an ESP32-required session a student collects location and photo on the shared Wi-Fi, switches to the ESP32 Wi-Fi to fetch the signed response, then **rejoins the shared Wi-Fi** and submits. Mobile data alone cannot reach this private server. Baseline sessions need no switching.

## Do not

Disable certificate checks, turn off the firewall, expose port 5173 beyond loopback, or reuse `PUBLIC_ORIGIN`/`TRUST_PROXY` settings for a public host.
