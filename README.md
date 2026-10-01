# Tech Pulse — geo-fenced smart attendance

A downloadable campus attendance portal: students check in from a phone (location + camera + QR), the responsible teacher reviews the evidence, and attendance is recorded exactly once. It runs entirely on one computer with **no cloud account and no hardware** by default. Firebase accounts, a private HTTPS address for phones and an ESP32 classroom proof are optional extras.

> Honest scope: this is a prototype built for the Tech Pulse 2026 problem statement (Geo-Fenced Smart Attendance & Resource Management). Identity is confirmed by a **teacher**, not by software; image similarity is advisory only. Physical-device checks (phones, standalone ESP32) are listed as *not tested* until someone performs them — see [docs/FINAL_CHECKLIST.md](docs/FINAL_CHECKLIST.md).

## Full version in one step (Firebase + phones + ESP32)

On the Mac that runs the portal, **double-click `Start Tech Pulse.command`** (or run `npm run full`). It:

- finds a suitable Node by itself and tells you if none is installed;
- **stops older Tech Pulse processes** from this folder (never unrelated programs);
- checks Firebase configuration first and, if it is unusable, says what to fix (`npm run full -- --local` runs without Firebase);
- installs mkcert/Caddy with Homebrew if they are missing and creates the local certificate authority once;
- **copies the phone certificate to `~/Downloads/TechPulse-rootCA.pem` and reveals it in Finder** (the private key is never copied);
- picks free ports instead of failing, builds the client if needed and prints the **phone URL plus a QR code**.

On each phone: open `TechPulse-rootCA.pem` (AirDrop it from Downloads) and trust it ([docs/PHONES.md](docs/PHONES.md)), scan the QR code. Stop everything with **`Stop Tech Pulse.command`** (or `npm run stop`) or Ctrl+C. Details for Firebase and the ESP32 are in [docs/FIREBASE.md](docs/FIREBASE.md) and [docs/ESP32_COMPANION.md](docs/ESP32_COMPANION.md); the ESP32 is flashed once with `npm run esp32:upload`.

## Judge quick start

1. Install **Node 24** once (https://nodejs.org/ — any Node ≥ 22.12 works; `nvm install 24` also fine).
2. Download or unzip the project and open a terminal in its folder.
3. Run:

   ```sh
   npm run demo
   ```

   The first run installs the locked dependencies, builds the web client and starts the server. It prints a line like `Open: http://127.0.0.1:5173` (a different port is chosen automatically if 5173 is busy; nothing else is stopped).
4. Open that address. Sign in with an account listed in the generated file **`private/account-passwords.json`** (open it with any text editor; it is created on first start, is unique to your copy and is never committed). Accounts: `teacher`, `teacher-2`, `dev`, `student-1` … `student-6`.
5. As `teacher`, start a session on **Live Attendance** (choose *Demo session* to ignore the timetable). No sessions exist until a teacher starts one.
6. On a second browser window or phone-sized viewport, sign in as `student-1`, open the check-in link, claim, share location, take a photo and submit. Approve it as the teacher. Your data persists between starts.

Stop with **Ctrl+C**. Re-running `npm run demo` keeps your data and passwords.

### Proof policy (chosen by the teacher per session)

| Policy | Needs | Assurance |
|---|---|---|
| **GPS + teacher review — no ESP32 needed** (default) | Nothing extra | Weaker proof that the student is in the room |
| **GPS + ESP32 classroom proof + teacher review** | Configured ESP32 board | Student must also fetch a signed response from the classroom board |

A missing or offline ESP32 never blocks baseline sessions and can never produce attendance in an ESP32-required one. To drop the requirement mid-class use **Start replacement session without ESP32** (confirmation required); the old session closes to new claims and earlier attempts keep their original rules.

## What you get

- Teacher: live QR session, review drawer (photos, GPS accuracy, advisory similarity), recorded / to-review / need-action / enrolled counts, **estimated room occupancy** (approved check-ins, check-outs and expiry — not a headcount), checks-and-anomalies panel, classroom map and geofence editor, timetable, role control for the developer account.
- Student: one-shot location, camera, clear outcome text (“Submitted — awaiting teacher review.” → “Attendance recorded.”), optional **Check out of room**.
- Privacy: submitted photos live in server memory for at most 15 minutes (or until review) and are never written to disk, Firestore or browser storage. Location is read once per check-in. No continuous tracking.

## Commands

| Command | What it does |
|---|---|
| `npm run demo` | Local mode: check Node, `npm ci` if needed, build if stale, start on loopback, announce when reachable |
| `npm run demo:connected` | Same, but explicitly Firebase mode — fails clearly if configuration is incomplete |
| `npm run full` · `Start Tech Pulse.command` | Everything above in one step (Firebase if configured + phones) |
| `npm run stop` · `Stop Tech Pulse.command` | Stops Tech Pulse processes from this folder only |
| `npm run demo:phones` | Private HTTPS address for phones (needs mkcert + Caddy) — [docs/PHONES.md](docs/PHONES.md) |
| `npm run setup` | Writes private runtime configuration (local or Firebase) |
| `npm run firebase:init` | Provisions the first owner (developer) account — [docs/FIREBASE.md](docs/FIREBASE.md) |
| `npm run doctor` | Read-only environment report |
| `npm run esp32:prepare` / `esp32:compile` / `esp32:upload` | ESP32 firmware tooling — [docs/ESP32_COMPANION.md](docs/ESP32_COMPANION.md) |
| `npm run deploy:web` | Builds the static showcase; deploys only with `-- --confirm` |
| `npm test` · `npm run test:browser` · `npm run test:firebase` | Node tests · Chrome tests · Firebase emulator tests |
| `npm run release` | Builds the scanned release zip in `release/` |

## Documentation

[docs/PROJECT.md](docs/PROJECT.md) architecture and rules · [docs/EVALUATION.md](docs/EVALUATION.md) problem-statement mapping · [docs/FIREBASE.md](docs/FIREBASE.md) · [docs/PHONES.md](docs/PHONES.md) · [docs/ESP32_COMPANION.md](docs/ESP32_COMPANION.md) · [docs/DEMO.md](docs/DEMO.md) · [docs/FINAL_CHECKLIST.md](docs/FINAL_CHECKLIST.md) (actual results) · [docs/HANDOFF.md](docs/HANDOFF.md) · [docs/DEVLOG.md](docs/DEVLOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

## Limits you should know

- One running attendance backend per data store; sized for the four-user demonstration (the algorithm is not load-tested beyond that).
- GPS can be inaccurate indoors; poor accuracy asks the student to retry rather than accusing anyone. No universal spoofed-GPS detection is claimed.
- The public Firebase Hosting page, if deployed, is a static showcase only; it cannot reach the private local backend.
- Illustrative classroom coordinates are placeholders: replace them with the real venue before a demonstration.
- No licence has been selected; `problem-statements.pdf` is deliberately not redistributed.
