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

## Done on the real system

Real Firebase project configured, owner provisioned, deny-all rules published and verified, connected sign-in/exchange verified, ESP32 flashed (Wi-Fi network seen), HTTPS phone origin served on the Mac. Details: [FINAL_CHECKLIST](FINAL_CHECKLIST.md) §3 and §6.

## Pending (needs people and phones)

1. Install `rootCA.pem` on an iPhone and an Android phone and open the Phone URL printed by `npm run demo:phones` (use `TECHPULSE_HTTPS_PORT` if 8443 is taken).
2. Create teacher/student accounts (students register; the owner sets roles), put students on a schedule roster, run baseline and ESP32-required cycles, power-cycle the ESP32 on a supply, confirm exactly one record per student.
3. Replace the illustrative venue coordinates with the real room.
4. Choose a licence, GitHub destination and authorize the push; `npm run deploy:web -- --confirm` only if the showcase page is wanted.

## Rules for changes

Keep `decision: VERIFIED` / `phase: COMPLETED`. Anything that mutates state must go through `mutate()` in `server/app.js` (rollback on failed persistence). Do not store photos, passwords or secrets in Firestore or browser storage. Never test against `server/data/store.json`; use temp directories (see `playwright.config.js`, `tests/launch-helpers.js`).

## Existing data

The working database (`server/data/store.json`) and `private/` were never reset, migrated or uploaded by this work.
