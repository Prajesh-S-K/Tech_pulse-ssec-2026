# Final checklist — actual results

Run on 2026-10-01 (Asia/Kolkata) with Node 24.19.0, macOS (Apple Silicon). Results are copied from real command output. **Not tested** means nobody has performed it; it is never implied to pass.

## 1. Automated software checks (local, isolated fixtures)

| Command                             | Result                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                          | **92 / 92 passed**, 0 failed, 0 skipped (policy, API, launcher, phones, one-command launcher, tooling, persistence, occupancy, concurrency, release)                     |
| `npm run test:browser`              | **11 / 11 passed** in Chrome (sign-in, review drawer, expiry, policy/replacement, occupancy/check-out/anomalies, maps, three phone widths, permissions/camera/clipboard) |
| `npm run build`                     | passed (one bundle-size warning; Firebase SDK is a separate lazy chunk)                                                                                                  |
| `npm run format:check`              | passed                                                                                                                                                                   |
| `npm run doctor`                    | runs read-only; reports the Admin key as invalid (see §3)                                                                                                                |
| `npm run esp32:compile`             | passed — 931,828 bytes (71%) program, 47,152 bytes (14%) dynamic memory                                                                                                  |
| `npm run esp32:upload -- --dry-run` | passed — discovery and port-free only; nothing probed, compiled or written                                                                                               |

All of these use temporary data/credential/presence directories. **No test touched `server/data/store.json` or `private/`.**

## 2. Firebase emulator checks (Auth + Firestore emulators, JDK 26)

`npm run test:firebase` → **14 / 14 integration tests** and **2 / 2 browser UI tests** passed, exit 0. They cover: ID-token verification and role loading from server records; local login disabled; role elevation is developer-only; student/teacher authorization and enrollment; atomic approval writing attempt + attendance + presence; duplicate approval returns the existing result; failed commit → `503 PERSISTENCE_FAILED`, attempt still awaiting review, evidence kept, nothing recorded; restart requires recapture; 8-hour cap from original sign-in and logout revocation; deny-all Firestore rules block signed-in and anonymous browser SDK access; check-out persistence and no reactivation; replacement chain in both approval orders including concurrent approval → exactly one attendance and one presence; **repository regression tests** (real `FirestoreRepository` on the emulator): creating an existing attendance document does not overwrite it, creating an existing checked-out presence keeps `checkedOutAt`, an authorized checkout update still persists, and the persistence cache adopts the durable record when Firestore retained a different one (these fail against the previous commit logic); real UI registration, profile update, reload, silent session renewal (limit not extended), logout without automatic re-login, teacher sign-in.

Emulator-tested ≠ real-project-tested.

## 3. Real Firebase project (`tech-pulse-ssec`)

| Check                                                                                     | Result                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admin credential                                                                          | **Valid** service-account JSON for `tech-pulse-ssec` (validated without printing; file mode 600)                                                                                           |
| Configuration                                                                             | `private/runtime.json` written (public web config + key path); `npm run doctor` all OK                                                                                                     |
| Live connection                                                                           | Auth and Firestore reachable; database was empty                                                                                                                                           |
| Owner account                                                                             | Created in Authentication and given `dev` role in `users/{uid}`; 3 default classrooms seeded. No historical local data uploaded                                                            |
| Connected server against the real project                                                 | Starts; Firebase sign-in → `/api/session/exchange` returned role `dev`, 8-hour session; state and logout work                                                                              |
| Firestore rules                                                                           | **Published** (deny-all) through the Admin SDK Rules API. Verified against the live database: anonymous read, signed-in read and signed-in write from the client path all returned **403** |
| `firebase deploy` CLI                                                                     | Not usable with the service account (403 on the service-usage API); the Rules API route above was used instead                                                                             |
| Full attendance cycle on the real project (students, teacher review, approval, check-out) | **Not tested**                                                                                                                                                                             |

## 3b. One-command launcher (v0.4.0), run for real on this Mac

`Start Tech Pulse.command` found Node 24 itself, validated the Firebase configuration, put the public certificate at `~/Downloads/TechPulse-rootCA.pem`, detected the ESP32 and served `https://<LAN-IP>:8443` with a QR code. Launching it a second time **stopped the 4 older Tech Pulse processes** (2 launchers, the server, the proxy) and started cleanly; the page loaded over HTTPS with the mkcert CA. Unrelated programs are never stopped (test `tests/full.test.js`). Not tested: a real phone opening the QR code.

## 3c. Judge experience (v0.5.0)

Extracted `tech-pulse-0.5.0.zip` into an empty folder and ran **`Start Tech Pulse.command`** in a bare environment (`env -i`, only `/usr/bin:/bin`; the launcher found Node 24 by itself, `TP_NO_OPEN=1` only to keep the test from opening windows). Result: dependencies installed, client built, server started, **`private/DEMO-LOGINS.txt` written (mode 600) listing all 9 accounts with their roles and the 5-minute walkthrough**, then the same acceptance walk as §4 passed (0 sessions at start, teacher session → student submit → teacher approval = 1 record, wrong password 401, student blocked from teacher API 403, restart keeps data, credentials unchanged, port released). The with-Phones launcher was run for real on this Mac: it stopped the older instance, printed both QR codes and served the certificate page (page 200, public CA byte-identical to mkcert's `rootCA.pem`, iPhone profile and Android file served, any attempt to fetch the private key returned 404). A real phone scanning them is **not tested**. Windows `.bat`: written, **not run** (no Windows machine).

### 3d. Quiet, plain start (v0.5.1)

Reproduced the reported problem (VS Code terminal, default Node 22.9, red "too old" error and a wall of npm warnings) and fixed it: with the old Node first on `PATH`, `npm run demo` in a fresh extract now switches to the installed Node 24 by itself and prints only "Step 1 of 3 … Step 3 of 3", the address and the login-list path (no npm notices, no Caddy logs, no duplicate banners). If no suitable Node exists the message is three plain steps. Full output is shown only on failure.

### 3e. QR codes and Windows (v0.6.0)

Reported problem: the terminal QR codes were not scannable. Fix: the launcher now opens a browser page (`/setup`) with two large black-on-white QR codes. Verified by screenshotting that page and decoding it with macOS Vision: both codes decode to exactly `https://<LAN-IP>:8443` and `http://<LAN-IP>:8765/`. Windows: full-version launchers, winget tool install, Windows process detection, Windows-safe Caddyfile paths and Wi-Fi address selection are implemented and unit-tested with Windows-shaped input (`tests/windows.test.js`). **Not tested:** a real phone scanning the codes; any run on an actual Windows machine.

## 4. Fresh download acceptance

Extracted `release/tech-pulse-0.3.0.zip` into an empty directory (no `private/`, data, dependencies or build) and ran the default `npm run demo` with **no** `STORE_PATH`/`CREDENTIALS_PATH`/`PRESENCE_CONFIG` overrides.

| Check                                                                                                                      | Result                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean environment (`env -i`, Node 24.19.0 first on PATH), no `private/`, data, `node_modules` or `dist`, no path overrides | `npm run demo` ran `npm ci`, built the client, started and printed the URL only after the server answered                                                                                    |
| Preferred port occupied by an unrelated program (the owner's own server on 5173)                                           | That program kept running untouched; the launcher announced and used **5174**                                                                                                                |
| Generated credentials                                                                                                      | `private/account-passwords.json` created with 0600 permissions, 9 unique accounts; banner prints the path, never a password                                                                  |
| Login                                                                                                                      | teacher/student login with generated passwords succeeded; a wrong password returned 401                                                                                                      |
| Sessions at first start                                                                                                    | **0** (no sample sessions or attendance created)                                                                                                                                             |
| Teacher-created session → student claim → submit → teacher approval                                                        | session created (200); student reached _awaiting review_; approval gave `VERIFIED` / `COMPLETED`; exactly **1** attendance record; a student calling a teacher API got 403                   |
| Ctrl+C                                                                                                                     | Port released; no orphan process                                                                                                                                                             |
| Restart                                                                                                                    | No reinstall or rebuild; the session, attendance, attempt and occupancy estimate were still present; **no new sample sessions**; the password file byte-identical; student login still valid |
| Unsupported Node, missing lockfile, failed install/build, server dying at startup                                          | Covered by `tests/launcher.test.js` (clear errors, non-zero exit, no ready banner)                                                                                                           |

These results were obtained on an earlier build and repeated on the archive containing the final `FirestoreRepository` create-guard fix (identical results, including port 5174 selection while an unrelated program held 5173). The shipped archive differs from that tested build only in this results text.

## 5. Release contents

| Check                                                            | Result                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archive                                                          | `release/tech-pulse-0.3.0.zip` from an explicit allow-list (`npm run release`); manifest with SHA-256 per file in `release/MANIFEST.txt`                                                                                   |
| Contents                                                         | source, `package-lock.json`, `.nvmrc`, dotfiles needed for setup, `examples/` placeholders, docs and synthetic screenshots, tests, firmware source                                                                         |
| Excluded                                                         | `private/`, `server/data/`, generated `config.h`, `firmware/build/`, dependencies, build output, logs, `test-results/`, the source PDF, any key/credential-shaped file                                                     |
| Secret scan (manifest, then the extracted archive independently) | **0 findings**; findings would print only `file:line`. No Firebase web API key appears anywhere in the archive; if one did it would be reported as a public client-configuration note, separate from Admin/signing secrets |
| Machine-specific paths                                           | none in the archive (scanner flags them)                                                                                                                                                                                   |
| Git exclusions                                                   | verified in a temporary repository first: 101 tracked files; `private/`, `server/data/`, `firmware/build/`, `config.h`, `dist/`, `release/`, logs, the PDF and `.DS_Store` are all ignored                                 |
| Real repository                                                  | `git init` run only after the checks above; files staged for review, **no commit made, nothing pushed**                                                                                                                    |

## 6. Physical checks

| Check                                                             | Result                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Connected board identity (read-only `chip-id`/`flash-id`)         | `ESP32-D0WD-V3`, 4MB flash — **discovery and verification only**                      |
| Flash the ESP32                                                   | **Not performed** (awaiting authorization)                                            |
| Serial readiness at 115200 baud                                   | **Not tested**                                                                        |
| Standalone USB power-up, Wi-Fi + portal, repeat after power cycle | **Not tested**                                                                        |
| iPhone Safari attendance cycle (HTTPS, network switching)         | **Not tested**                                                                        |
| Android Chrome attendance cycle                                   | **Not tested**                                                                        |
| Missing/altered/expired/cross-student proof on real hardware      | **Not tested** (software fixtures pass)                                               |
| Exactly one approved record per student after real cycles         | **Not tested**                                                                        |
| Real mkcert/Caddy HTTPS run                                       | **Not tested** (mkcert and Caddy not installed; launcher logic tested with stand-ins) |
| Battery measurement                                               | **Not tested**                                                                        |

## 7. Known unresolved items

- Full real-project attendance cycle.
- Hardware/phone acceptance above.
- Illustrative venue coordinates still need replacing with the real demonstration room.
- No licence selected; nothing pushed, deployed or flashed.

## 8. Publication gate

- [x] Secret/private-material scan of the release manifest and archive (see §5)
- [x] Git exclusions verified in a temporary repository before the real repository was initialised (staged, uncommitted)
- [ ] Licence and GitHub destination chosen — **awaiting owner**
- [ ] Push authorised — **awaiting owner**
- [ ] `npm run deploy:web -- --confirm` authorised (optional) — **awaiting owner**
