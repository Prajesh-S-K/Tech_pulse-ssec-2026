# Tech Pulse — geo-fenced smart attendance

Students check in from a phone (location + camera + QR), the responsible teacher reviews the evidence, and attendance is recorded exactly once, with an estimated room-occupancy view and an anomaly panel. It runs on **one computer, with no cloud account and no hardware** — everything else (phones, ESP32 classroom proof, Firebase accounts) is optional.

> Honest scope: a prototype for the Tech Pulse 2026 problem statement _Geo-Fenced Smart Attendance & Resource Management_. A **teacher** confirms identity; image similarity is advisory only. Items nobody has physically run are marked _not tested_ in [docs/FINAL_CHECKLIST.md](docs/FINAL_CHECKLIST.md).

---

## Judge guide

### What you need

A computer with **Node.js 22.12 or newer** (free: https://nodejs.org/ → LTS installer). Nothing else. The first start downloads the dependencies once (about 1–3 minutes, needs internet); later starts take a few seconds.

### 1 · Extract and start (pick one)

| Your computer  | Do this                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| **Mac**        | Double-click **`Start Tech Pulse.command`** (first time: right-click → _Open_ → _Open_) |
| **Windows**    | Double-click **`Start Tech Pulse.bat`**                                                 |
| Any / terminal | Open a terminal in this folder and run `npm run demo`                                   |

Your browser opens the portal by itself, and a text file with **all demo logins** opens too (`private/DEMO-LOGINS.txt`). Leave the window open; close it (or press Ctrl+C) to stop.

### 2 · Demo logins

Passwords are generated for **your copy** the first time it starts and are in `private/DEMO-LOGINS.txt` (opened for you; reopen it any time). Sign in with the _account_ in the first box.

| Account                   | Role      | Good for                                                     |
| ------------------------- | --------- | ------------------------------------------------------------ |
| `teacher`                 | Teacher   | Starts sessions, reviews photos (Embedded Systems, DSP)      |
| `teacher-2`               | Teacher   | IoT course; shows teachers only see their own classes        |
| `dev`                     | Developer | Everything, audit logs, role control                         |
| `student-1` … `student-6` | Students  | Enrolled in the sample courses (`student-2` is in all three) |

### 3 · Five-minute walkthrough (no phone needed)

1. Sign in as **`teacher`** → _Live Attendance_ → _Session type: Demo_ → **Start selected session**.
2. Open a **second browser window** (private/incognito works) → paste the _Student check-in link_ → sign in as **`student-1`** → _Claim attendance attempt_ → _Read my location_ → _Open camera_ → _Capture photo_ → _Submit_. (Allow location/camera. On a laptop the location is wherever you are, so first press the teacher's _Use my current location_ button to put the classroom where you are.)
3. Back as teacher: **Review Photos** → **Approve Identity**. The student sees **“Attendance recorded.”**
4. The teacher's **Estimated room occupancy** shows 1; the student's **Check out of room** brings it to 0 (attendance stays recorded).
5. Try a rejection (student far away) to see **Checks and anomalies**, or pick the ESP32 proof policy to see the stricter mode. The Chrome device toolbar (F12 → phone icon) shows the phone layout.

### 4 · Optional: real phones (Mac, about 3 minutes)

Double-click **`Start Tech Pulse with Phones.command`**. It stops any older copy, installs the two small helper tools with Homebrew if needed, and prints **two QR codes**:

1. **STEP 1 — scan to trust the demo certificate** (once per phone). iPhone: _Download profile → Settings → Profile Downloaded → Install_, then _Settings → General → About → Certificate Trust Settings_ → switch on. Android: download, open the file and confirm.
2. **STEP 2 — scan to open Tech Pulse.** Sign in as a student and check in.

Phones must be on the **same Wi-Fi** as the computer. More detail and troubleshooting: [docs/PHONES.md](docs/PHONES.md). (Windows/Linux: use the desktop walkthrough above; the phone helper is Mac-only.)

### 5 · Optional: ESP32 classroom proof and Firebase

Both need private hardware/credentials the owner holds, so they are not part of the judge flow. The owner: ESP32 → [docs/ESP32_COMPANION.md](docs/ESP32_COMPANION.md) (`npm run esp32:upload`, flashed once); Firebase accounts → [docs/FIREBASE.md](docs/FIREBASE.md). With a configured Firebase, the _with Phones_ launcher starts in Firebase mode automatically (`--local` forces plain local mode).

---

## If something goes wrong

| What you see                      | What to do                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------- |
| “Node.js … is needed”             | Install Node LTS from https://nodejs.org/, then start again                       |
| Mac says the file can't be opened | Right-click the `.command` file → _Open_ → _Open_ (once)                          |
| “Port … is in use” note           | Nothing to do — the program uses the next free port and prints it                 |
| Start seems stuck for a minute    | First start is downloading dependencies; wait for the browser to open             |
| Browser did not open              | Open the address printed in the window (`http://127.0.0.1:5173` or the next port) |
| Forgot a password                 | `private/DEMO-LOGINS.txt`                                                         |
| Want a clean slate                | Close the program, delete the `private` and `server/data` folders, start again    |
| Anything else                     | Run `npm run doctor` in a terminal: it lists problems and fixes                   |

## Commands (optional reference)

| Command                                                           | What it does                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run demo`                                                    | Local demo (what the double-click files run)                 |
| `npm run full`                                                    | Phones + Firebase-if-configured (the _with Phones_ launcher) |
| `npm run stop`                                                    | Stops Tech Pulse processes from this folder only             |
| `npm run doctor`                                                  | Read-only environment report                                 |
| `npm test` · `npm run test:browser` · `npm run test:firebase`     | Node · Chrome · Firebase-emulator tests                      |
| `npm run release`                                                 | Builds the scanned release zip in `release/`                 |
| `npm run setup` · `firebase:init` · `esp32:upload` · `deploy:web` | Owner tools (Firebase, ESP32, showcase page)                 |

## What it does

- **Teacher:** live QR session, review drawer (photos, GPS accuracy, advisory similarity), Recorded / To review / Need action / Enrolled, **estimated room occupancy** (approved check-ins, check-outs, expiry — not a headcount), checks-and-anomalies panel, classroom map and geofence editor, timetable.
- **Student:** one-shot location, camera, clear outcome text, optional _Check out of room_.
- **Proof policy per session:** _GPS + teacher review — no ESP32 needed_ (default, weaker proof) or _GPS + ESP32 classroom proof + teacher review_. A missing board never blocks the first and never produces attendance in the second; _Start replacement session without ESP32_ switches mid-class (with confirmation) without double-recording anyone.
- **Privacy:** photos live in server memory ≤ 15 minutes (never disk, cloud or browser storage); location is read once per check-in; no tracking.

## Documentation

[docs/EVALUATION.md](docs/EVALUATION.md) problem-statement mapping · [docs/PROJECT.md](docs/PROJECT.md) architecture · [docs/DEMO.md](docs/DEMO.md) · [docs/PHONES.md](docs/PHONES.md) · [docs/FIREBASE.md](docs/FIREBASE.md) · [docs/ESP32_COMPANION.md](docs/ESP32_COMPANION.md) · [docs/FINAL_CHECKLIST.md](docs/FINAL_CHECKLIST.md) (actual results) · [docs/HANDOFF.md](docs/HANDOFF.md) · [docs/DEVLOG.md](docs/DEVLOG.md)

## Limits you should know

- Sized for the four-user demonstration; one running backend per data store.
- GPS can be poor indoors; poor accuracy asks the student to retry rather than accusing anyone. No universal spoofed-GPS detection is claimed.
- A public Firebase Hosting page, if deployed, is a static showcase only.
- The sample classroom coordinates are placeholders — use _Use my current location_ or _Classrooms → Edit_ for the real room.
- No licence selected; `problem-statements.pdf` is deliberately not redistributed.
