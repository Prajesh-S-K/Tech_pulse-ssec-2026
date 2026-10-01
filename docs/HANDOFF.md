# Handoff — current state

Run `npm run demo`, read [README](../README.md). This page tells the next person what is real, what is verified and what remains.

## State of the tree

- Local mode, defect fixes, hardware-optional proof policy with replacement, estimated occupancy with check-out, anomaly panel, Firebase connected mode (emulator-tested), launcher/tooling, ESP32 tooling, phone HTTPS launcher, release archive tooling and docs are implemented.
- Results (exact commands and counts) are in [FINAL_CHECKLIST](FINAL_CHECKLIST.md). Unperformed checks are marked **not tested**.

## Where things are

| Concern               | Files                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Rules and state       | `server/store.js`, `src/domain/trust.js`                                                                                   |
| Routes, sessions, SSE | `server/app.js`                                                                                                            |
| Firebase mode         | `server/firebase/*`, `src/firebaseAuth.js`, `tests/firebase/*`                                                             |
| Launchers and tooling | `scripts/*.js`, `scripts/lib/*`                                                                                            |
| Tests                 | `tests/*.test.js` (Node), `tests/*.spec.js` (Chrome), `tests/firebase/*` (emulators), `tests/diagnostics/*` (manual tools) |

## Pending (needs people or devices)

1. Real Firebase project validation — needs a valid `private/firebase-service-account.json` (downloaded JSON key; the file currently present is a code snippet and fails validation), owner account created in Authentication, rules published (`npx firebase deploy --only firestore:rules --project tech-pulse-ssec` after `npx firebase login`).
2. Flash the ESP32 (`npm run esp32:upload`), power-cycle test, then iPhone Safari + Android Chrome cycles through `npm run demo:phones` (install mkcert/Caddy first). Includes exactly-one-record-per-student confirmation and ESP32 network switching.
3. Replace illustrative venue coordinates with the real room.
4. Choose a licence, GitHub destination and authorize the push; authorize `npm run deploy:web -- --confirm` if the showcase page is wanted.

## Rules for changes

Keep `decision: VERIFIED` / `phase: COMPLETED`. Anything that mutates state must go through `mutate()` in `server/app.js` (rollback on failed persistence). Do not store photos, passwords or secrets in Firestore or browser storage. Never test against `server/data/store.json`; use temp directories (see `playwright.config.js`, `tests/launch-helpers.js`).

## Existing data

The working database (`server/data/store.json`) and `private/` were never reset, migrated or uploaded by this work.
