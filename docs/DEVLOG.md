# Development log

> Entries are chronological and **historical**. Earlier entries describe behaviour that no longer exists (public demo accounts, passwordless sign-in, simulation scenarios, automatic face verification, a capacity/seats dashboard). Current behaviour is in [PROJECT.md](PROJECT.md) and the README.

Use chronological entries. Record actual actions and outcomes, not planned work as completed.

## 2026-10-01 — Documentation baseline

- Request: align with “Plan Prototype Attendance System,” use the selected folder, support VS Code, and maintain documentation for a future GitHub demo.
- Inspected the project folder: only problem-statements.pdf existed; no existing app or repository scaffold was found.
- Read the five recent exchanges exposed by the chat reader, including the final planning handoff. The reader reported no earlier page; older discussion was not independently retrieved.
- Extracted the selected problem statement from PDF pages 1–2. It calls for cross-platform attendance, location privacy, realtime occupancy, and anomaly detection.
- Created PROJECT, DEVLOG, HANDOFF, README, CONTRIBUTING, DEMO, CHANGELOG, a VS Code workspace, formatting defaults, and Git ignore rules.
- Preserved uncertain details as proposed defaults or open decisions: backend enforcement, zero-cost feasibility, photo storage, timing, and local presence proof.
- Validation: documentation links and workspace JSON checked during setup. No application tests exist or were run.
- No remote repository, cloud provisioning, deployment, or publication performed.

## Entry template

Date / milestone:

- Goal:
- Changes:
- Checks and actual results:
- Failures / fixes:
- Decisions and reasons:
- Remaining work:
- Documentation updated:

## 2026-10-01 — V0.1 local attendance milestone

- User authorized V0.1 implementation, then explicitly selected local-first because no Firebase project exists.
- Built React/Vite student and teacher interfaces with an Express loopback API and in-memory adapter.
- Implemented independent claims, server-owned deadlines, role/ownership checks, idempotent results, geofence policy, real QR URLs, browser camera/location controls, synthetic scenarios, live dashboard, and utilization.
- Preserved source PDF. No cloud account, billing, remote repository, or deployment created.
- Selected Node 24 for development; installed host Node 22.9 does not satisfy Vite requirements. Added .nvmrc, a dependency lockfile, formatted source, and VS Code tasks.
- Tests: all 11 policy/API tests passed. Chrome UI flow passed with teacher/student live updates, reload recovery, poor-GPS retry, outside rejection, and 390px viewport fit. Production build and formatting checks passed.
- Initial checks failed because dependencies were still downloading and the sandbox denied opening a localhost test port. Installed dependencies with network approval and reran the HTTP checks with local-server permission; all passed.
- Reviewed generated desktop and mobile screenshots. Fixed the metric font fallback and ensured simulated submission uses the claimed session's room, even if the teacher later starts another session.
- Confirmed Firebase cloud Storage and deployed Functions require Blaze. Kept Firebase as planned target; cloud cost/architecture remains undecided and no billing was enabled.
- Limits: public demo identities, forgeable client evidence, memory-only persistence, local-only photo, sample timetable, manual QR refresh, no physical phone testing, no ESP32 or face matcher. Late submissions go to pending review, not automatic rejection or approval.
- Updated README, PROJECT, HANDOFF, DEMO, and CHANGELOG to distinguish implemented behavior from remaining full V0.1 work.

## 2026-10-01 — Physical "My device" geolocation & photo capture fixes

- Goal: Resolve physical check-in failures when using real device geolocation and camera, adapt geofencing for realistic indoor/Wi-Fi GPS accuracy, and allow evidence re-submission.
- Changes:
  - `src/domain/trust.js`: Refined geofence math to distinguish true core presence from perimeter uncertainty (`d > r * 0.8 && d + a > r`). Returned computed distance and accuracy in evaluation results.
  - `server/store.js`: Raised default `maxAccuracy` from 35m to 100m to accommodate laptop and indoor phone Wi-Fi positioning. Supported extended classroom radii up to 500m. Allowed re-submitting updated evidence within the 90-second deadline if not yet `VERIFIED`.
  - `src/main.jsx`: Added teacher location sync banner with visual device coordinates feedback, added max accuracy tolerance dropdown (50m, 100m, 150m, 200m), active session geofence display, student functional state updates for camera/photo and location (avoiding stale evidence overwrites), real-time check-in diagnostics on result card (showing distance, radius, GPS accuracy, and actionable hints), and enabled re-submission after rejected attempts.
  - `src/providers/browser.js`: Added specific error messages for location permission denied, GPS unavailable, and timeout.
  - `tests/attendance.test.js`: Added unit tests for realistic Wi-Fi accuracy (65m) and re-submission within deadline. All 13 tests pass.
  - `tests/browser.spec.js`: Added end-to-end browser test for "My device" mode with mocked Geolocation and Camera stream. Passed in 2.3s.
- Checks and actual results:
  - Unit tests: all 13 tests pass (`node --test tests/*.test.js`).
  - Browser tests: Chrome teacher/student flow + "My device" live check-in pass (`npx playwright test`).
  - Production build: `vite build` completed in ~600ms.
  - Prettier formatting: `npm run format:check` clean.
- Documentation updated: DEVLOG.md, HANDOFF.md, DEMO.md, CHANGELOG.md.

## 2026-10-01 — Platform Expansion: Accounts, Schedules, Classrooms & Facial Registration Baseline

- Goal: Transition from single hardcoded course prototype into a structured multi-entity site supporting student/teacher account registration, schedule timetables, geofence management, attendance history, and reference facial profile capture to prepare for facial recognition integration.
- Changes:
  - `server/store.js`: Added models and storage for `users`, `classrooms`, `schedules`, and `attendance`. Added `createUser()`, `createClassroom()`, `createSchedule()`, `updateProfilePhoto()`, and course-linked session launching. Supported JSON file persistence to `server/data/store.json`.
  - `server/app.js`: Added endpoints: `POST /api/register`, `POST /api/profile/photo`, `GET/POST /api/classrooms`, `GET/POST /api/schedules`. Updated `/api/login` to allow login by email, student roll, or user ID. Enforced teacher authorization on admin routes.
  - `src/main.jsx`: Overhauled the application with multi-tab navigation:
    - Auth: Dual-mode sign in (Quick Demo 1-click accounts + New Account Registration with live camera capture for reference face).
    - Teacher tabs: Live Attendance & QR (course selector, geofence sync), Timetable & Schedules, Classrooms & Geofences, Student Directory.
    - Student tabs: Check-In (side-by-side face comparison preview), My Timetable & Records, Face Profile Registration.
  - `src/style.css`: Added tab navigation styling, directory/timetable tables, card grids, and reference-vs-live face comparison containers.
  - `tests/attendance.test.js`: Added unit tests for user registration, profile photo updates, classroom creation, schedule assignment, and attendance recording. Total 15 unit tests pass.
- Checks and actual results:
  - Unit tests: 15/15 tests pass (`npm test`).
  - Browser tests: Chrome end-to-end suite passes in 1.9s (`npx playwright test`).
  - Production build: `npm run build` completed cleanly.
  - Formatting: `npm run format:check` clean.
- Decisions and reasons:
  - Retained "Quick Demo" accounts alongside full registration so existing automated tests and rapid user evaluations remain seamless without needing manual form filling.
  - Persisting reference photo as Base64 data URL locally in user profile allows straightforward client-side face verification integration in the upcoming phase without third-party cloud storage requirements.
- Documentation updated: CHANGELOG.md, DEVLOG.md, HANDOFF.md, PROJECT.md.

## 2026-10-01 — Timetable Editing, Venue Relocation, Geo Locations CRUD, and Dev Console

- Goal: Enable full timetable modification, on-the-fly venue relocation for professors, dynamic geo-location registration with GPS pinning, and a developer console with full audit logs and system telemetry.
- Changes:
  - `server/store.js`:
    - Added dedicated `dev` user to `defaultPeople`.
    - Added comprehensive audit logging (`store.log(category, actor, message, details, level)`), capturing authentication, session lifecycle, venue relocations, student claims, submissions with distances/verdicts, schedule edits, and geofence changes.
    - Added schedule editing and deletion (`updateSchedule()`, `deleteSchedule()`).
    - Added classroom editing and deletion (`updateClassroom()`, `deleteClassroom()`).
    - Added active session venue relocation (`updateSessionVenue()`), dynamically recalculating geofence center, radius, and accuracy policy while preserving active attendance deadlines.
    - Added system statistics telemetry (`getStats()`) and factory reset (`reset()`).
  - `server/app.js`:
    - Added `PUT /api/schedules/:id` and `DELETE /api/schedules/:id`.
    - Added `PUT /api/classrooms/:id` and `DELETE /api/classrooms/:id`.
    - Added `POST /api/sessions/:id/venue` for on-the-fly geofence relocation.
    - Added `GET /api/dev/logs`, `POST /api/dev/logs/clear`, `GET /api/dev/stats`, `POST /api/dev/reset`, and `GET /api/dev/export`.
    - Enabled `dev` role access to admin capabilities (`canAdmin`) and added `canDev` guard.
  - `src/main.jsx`:
    - Supported HTTP methods (PUT, DELETE) in `api()`.
    - Added Developer Role Switcher in the top navigation bar (`Dev Console`, `Teacher View`, `Student View`) allowing live cross-role preview without logging out.
    - Added "Dev Console & Audit Logs" tab: telemetry metrics cards, category filter pills (`All`, `Check-ins`, `Venues`, `Sessions`, `Geofences`, `Schedules`, `Auth`), audit logs table with expandable JSON details, clear logs, JSON dump export, and database reset.
    - Added Schedule Editor and "➕ Add New Course Schedule" form with full editing and deletion on timetable cards.
    - Added Geo Location Creator with 1-click GPS capture button (`getLocation`), editing, and deletion.
    - Added on-the-fly "📍 Relocate Venue / Change Geo Point" drawer in active session view with 1-click professor device coordinate pinning.
  - `src/style.css`: Added styles for role switcher, filter pills, log level badges, category badges, danger buttons, and relocation drawer.
  - `tests/attendance.test.js`: Added 3 unit tests covering classroom CRUD, schedule CRUD, dynamic venue relocation, and dev HTTP endpoints. Total 18 unit tests pass.
  - `tests/browser.spec.js`: Added second E2E test validating dev login, new geo-location creation, timetable creation, session start, on-the-fly venue relocation, and audit log generation. Both Playwright tests pass (3.6s).
- Checks and actual results:
  - Unit tests: 18/18 pass (`npm test`).
  - Playwright browser tests: 2/2 pass (`npx playwright test`).
  - Production build: `npm run build` succeeds in ~550ms.
  - Formatting: `npm run format:check` clean.
- Decisions and reasons:
  - Adding on-the-fly venue relocation allows professors to move classrooms mid-session without invalidating already claimed student tokens; only the geofence boundary is updated and propagated via SSE.
  - Providing a developer console with structured audit trails and JSON inspector allows instant visibility into why student claims fail (exact distance in meters, accuracy threshold, reason codes).
- Documentation updated: CHANGELOG.md, DEVLOG.md, HANDOFF.md, PROJECT.md.

## 2026-10-01 — Role-Based Permissions, Timetable Calendar, Profile Pages, and Teacher Isolation

- Goal: Enforce strict role permissions (only teacher and dev can create locations; all roles can add courses with teacher permission needed for deletion), add dedicated profile settings pages for all roles, present schedules in an interactive calendar (Day, Week, Month, List), and enforce strict teacher-scoped attendance isolation to prevent cross-class data mixup.
- Changes:
  - `server/store.js`:
    - `createClassroom`, `updateClassroom`, `deleteClassroom`: Strictly enforced `actor.role === 'admin' || actor.role === 'dev'`. Throws `TEACHER_OR_DEV_ONLY` if student attempts modification.
    - `createSchedule(input, actor)`: Open to all roles. If created by teacher/dev, assigns `teacherId = actor.id`. If created by student, sets `createdBy = actor.id` and records assigned `teacherId`.
    - `updateSchedule(id, updates, actor)` & `deleteSchedule(id, actor)`: Enforces permission: dev can modify any; if `teacherId` is assigned, only that teacher can modify/delete (throws `TEACHER_PERMISSION_REQUIRED`); if unassigned, creator can modify.
    - `updateUser(id, updates, actor)`: Allows self-editing profile attributes (`name`, `email`, `dept`, `roll`, `referencePhoto`).
    - `snapshot(user)`: Enforces strict teacher-level isolation. `admin` (teacher) only receives schedules where `s.teacherId === user.id`, sessions where `sess.teacherId === user.id`, attempts for their sessions, and attendance records for their sessions. `student` only sees enrolled courses, their own attempts, and their own attendance. `dev` sees all.
  - `server/app.js`:
    - Guarded classroom endpoints with `canAdmin` (teacher/dev only).
    - Opened `POST /api/schedules` to all authenticated users with backend store permission checks.
    - Added `GET /api/profile` and `PUT /api/profile` for self-profile updates.
  - `src/components/ScheduleCalendar.jsx`:
    - Created modular timetable calendar component supporting `[ 📆 Day | 📅 Week | 🗓️ Month | 📋 List ]` views.
    - Month View: 7-column grid with current month dates, today highlight badge, and course event pills.
    - Week View: 7-column view (Monday–Sunday) with time badges, classroom venues, assigned faculty, and enrolled counts.
    - Day View: Hourly timeline slots (08:00 to 18:00) with detailed course cards.
    - List View: Clean card grid.
    - Navigation controls: Previous, Today, Next buttons with dynamic date headers.
    - Selected course inspector modal with quick session launch and management actions.
  - `src/main.jsx`:
    - Integrated `<ScheduleCalendar />` into Teacher/Dev "Timetable & Schedules" tab and Student "My Timetable & Courses" tab.
    - Added "👤 My Profile & Settings" tab to all roles (`dev`, `admin`, `student`) allowing users to edit Full Name, Roll No / Faculty ID, Department, Email, and reference photo (with camera capture or device file upload).
    - Added global course creation modal with `Assigned Faculty / Teacher` dropdown.
    - Bound `PUT /api/profile` to save profile updates and synchronize session storage.
  - `src/style.css`:
    - Added styles for calendar container, view switcher, month grid, week columns, day timeline, and profile settings grid.
  - `tests/attendance.test.js`:
    - Added 4 unit tests: student forbidden from creating classrooms, course creation and teacher permission deletion checks, teacher-scoped attendance isolation (Teacher A does not see Teacher B's session attempts), and user profile self-update. Total 22 unit tests pass.
  - `tests/browser.spec.js`:
    - Updated test 2 with calendar view switching and strict mode locator resolution.
    - Added test 3: student profile editing, calendar switching, proposing a course with assigned teacher, and verifying teacher-permission deletion protection. All 3 Playwright tests pass (4.7s).
- Checks and actual results:
  - Unit tests: 22/22 pass (`npm test`).
  - Playwright browser tests: 3/3 pass (`npx playwright test`).
  - Production build: `npm run build` succeeds in ~570ms.
  - Formatting: `npm run format:check` clean.
- Documentation updated: CHANGELOG.md, DEVLOG.md, HANDOFF.md, PROJECT.md.

## 2026-10-01 — Student Directory Privacy, Direct Roll Login & Timetable UI Aliases (V0.1.5-local)

- Goal: Strictly prevent students from viewing the student directory or peers roster, implement direct roll number login alongside quick demo evaluation, and provide an always-visible "Today's Scheduled Classes" timetable card on student check-in.
- Changes:
  - `server/store.js` & `server/app.js`: Restricted `/api/demo-accounts` to 5 evaluation personas, protected `/api/people` with 403 `ADMIN_REQUIRED`, filtered student snapshot `people` to only include faculty teachers and the requesting student, and unified schedule retrieval.
  - `src/main.jsx`: Added Direct Sign In tab (supporting Roll Number e.g. `ECE001`, Email, or ID), added "Today's Scheduled Classes" widget on student check-in tab with pulsing attendance open badge, unified `activeTab === 'timetable' || 'courses' || 'schedules'`, and scoped teacher live attendance table attempts.
  - `tests/attendance.test.js`: Added unit tests for student directory protection and direct roll login (23/23 tests pass).
  - `tests/browser.spec.js`: Added test 4 verifying student directory is hidden from students, direct roll sign in works, and timetable calendar renders in all views (4/4 tests pass).

## 2026-10-01 — Biometric Facial Recognition Integration & Physical Verification Tuning (V0.1.6-local)

- Goal: Complete full biometric facial recognition integration comparing live captured check-in photos against enrolled reference photos, resolve physical verification failures with real-time geofence distance calculation, and detect impersonation attempts.
- Changes:
  - `server/biometrics.js`: Created zero-dependency pure JavaScript biometric face comparison engine. Decodes PNG and JPEG data URLs and raw buffers (using `pngjs` and `jpeg-js`). Extracts 32x32 normalized luminance grids (zero-mean, unit-variance), Sobel edge gradient magnitudes, 4x4 spatial block luminance averages, 32-bin color/chrominance histograms, and 64-bit dHash vectors. Computes multi-metric similarity (NCC, gradient contour correlation, spatial blocks, color undertone, and dHash hamming distance) producing a confidence score (0-100%).
  - `server/store.js`: Integrated `compareFaces` into `store.submit()`. Enrolled students with matching faces verify with `FACIAL_MATCH` and confidence score recorded in attempt and attendance. Mismatched faces or impersonation attempts trigger `SUSPICIOUS` with `FACIAL_MISMATCH` verdict. Updated `defaultClassrooms` `maxAccuracy` to 150m for realistic laptop and indoor phone Wi-Fi positioning.
  - `server/app.js`: Increased JSON body limit to 10MB to accommodate high-resolution mobile camera portrait captures.
  - `src/main.jsx`:
    - Check-in Submission: Stores captured base64 data URL in `evidence.photo` and sends real image bytes to `/api/attempts/:id/submit`.
    - Real-Time Geofence Feedback: Dynamically calculates and displays distance from active session room (`distanceMeters`) immediately upon reading location, giving visual within/outside geofence cues.
    - Demo Simulation: Added `🎭 Impersonation / Face Mismatch` option to demo scenarios dropdown for immediate biometric testing.
    - Result Card: Added facial verification diagnostics displaying match status and confidence percentage (`✓ Verified Match (96%)` vs `⚠️ Face Mismatch (28%) - Impersonation Suspected`).
    - Teacher Live Activity: Added side-by-side enrolled face vs captured live check-in photo thumbnails and biometric confidence badge (`✓ Face (96%)`) in student attempts stream.
    - One-Click GPS Sync: Teacher "Use my current location" automatically configures minimum 100m radius and adaptive max accuracy tolerance.
  - `tests/attendance.test.js`: Added 2 unit tests covering image decoding, feature extraction, identical/varied face matching, unenrolled fallback, matching face verification, and impersonation detection. Total 25/25 unit tests pass (262ms).
  - `tests/browser.spec.js`: Added test 5 covering teacher session launch, student check-in, impersonation face mismatch detection (`SUSPICIOUS: FACIAL_MISMATCH`), genuine face match check-in (`VERIFIED: FACIAL_MATCH`), and teacher live dashboard update. Total 5/5 Playwright tests pass (6.2s).
- Checks and actual results:
  - Unit tests: 25/25 pass (`npm test`).
  - Playwright browser tests: 5/5 pass (`npx playwright test`).
  - Production build: `npm run build` succeeds in ~620ms.
  - Code formatting: `npm run format:check` clean.
- Documentation updated: DEVLOG.md, CHANGELOG.md.

## 2026-10-01 — Final Stabilization, Concurrency, Resource Management, & Full Audit (V0.2.0-final)

- Goal: Complete full end-to-end prototype audit, freeze feature set, enforce strict multi-teacher class isolation, implement modular `PresenceProvider` architecture, add slow-network transmission grace period, add resource capacity and room utilization analytics with over-capacity warnings, and verify simultaneous student concurrency.
- Changes:
  - `server/store.js`:
    - Added second teacher persona (`teacher-2` / `Prof. Rajesh Kumar`) in `defaultPeople` and updated `sched-3` ownership to `teacher-2`.
    - Included `teacher-2` in `listDemoAccounts()`.
    - Added strict teacher ownership validation in `store.start()` and `store.rotate()`, throwing `TEACHER_PERMISSION_REQUIRED` if a teacher attempts to launch or rotate a session for a course they do not own (developers retain administrative oversight).
    - Implemented a 15-second slow-network transmission grace period in `store.submit()`. Decoupled `evidence.capturedAt` from request arrival timestamp: if client evidence was captured before the student's 90-second deadline (`evidence.capturedAt <= a.deadline`), network transmission delays up to 15 seconds are tolerated without falsely penalizing the student.
  - `server/data/store.json`:
    - Synchronized persistent store with `teacher-2` and `sched-3` teacher ownership.
  - `src/providers/browser.js`:
    - Refactored presence verification into an extensible, modular `PresenceProvider` interface returning `{ status: "PASS" | "FAIL" | "UNAVAILABLE", reason, payload }`.
    - Implemented `BrowserPresenceProvider` (standard Web API), `HardwarePresenceProvider` (simulated BLE/ESP32 beacon with automatic graceful degradation to `REDUCED_EVIDENCE_FALLBACK`), and `SimulatedPresenceProvider` (deterministic attack and recovery injection).
  - `src/main.jsx`:
    - Updated navigation to semantic `<nav className="nav-bar">` for accessibility.
    - Added prominent **Student Privacy Guarantee Banner** on Check-In tab: _"Privacy First: Location is queried on-demand solely during active check-in to verify classroom proximity. No continuous background tracking or movement history is recorded."_
    - Added 5-step **Stepped Verification Pipeline UX Tracker**: Visual progression indicators (`1. Authenticated → 2. Joined Session → 3. Location Checked → 4. Face Captured → 5. Final Result`).
    - Added **Resource Capacity & Utilization Analytics** to Teacher Live Attendance tab: Real-time calculation and display of room seating capacity, verified attendee headcount, room utilization percentage, and dynamic **Resource Over-Capacity Alert** if attendance exceeds room capacity.
    - Added **Large Geofence Warning** (>100m) on active venue sessions and classroom creation forms to caution faculty against excessively loose anti-proxy boundaries.
    - Enhanced demo simulation scenarios with explicit `capturedAt` timestamps.
  - `tests/attendance.test.js`:
    - Added unit test for teacher ownership enforcement (`teacher cannot start or rotate another teacher's class session, dev can manage all`).
    - Added unit test for slow-network transmission grace period (`valid capturedAt within grace succeeds, expired without grace becomes PENDING_REVIEW`).
    - Added unit test for modular presence providers (`Browser, Hardware graceful degradation, Simulated deterministic control`).
    - Total 28/28 unit tests pass (235ms).
  - `tests/browser.spec.js`:
    - Added comprehensive Test 6: Simultaneous multi-student attendance concurrency (multiple students claiming and submitting concurrently with independent attempt IDs and no state collisions) and browser-level multi-teacher class isolation.
    - Total 6/6 Playwright browser tests pass (7.7s).
  - `scratch/audit.mjs`:
    - Created standalone 30-check automated application audit suite covering API security (403 guards for unauthorized students), UI role-based element filtering, 390px mobile viewport responsiveness, calendar controls, and cross-teacher data isolation.
- Checks and actual results:
  - Unit tests: **28/28 passed** (`npm test`, 235ms).
  - Browser tests: **6/6 passed** (`npm run test:browser`, 7.7s).
  - Audit script: **30/30 passed** (`node scratch/audit.mjs`, 100% clean).
  - Code formatting: **100% clean Prettier check** (`npm run format:check`).
  - Production build: **Clean client bundle compilation** (`npm run build`, 650ms).
- Decisions and reasons:
  - Biometrics reality: Accurately and honestly labeled the custom multi-metric matcher as an experimental pre-neural visual feature similarity engine (luminance grid, Sobel edge gradients, spatial blocks, color histograms, dHash). Rather than fabricating neural network accuracy or issuing punitive cheating rejections, borderline or mismatched scores are transparently routed to `SUSPICIOUS: FACIAL_MISMATCH` for teacher review.
  - Presence provider design: Standardized on `{ status, reason, payload }` to allow seamless future plug-in of physical ESP32 or BLE beacons while ensuring existing browser-only GPS+QR flows continue without breaking.
  - Strict Teacher Isolation: Teacher 1 (`Dr. Ramesh Rao`) only sees Embedded Systems; Teacher 2 (`Prof. Rajesh Kumar`) only sees IoT Systems & Robotics. Neither can view, modify, or launch sessions for the other's classes.
- Documentation updated: DEVLOG.md, FINAL_CHECKLIST.md, PROJECT.md, HANDOFF.md, CHANGELOG.md.

## 2026-10-01 — Latest-docs review and prototype repairs; ESP32 handoff pending

- Read latest V0.2 HANDOFF, PROJECT, DEVLOG and FINAL_CHECKLIST; inspected actual code rather than treating earlier test/readiness claims as proof.
- Found gift firmware in SECRET_GIFT: a power-on SoftAP captive portal for ESP32-WROOM-32 DevKit V1. Existing Arduino ESP32 3.3.11 core and Arduino IDE CLI found; no attached ESP32 serial port detected.
- Asked user which board is used and whether the whole app should be standalone or the ESP32 should act as a presence device. Firmware implementation awaits this architecture decision.
- Declared missing pngjs dependency, prevented public privileged registration, removed public reference-photo exposure, enforced course enrollment, preserved unrelated teacher sessions, rejected missing schedules, validated new classroom values, repaired developer load fallback, and made JSON writes atomic.
- Replaced untrusted capturedAt-based upload grace with a fixed server-side 15-second allowance following the 90-second collection window; added forged-timestamp regression coverage.
- Added HOST and STORE_PATH configuration; corrected persistent-store startup message. Isolated browser tests on port 5188 with temporary storage.
- Validation: 32/32 policy/API tests passed; 6/6 Chrome integration tests passed; production build passed. Real hardware and phone behavior remain unverified.
- Updated engineering docs to supersede inaccurate production-readiness and password claims. No device flashed, existing store not reset, no cloud/billing configured.

## 2026-10-01 — ESP32 companion implementation

- User selected companion operation to keep the device workload small. Kept the main React/Node app and added a Wi-Fi proof portal on the ESP32.
- Added firmware/TECH_PULSE_COMPANION with embedded portal, WPA2 SoftAP, captive DNS, health route, signed request validation, signed response generation, and automatic startup. No filesystem upload, router, internet, clock, or serial action required after flashing.
- Generated paired local device/server credentials (not copied from gift); defaults are ssec-room-1 / room-1 / TechPulse-Classroom. Confirmed secret config and binaries match Git ignore rules using a temporary repository without altering this project's Git state.
- Server verifies attempt nonce, device/room mapping, HMAC signature and expiry. Client localProof and simulation cannot bypass required companion proof. Added teacher policy/configuration UI and student request/response fields. Required sessions use 180+15 seconds; baseline remains 90+15 seconds.
- Added esp32:prepare, esp32:compile, and esp32:upload scripts and docs/ESP32_COMPANION.md. Re-running prepare retains existing keys.
- First firmware compilation failed on the installed Intel-only ctags helper. The compile script bypasses unnecessary auto-prototype generation on Apple Silicon; all firmware functions are defined before use. Actual ESP32 compilation/linking passed using Arduino ESP32 3.3.11 for esp32:esp32:esp32. Output: 931780 bytes flash (71%), 47152 static RAM (14%).
- Software validation: 38/38 policy/API tests passed; 7/7 Chrome browser tests passed including required proof with software signer fixture; production build and formatting check passed; documentation links checked. A new browser test initially checked session state before SSE loaded; fixed by waiting for start/close controls.
- No board detected on serial ports, no firmware flashed, no physical power-cycle, radio-client load, iPhone or Android tests performed. The reference target remains the gift-project ESP32-WROOM DevKit; compile differently for another board.
- The user still needs a reachable HTTPS app for physical phones. Wi-Fi signing proves contact with the device, not exact room location or relay resistance. Public demo authentication and visual-similarity limitations remain.

## 2026-10-01 — Four-user stabilization (current behavior)

Password sign-in/registration and eight-hour server sessions replace quick login. Valid photo and presence checks now wait for responsible-teacher/developer identity approval; similarity is advisory. QR claim resolves its course on the server with explicit enrollment. Teachers select scheduled Asia/Kolkata classes or visibly logged demo overrides. Submitted photos live in memory for 15 minutes or until review; restart/expiry requires recapture. Loopback remains default; an exact HTTPS origin and trusted proxy can be configured for phone demonstrations.

Actual verification: 46 Node checks passed (38 isolated legacy fixtures + eight normal-flow checks), one normal Chrome flow passed, production build and formatting passed. Four independent authenticated HTTP attempts submitted/reviewed concurrently without duplicates. Physical standalone-power ESP32, iPhone and Android checks remain pending; no connected serial board was available. Firmware is unchanged. Firebase, public hosting and neural recognition remain deferred. Initial existing-account passwords are generated in ignored `private/account-passwords.json`; existing account and attendance metadata is retained.

Operation, privacy and HTTPS notes from that milestone are now folded into README.md, PROJECT.md and PHONES.md. Earlier entries describing automatic face verification/passwordless simulation represent historical behavior.

Live migration result: preserved 11 accounts, 62 attendance records and 92 attempts; initialized credentials for all 11 accounts. Saved attempts/attendance contain zero submitted photos. Password file permissions are 0600. The production preview was restarted on http://127.0.0.1:5173; a password login and logout succeeded without exposing hashes. Browser reload also preserved the claimed class after a second teacher started another session.

## 2026-10-01 — Final Prototype Completion & System Stabilization (Modules 1–7)

- **Completed Full Module Execution**:
  - **Module 1 (Theme, Shell, Shared Controls & Navigation)**:
    - Implemented unified CSS variables, desktop layout (224px sidebar + 64px header), and mobile 360/390px viewport fit without horizontal scroll (`scrollWidth <= innerWidth`).
    - Integrated `PortalUI.jsx` SVG icons (`grid`, `map`, `calendar`, `users`, `user`, `check`, `history`, `code`, `menu`, `close`, `arrow`), eliminating decorative emoji in navigation and controls.
  - **Module 2 (Classroom Map Workspace & Schematic Fallback)**:
    - Integrated `ClassroomMap.jsx` with Leaflet.js interactive maps and SVG schematic fallbacks when offline.
    - Added bidirectional map-list selection (`selectedClassroomId` / `.selected-card`).
    - Added interactive draggable draft pin for venue creation/editing with live coordinate readouts.
    - Integrated compact venue maps into Teacher Active Session and Student Location Check-In evidence view.
  - **Module 3 (Teacher Session Workspace & Photo Review Drawer)**:
    - Added dedicated accessible `<Modal>` in Teacher Live Attendance tab for manual biometric verification.
    - Side-by-side comparison of Enrolled Reference Face vs Temporary In-Memory Live Check-in Photo.
    - Multi-metric match score (%) with advisory status badge, venue distance, and GPS accuracy.
    - Teacher "Approve Identity" (`decision: 'approve'`) and "Reject Identity" (`decision: 'reject'`) controls with real-time SSE propagation.
  - **Module 4 (Student Check-In Stepper & Timetable / History)**:
    - Replaced legacy attendance list with dual-section view: Official Verified Attendance Records and Verification Attempts Log.
    - Displays attempt IDs, status badges, geofence distance, and verification evidence reasons.
    - Preserved student data isolation: students see strictly their own attempts.
  - **Module 5 (Course Enrollment Controls & Roster Validation)**:
    - Replaced raw modal overlays with accessible `<Modal>` dialogs from `PortalUI.jsx`.
    - Added student roster multi-select checklist in Course Schedule creation/edit modal for faculty and developers.
    - Pre-enrolls student proposer upon course creation while preventing students from viewing other students' rosters (enforcing student directory privacy).
    - Added enrolled roster inspection modal in `ScheduleCalendar.jsx` with faculty edit/delete permissions check.
  - **Module 6 (Operational Setup Panel & Testing Tooling)**:
    - Mounted `OperationsPanel` from `PortalUI.jsx` into Developer Console tab (`activeTab === 'dev-logs'`).
    - Displays companion configuration status, physical ESP32 test procedures, and hardware diagnostics via `/api/presence/status`.
    - Added `POST /api/dev/simulate` backend endpoint and UI runner for 4-student simultaneous concurrency claims.
    - Added interactive Spatial Geofence Simulator with Haversine distance and boundary calculation.
  - **Module 7 (Final Regression, Build Verification & Documentation)**:
    - All 46 backend unit tests passing (`npm test`, ~3.0s).
    - Playwright browser test passing (`npm run test:browser`, ~3.6s).
    - Standalone Playwright audit suite passing: **39/39 assertions** (`node scratch/audit.mjs`, 100% clean).
    - Code style formatting: 100% clean Prettier check (`npm run format:check`).
    - Production build: Clean Vite compilation (`npm run build`, 915ms).
    - Scope frozen and fully documented across `DEVLOG.md` and `FINAL_CHECKLIST.md`.

## 2026-10-01 — Release 0.3.0: hardware-optional attendance, occupancy, connected mode, release tooling

- Goal: a downloadable, honest release — one-command local start, optional Firebase, private HTTPS for phones, safe ESP32 tooling.
- Fixes: removed the live-store simulation endpoint/UI; roster validation (existing students only, deduplicated, empty allowed, students cannot edit rosters, rejected edits leave the whole schedule unchanged); neutral advisory similarity; review drawer driven by the latest attempt id (missing reference, enlarge, expiry, completed states); inert map tooltips; Recorded / To review / Need action / Enrolled metrics; teacher session selector; confirmation dialogs replaced with the shared modal; camera tracks stopped on leave/logout; sanitized browser storage (no reference photo, evidence or proofs).
- Added: explicit proof policy (baseline default, ESP32-required) with _Start replacement session without ESP32_, shared `attendanceEventId` across replacements; estimated room occupancy (`roomPresences`, check-out by id, expiry by server clock); checks-and-anomalies panel; EVALUATION.md.
- Persistence: all state changes pass a single `mutate()`; local mode rolls back and returns 503 if the disk write fails; connected mode commits attempt + attendance + presence in one Firestore transaction, serializes reads behind writes, never rolls back committed data for a reference-file failure, and `snapshot()` is now a pure read with exact expiry.
- Connected mode: Firebase Email/Password in the browser, ID-token → revocable server-session exchange, 8-hour cap from original sign-in, developer-only role control, first-owner provisioning, deny-all rules file.
- Tooling: `demo` / `demo:connected` / `demo:phones` / `setup` / `doctor` / `firebase:init` / `deploy:web` / `release`; digest-based freshness for dependencies and build; readiness-gated banners; ESP32 upload with separate discovery → port → chip → compile → flash stages and chip verification on every alias.
- Checks: see [FINAL_CHECKLIST.md](FINAL_CHECKLIST.md). Failures along the way: the emulator runner initially hung because the browser Firestore client was never terminated (fixed); launcher tests initially leaked stub servers when a test failed (ports now random, children always stopped); phone layout overflowed at 360 px because grid tracks could not shrink and tables had no scroll container (fixed); my first tooltip test used overlapping pins (events dispatched instead).
- Decisions: Java 21+ is required by firebase-tools 15, so emulator tests use the Homebrew JDK; the system Java 11 is not enough. Fake-repository tests are supplementary only.
- Not done: real-project Firebase validation (invalid key), flashing, phone and power-cycle acceptance, battery measurement, push/deploy.
