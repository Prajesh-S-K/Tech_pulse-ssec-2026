# ESP32 classroom companion (optional)

The ESP32 is **optional**. Default sessions need no hardware. When a teacher picks _GPS + ESP32 classroom proof + teacher review_, students must also fetch a signed response from a board placed in the room.

## What it does

The board runs its own password-protected Wi-Fi (`TechPulse-Classroom`, portal http://192.168.4.1) and signs an attempt-bound request with a key shared with the server. It needs only USB power: no computer, internet, router or clock after flashing. The page is embedded in flash — no filesystem upload. It serves up to eight Wi-Fi clients at once. It proves contact with the configured signer; it does **not** prove exact room occupancy, genuine GPS or identity.

Target hardware: normal **ESP32 Dev Module / ESP32-WROOM-32, 4MB**. S2/S3/C-series boards are refused by the tooling.

## Prepare, compile, upload

Prerequisites: Arduino IDE (provides `arduino-cli`) with the **ESP32 core 3.3.x** installed; data-capable USB cable. The tools use the CLI bundled with the Arduino IDE (`ARDUINO_CLI` overrides) — nothing is reinstalled.

```sh
npm run esp32:prepare                          # creates private/presence.json + firmware/.../config.h (reuses existing keys)
npm run esp32:compile                          # compiles for 4MB flash, 115200 upload speed
npm run esp32:upload -- --dry-run              # shows discovery and port checks only
npm run esp32:upload                           # discover → port check → chip verification → compile → flash
npm run esp32:upload -- /dev/cu.ACTUAL_PORT    # when several candidates exist
```

`esp32:upload` reports five **separate** stages and stops at the first problem:

1. **Discovery** — `/dev/cu.usbserial*`, `usbmodem*`, `wchusbserial*`, `SLAB_USBtoUART*` only (Bluetooth, audio and debug ports are never candidates). One candidate is selected automatically; several need a prompt or an explicit port.
2. **Port free** — `lsof` check; a serial monitor or Arduino IDE using the port is reported, not killed.
3. **Chip verification** — read-only `esptool chip-id` and `flash-id`. Only a plain ESP32 with ≥ 4MB flash passes; ESP32-S2/S3/C-series, unknown chips and smaller flash are refused. Discovery is not verification.
4. **Compile** — `esp32:esp32:esp32:UploadSpeed=115200,FlashSize=4M,PartitionScheme=default`. On Apple Silicon the build bypasses the Intel-only ctags helper (`tools.ctags.cmd.path=/usr/bin/true`); all firmware functions are defined before use.
5. **Flash** — only after the chip was verified. **Every** upload alias re-verifies the chip first, including the explicit-port form.

It never erases flash, uploads a filesystem image or rotates the signing key. Rotating keys is a deliberate manual action (edit `private/presence.json`, `esp32:prepare`, recompile, reflash, restart server).

Fallback with the same settings written out:

```sh
export ESP32_FQBN="esp32:esp32:esp32:UploadSpeed=115200,FlashSize=4M,PartitionScheme=default"
npm run esp32:prepare
npm run esp32:compile
npm run esp32:upload -- /dev/cu.ACTUAL_PORT
```

Some boards need BOOT held while the upload starts. Release it afterwards; BOOT is not needed in normal operation.

## Student flow (ESP32-required sessions)

1. Claim the QR on the shared Wi-Fi, share location, take the photo.
2. _Generate companion request_, copy the code.
3. Join `TechPulse-Classroom`, open http://192.168.4.1 in the normal browser (not a captive mini-browser), paste the request, copy the response.
4. **Rejoin the shared Wi-Fi**, return to the same tab, paste the response and submit.

Attempts have 180 s (baseline 90 s) plus the fixed 15 s upload allowance. A missing board/response is retryable; an altered, expired or cross-student response never verifies; a wrong signature is reported as suspicious proof. Nothing falls back silently: use **Start replacement session without ESP32** if the board is unavailable.

## Proof format

Request `attemptId.nonce.expiresAt.deviceId.requestMac`; response adds `proofMac`. HMAC-SHA256 with distinct `request|` and `proof|` prefixes. The server checks ownership, attempt binding, configured device/room, deadline and signature. Relay of a live response, firmware key extraction and a weak shared secret remain possible; no hardware-security claim is made.

## Files that must stay private

`private/presence.json` and `firmware/TECH_PULSE_COMPANION/config.h` hold the Wi-Fi password and the signing secret. `firmware/build/` embeds the secret. All are ignored by Git and excluded from release archives. Placeholders: `examples/presence.example.json`.

## Troubleshooting

| Symptom                                    | Cause / fix                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `Port is in use`                           | Close Arduino IDE serial monitor / `screen` sessions                       |
| `Chip identification failed`               | Try another cable (must carry data), hold BOOT during the probe            |
| `Refusing to flash: ... not a plain ESP32` | Wrong board — the image is built for the normal ESP32 only                 |
| Wi-Fi network missing after power-up       | Check supply (use a stable USB adapter/power bank), wait 10 s, power-cycle |
| App says retry                             | Board off/out of range, response expired, or wrong attempt's code          |

## Acceptance checklist (physical — all **not tested** until performed)

- [ ] Flash the real board; confirm serial output at 115200 baud
- [ ] Disconnect the laptop; power from an adapter/power bank; Wi-Fi and portal appear
- [ ] Repeat after a power cycle
- [ ] iPhone Safari and Android Chrome complete a real attempt, including network switching
- [ ] Missing, altered, expired and cross-student proof are refused
- [ ] Board powered off: the app says retry; nothing is recorded
- [ ] Eight clients then a ninth

Compile results below are software results: firmware compiled (931,828 bytes, 71% of program storage; 47,152 bytes, 14% of dynamic memory). A read-only identification of the connected board reported `ESP32-D0WD-V3` with 4MB flash. **Nothing has been flashed.**
