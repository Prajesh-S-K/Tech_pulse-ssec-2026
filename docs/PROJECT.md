# Project specification — current behaviour

Authoritative description of what the code does today. History lives in [DEVLOG](DEVLOG.md); working state in [HANDOFF](HANDOFF.md); the requirement mapping in [EVALUATION](EVALUATION.md); actual results in [FINAL_CHECKLIST](FINAL_CHECKLIST.md).

## Stack

React 19 + Vite client (`src/`), Express 5 API (`server/`), Leaflet maps, optional ESP32 companion (`firmware/`). Node ≥ 22.12 (24 recommended; `.nvmrc`). Optional Firebase Auth/Firestore through `firebase-admin` (backend) and the web SDK (browser, loaded lazily in connected mode only).

## Modes

|             | Local (`npm run demo`)                                                                                    | Connected (`npm run demo:connected`)                                         |
| ----------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Accounts    | Salted scrypt hashes in `server/data/store.json`; generated passwords in `private/account-passwords.json` | Firebase Email/Password; roles from Firestore `users/{uid}`                  |
| Storage     | One JSON file (atomic write, mode 0600); a failed write rolls the change back and returns a retryable 503 | Firestore transactions via a serialized queue (see FIREBASE.md)              |
| Needs       | Node                                                                                                      | Node + Firebase project + Admin key                                          |
| Selected by | The launcher (always `local`, ignores `private/runtime.json`)                                             | `AUTH_MODE=firebase` + valid `private/runtime.json`; invalid config is fatal |

There is never a silent switch between identity systems.

## Roles

`student`, `admin` (**teacher**), `dev` (developer). Self-registration creates students only. A developer can change student↔teacher roles; nobody can create a developer through the app. Authorization is checked on every request from the _current_ server-side user record (a role change takes effect immediately for API calls and the live stream).

## Attendance rules

1. Teacher starts a session for a course (scheduled = Asia/Kolkata timetable window; demo = visible, logged timetable override) with a **proof policy**: baseline (GPS + teacher review) or ESP32-required. Default is baseline. Starting a session never happens automatically.
2. Students claim by QR challenge (60 s; rotates). The server derives session/course/room, checks explicit enrollment and creates **one attempt per student per session**. Completion windows: baseline 90 s, ESP32 180 s, plus a fixed 15 s upload allowance; the client clock is never trusted.
3. Submission needs a valid JPEG/PNG photo and location. Location evaluation (`src/domain/trust.js`): uncertain accuracy / boundary → retry; definitely outside → rejected; inside → continue. ESP32 sessions also need a valid signed response (missing → retry; invalid → suspicious).
4. Valid evidence → **awaiting teacher review** (`phase AWAITING_REVIEW`). Image similarity is advisory (`advisorySimilarity`), never a verdict and never preselects approval.
5. The responsible teacher (or developer) approves or rejects while the photo exists (≤ 15 min, memory only). Approval sets `decision: VERIFIED`, `phase: COMPLETED` and writes **one** attendance record plus **one** room-presence record keyed by the attendance event and student. Rejection or expiry never records attendance. Expired/lost evidence requires recapture; a review cannot override failed required proof.
6. **Replacement**: switching an ESP32 session to baseline closes the old session to new claims and starts a new session that shares the root `attendanceEventId`; old attempts keep their policy and deadlines; attendance and presence uniqueness are per event, so either approval order yields one record.
7. **Estimated room occupancy**: unique students with an approved, un-checked-out, un-expired presence record (expiry = scheduled class end, or session start + 60 min for demo sessions; computed from server time on every read). Students check out of their own record (by id, idempotent); attendance is unaffected. Teachers see counts for their own sessions only; developers see all; students see only their own presence.

## Evidence and privacy

Submitted photos: server memory only, ≤ 15 min, removed on review; absent from saved JSON, Firestore, developer export and browser storage. Reference photos: private local file(s) only, never Firestore. Browser storage holds only `{token, expiresAt, user{id,name,role,email,roll,dept}}` plus opaque selected-session/attempt ids. Location is read once; the server keeps distance and accuracy, not raw coordinates.

## Security notes

Origin/host checks on every `/api` call; `PUBLIC_ORIGIN` (exact https origin) + `TRUST_PROXY` only with the private HTTPS launcher; password hashing with scrypt; 8-hour sessions (connected: from original Firebase sign-in); logout revokes the session and its event streams. Firestore rules deny all client access; the backend uses the Admin SDK. The working diagnostic simulation endpoint was removed.

## Source layout

`server/app.js` routes · `server/store.js` rules and state · `server/snapshot.js` rollback · `server/presence.js` ESP32 HMAC · `server/firebase/*` connected mode · `src/main.jsx` UI · `src/components/*` · `scripts/*` launcher/tools · `tests/*` · `docs/*`.

## Decisions and non-goals

Teacher-reviewed identity instead of neural face recognition; Spark-only Firebase; one backend per data store; classic Hosting for a static showcase only; no public tunnel; no continuous location tracking; no booking system. See EVALUATION.md for limitations.
