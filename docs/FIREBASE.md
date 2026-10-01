# Firebase connected mode (optional)

Local mode (`npm run demo`) never needs Firebase. Connected mode adds **Firebase Email/Password sign-in** and **durable Firestore metadata** while the Node backend you run stays the single authority for attendance decisions. Project: **`tech-pulse-ssec`**, Spark (free) plan.

> Status: implemented and **tested against the Firebase Auth + Firestore emulators** (see [FINAL_CHECKLIST](FINAL_CHECKLIST.md)). Real-project validation is a separate step and is _not tested_ until a valid Admin key is supplied.

## What Spark allows here

Authentication, Firestore and classic Hosting only. This project uses **no** Cloud Functions, Cloud Run, App Hosting, Cloud Storage or billing upgrade. Submitted photos never go to the cloud.

## One-time Console steps

1. Confirm the project is on **Spark** with no billing account attached.
2. **Authentication → Sign-in method → Email/Password**: enable.
3. **Firestore Database → Create database** (Standard edition). Choose the region deliberately; do not recreate a database to change it.
4. **Authentication → Users → Add user** for the person who will own the system (the _owner_).
5. **Project settings → Service accounts → Generate new private key**. The download is a `.json` file. Save it as **`private/firebase-service-account.json`**. (The Console also shows a Node.js code snippet — that snippet is _not_ the key.) Never paste this file into chat, commit it or email it.

## Secure the database (rules)

`firestore.rules` in this repo denies **all** browser/mobile access (`allow read, write: if false`). The Admin SDK used by the backend bypasses rules, so authorization is enforced by the backend and covered by tests.

A rules file in the repo does **not** protect your database until it is published. After `npx firebase login` (done by you):

```sh
npx firebase deploy --only firestore:rules --project tech-pulse-ssec
```

Inspect the current rules in Console → Firestore → Rules first; do not assume Production mode or secure rules are already active.

## Configure and start

```sh
npm run setup          # choose "firebase"; paste the PUBLIC web config (apiKey, appId, ...) and the key file path
npm run doctor         # shows whether the web config and Admin key match tech-pulse-ssec
npm run firebase:init  # gives the existing owner account developer permissions (idempotent)
npm run demo:connected # starts connected mode on loopback
```

`setup` writes `private/runtime.json` (ignored by Git; shape in `examples/runtime.example.json`). The Firebase **web** configuration is public client configuration, not a secret; the Admin key is. Invalid or mismatched configuration stops the server with a clear message — it never falls back to local accounts.

## How sign-in works

1. The browser signs in with the Firebase SDK (per tab).
2. It sends the Firebase **ID token** to `POST /api/session/exchange`. The backend verifies it (including revocation), loads the user's **server-controlled role** from Firestore `users/{uid}` and issues an ordinary revocable server session bound to that UID.
3. The browser uses only that server token for API calls and the live event stream.
4. The server session ends **eight hours after the original Firebase sign-in** (`auth_time`). Refreshing the ID token or exchanging again does not extend it. When the server session dies the browser silently re-exchanges **once**; if the original sign-in is too old it returns to the sign-in page.
5. Logout revokes the server session, closes its event stream and signs out of Firebase. It does not sign back in automatically.

Roles reuse the application's vocabulary: `student`, `admin` (= **teacher**), `dev` (= developer). New self-registered accounts are always `student`. Only a developer can change a student/teacher role (Student Directory → _Role control_); nobody can create a developer through the app. The owner is provisioned by `firebase:init`.

## Data model (backend-only collections)

| Collection      | Document id                 | Contents                                                         |
| --------------- | --------------------------- | ---------------------------------------------------------------- |
| `users`         | Firebase UID                | name, role, email, roll, dept                                    |
| `classrooms`    | id                          | venue name, coordinates, radius, tolerance, configured seats     |
| `schedules`     | id                          | course, teacher UID, venue, time, roster (student UIDs)          |
| `sessions`      | id                          | session policy, deadlines, `attendanceEventId`                   |
| `attempts`      | id                          | phase, decision, reasons, distance/accuracy, advisory similarity |
| `attendance`    | `<attendanceEventId>_<uid>` | one record per student per attendance event                      |
| `roomPresences` | `<attendanceEventId>_<uid>` | check-in/expiry/check-out timestamps and ids only                |

**Never stored in Firestore:** passwords or hashes (Firebase Auth holds credentials), submitted photos, reference photos (kept in a private local file `server/data/reference-photos.json`), ESP32 signing keys, coordinates of presence records.

## Durability rules

- Approval writes the reviewed attempt, the unique attendance record and the room presence record in **one Firestore transaction**. Attendance and presence documents use deterministic ids and are created once (`create-if-absent`); a checkout is a separate authorized update that persists. Every create target is read inside the transaction before any write; if a document already exists it is kept untouched and the in-memory cache adopts the stored version, so the cache never disagrees with Firestore.
- If the write fails the server answers **`503 PERSISTENCE_FAILED` (retryable)**, the cache is rolled back, the attempt stays _awaiting review_ and its photo evidence is kept so the teacher can retry. A false "approved" is never shown.
- Reads and live updates are serialized behind in-flight writes, so no one sees an uncommitted result.
- A replacement session shares its original's `attendanceEventId`, so a student cannot be recorded twice across the chain.
- After a restart, photos are gone; pending reviews return to _Try that step again_ (recapture required). Attendance and presence survive.
- If only the private reference-photo file fails to write, the response carries a `REFERENCE_PHOTO_NOT_SAVED_LOCALLY` warning and the (already committed) Firestore data is **not** rolled back.

Affected write paths (all go through one queue): start/rotate/stop/replace sessions, claim, submit, review, checkout, schedule/classroom/profile edits, role changes, exchange (first-time student provisioning).

## Hosting (static showcase only)

`npm run deploy:web` builds `showcase/index.html` into `dist-web/`. Deployment requires `-- --confirm` plus your own `firebase login`; nothing deploys by default. The hosted page explains how to run the portal; it collects nothing and cannot reach the private backend. Phones use the Mac's private HTTPS origin instead ([PHONES.md](PHONES.md)).

## Tests

```sh
brew install openjdk        # firebase-tools 15 needs JDK 21+ for the Firestore emulator
npm run test:firebase       # Auth+Firestore emulators: 14 integration tests + 2 browser UI tests
```

The runner searches for Java 21+, uses a throw-away `demo-tech-pulse` project and touches no real data. If no JDK 21+ exists it exits with code 2 and says **not run** — a skip is never counted as a pass. A real-project smoke test must use clearly labelled temporary records and delete only those.
