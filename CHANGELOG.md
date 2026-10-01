# Changelog

> Entries below 0.3.0 are historical; several describe behaviour that has since been removed or replaced (see docs/PROJECT.md).

## 0.4.0 — 2026-10-01

### Added

- `npm run full` and double-click `Start Tech Pulse.command` / `Stop Tech Pulse.command`: one step that stops older instances of this folder (only), validates Firebase configuration, installs mkcert/Caddy if needed, copies the public phone certificate to Downloads and reveals it, picks free ports and prints the phone URL with a QR code.
- Phone launcher picks the next free HTTPS port when 8443 is taken.
- `npm run stop`.

## 0.3.0 — 2026-10-01

### Added

- `npm run demo` (local, hardware-free), `demo:connected`, `demo:phones`, `setup`, `doctor`, `firebase:init`, `deploy:web`, `release`.
- Proof policy selector (baseline default / ESP32-required) and *Start replacement session without ESP32*.
- Estimated room occupancy with student check-out; checks-and-anomalies panel; evaluation map.
- Optional Firebase Email/Password sign-in with Firestore persistence (emulator-tested).
- Safe ESP32 upload pipeline with chip verification; private HTTPS launcher for phones.
- Scanned, manifest-based release archive.

### Changed

- Local persistence failures roll back and return a retryable 503; `snapshot()` is pure.
- Image similarity is advisory only; approval is always a teacher decision.
- Documentation rewritten to match the code.

### Removed

- Live-store simulation endpoint and UI; fixed/seat-based capacity claims; `docs/LOCAL_STABILIZATION.md` (folded into other guides).

## 0.2.0-final — 2026-10-01

### Added & Stabilized

- **Prototype Stabilization & Complete 27-Phase Audit**: Completed exhaustive audit across all 27 application phases. Verified with 30 automated audit checks (`scratch/audit.mjs`), 28 unit tests, and 6 Playwright browser tests.
- **Multi-Teacher Isolation & Ownership**: Added second teacher persona (`teacher-2` / `Prof. Rajesh Kumar`) and enforced strict multi-teacher class isolation. Teachers cannot view or launch attendance sessions for classes they do not own (`TEACHER_PERMISSION_REQUIRED`).
- **Simultaneous Student Concurrency**: Verified concurrent claims and submissions by multiple independent students without state overwrites, token collisions, or duplicate headcount increments.
- **Modular Presence Provider Interface**: Created standardized `PresenceProvider` interface returning `{ status: "PASS" | "FAIL" | "UNAVAILABLE", reason, payload }`, with `BrowserPresenceProvider`, `HardwarePresenceProvider` (automatic fallback to `REDUCED_EVIDENCE_FALLBACK`), and `SimulatedPresenceProvider`.
- **Resource Management & Room Utilization**: Implemented real-time classroom capacity, verified headcount, utilization percentage, and dynamic **Resource Over-Capacity Alert** in teacher attendance dashboard.
- **Slow-Network Transmission Grace Period**: Decoupled `evidence.capturedAt` from HTTP request arrival time; 15-second grace window prevents penalizing mobile students on high-latency networks.
- **Student Privacy & Geofence Policy**: Added prominent student privacy guarantee banner (*"VERIFY PRESENCE — DO NOT TRACK STUDENTS"*). Added warning in UI against excessively loose geofences (>100m).
- **Stepped Verification Pipeline UX Tracker**: Visual 5-step progress indicators for students during check-in.
- **Honest Biometrics Labeling**: Clarified in documentation and UI that the pure JS multi-metric matcher is an experimental pre-neural visual feature baseline, routing mismatches to teacher review rather than punitive disqualification.

## 0.1.6-local — 2026-10-01

### Added & Enhanced

- **Biometric Facial Recognition Engine (`server/biometrics.js`)**: Pure JavaScript multi-metric facial comparison engine. Decodes PNG and JPEG base64 data URLs and raw buffers (utilizing `pngjs` and `jpeg-js`). Extracts 32x32 normalized luminance grids (zero-mean, unit-variance), Sobel edge gradient magnitude arrays, 4x4 spatial block luminance averages, 32-bin color/chrominance histograms, and 64-bit dHash vectors. Computes multi-metric similarity (NCC, gradient contour correlation, spatial blocks, color undertone, and dHash hamming distance) producing a confidence score (0-100%).
- **Server Biometric Verification**: `store.submit()` automatically evaluates biometrics when a photo is submitted. Matching faces verify with `FACIAL_MATCH` and confidence score recorded in attempt and attendance. Mismatched faces or impersonation attempts trigger `SUSPICIOUS` with `FACIAL_MISMATCH` verdict.
- **Physical Verification & Geofence Distance Display**:
  - Dynamically calculates and displays distance from active session room (`distanceMeters`) immediately upon clicking "📍 Read my location", giving visual within/outside geofence cues.
  - Increased `defaultClassrooms` `maxAccuracy` to 150m for realistic laptop and indoor phone Wi-Fi positioning.
  - One-click teacher GPS sync automatically configures minimum 100m radius and adaptive max accuracy tolerance.
- **Impersonation Simulation Scenario**: Added `🎭 Impersonation / Face Mismatch` option to demo scenarios dropdown for immediate biometric testing.
- **Biometric UI Diagnostics**:
  - Student result card displays facial recognition verification badge (`✓ Verified Match (96%)` vs `⚠️ Face Mismatch (28%) - Impersonation Suspected`).
  - Teacher live dashboard displays side-by-side enrolled face vs captured live check-in photo thumbnails and biometric confidence badge (`✓ Face (96%)`) in student attempts stream.
- **Automated Verification**: 25/25 unit tests passing (`npm test`) and 5/5 Playwright browser tests passing (`npx playwright test`).

## 0.1.5-local — 2026-10-01

### Added & Enhanced

- **Student Directory Privacy Protection**: Restricted `/api/demo-accounts` to 5 designated evaluation personas. Protected `/api/people` with 403 `ADMIN_REQUIRED`. Filtered student snapshot `people` to only include faculty teachers and the requesting student.
- **Direct Roll Number Sign-In**: Added Direct Sign In tab (supporting Roll Number e.g. `ECE001`, Email, or ID) alongside Quick Demo evaluation logins.
- **Today's Scheduled Classes Widget**: Dedicated card on student check-in tab displaying today's scheduled classes, times, venues, and assigned teachers with pulsing attendance open badge.
- **Unified Timetable Navigation**: Unified `activeTab === 'timetable' || 'courses' || 'schedules'` across student, teacher, and developer views.
- **Live Attendance Attempt Scoping**: Filtered teacher live attempts table to the active session to prevent old test runs from flooding the live view.

## 0.1.4-local — 2026-10-01

### Added & Enhanced

- **Strict Geo-Location Permissions**: Geo-locations/classrooms can now only be created, modified, or deleted by Faculty (`admin`) or Developers (`dev`). Student attempts to create or delete classrooms are strictly blocked with 403 `ADMIN_REQUIRED`.
- **Universal Course Creation with Assigned Teacher Permissions**: All roles (`student`, `admin`, `dev`) can create new courses. Courses created by teachers or devs assign themselves as the permission grantor (`teacherId`).
- **Permission-Guarded Course Modification & Deletion**: Courses with an assigned teacher can only be edited or deleted with that teacher's permission (`TEACHER_PERMISSION_REQUIRED`) or developer authority.
- **Dedicated Profile & Settings Pages**: Complete profile management page for all roles (`student`, `teacher`, `dev`) supporting credential updates (Name, Email, Dept, Roll/ID) and reference face biometrics (live camera capture or file upload) with persistent `PUT /api/profile` storage.
- **Interactive Timetable Calendar (`ScheduleCalendar`)**: Modern interactive calendar supporting Day, Week, Month, and List view modes, today highlighting, date navigation (Prev/Today/Next), and an integrated course inspector modal.
- **Teacher-Scoped Attendance Isolation**: Complete data privacy across faculty classes. In live attendance feeds and records, teachers only receive attempts, sessions, and attendance data for the courses they teach. Students only see their own attempts and records.
- **Automated Verification**: 22/22 unit tests passing and 3/3 Playwright browser tests passing covering the entire permission and UI matrix.

## 0.1.3-local — 2026-10-01

### Added & Enhanced

- **Timetable & Schedule Editing**: Added full schedule management (`PUT /api/schedules/:id`, `DELETE /api/schedules/:id`). Professors and Devs can modify subject names, class codes, assigned venues, time slots, days, and enrollments, or delete obsolete classes.
- **On-the-fly Venue Relocation & Geo Point Selection**: Professors can choose any campus venue or use their device GPS when launching a session. Added live session venue relocation (`POST /api/sessions/:id/venue`), broadcasting new geofence coordinates and radius to all student devices via SSE.
- **Developer Account & System Audit Logs**: Added dedicated `dev` role (`System Developer`) with a telemetry dashboard (Active sessions, pass rate %, total attempts), audit log feed (filterable by category: attempts, venues, sessions, geofences, auth), expandable JSON payload inspector, JSON database export, and database reset controls.
- **Geo Locations & Geofence Manager**: Complete management of campus venues with 1-click browser GPS coordinate capture (`getLocation`), configurable radius (25m–500m), and accuracy tolerances with full CRUD (`PUT/DELETE /api/classrooms/:id`).
- **Role Preview Switcher**: Devs can seamlessly preview the Teacher or Student interface with a 1-click switcher without needing to sign out.
- **Automated Tests**: 18/18 unit tests pass (`npm test`) and 2 Playwright browser tests pass covering mobile check-in, dev console, schedule editing, and venue relocation.


### Added & Expanded

- **Account & Profile Management**: Added student and teacher registration (`POST /api/register`), multi-attribute login (by ID, email, or roll), and reference face profile photo registration (`POST /api/profile/photo`).
- **Course Schedules & Timetables**: Seeded department courses (`ECE-DEMO`, `ECE-302`, `ECE-401`) and added dynamic schedule creation (`POST /api/schedules`), classroom linkage, timetable viewing, and course-linked session launching.
- **Classroom & Geofence Management**: Seeded campus venues (Main Auditorium, IoT Systems Lab, DSP Classroom) with configurable coordinates, radius (25m–500m), and accuracy tolerances. Added classroom listing and creation endpoints.
- **Attendance Archive**: Attendance records are now permanently tracked with student name, roll number, course code, calculated distance, GPS accuracy, and finalized timestamp.
- **Data Persistence**: Configured JSON file-backed persistence (`server/data/store.json`) for server restarts while keeping unit and browser test fixtures 100% in-memory.
- **UI Platform Overhaul**:
  - Sign-in screen: Dual mode ("Quick Demo Logins" for 1-click evaluation + "Register New Account" with live camera capture for reference face).
  - Teacher navigation tabs: `Live Attendance & QR`, `Timetable & Schedules`, `Classrooms & Geofences`, `Student Directory`.
  - Student navigation tabs: `Check-In`, `My Timetable & Records`, `Face Profile Registration`.
  - Face comparison preview: Student check-in displays side-by-side comparison of registered reference face and live-captured photo.
- **Automated Tests**: Added tests for registration, profile updates, classroom/schedule assignment, and course attendance. All 15 unit tests pass.


### Fixed & Improved

- Fixed physical "My device" check-in failures caused by restrictive 35m accuracy ceiling and React state closure overwrites.
- Increased default `maxAccuracy` to 100m (configurable 50m, 100m, 150m, 200m) to accommodate indoor Wi-Fi and mobile positioning.
- Added visual classroom location synchronization indicator on Teacher dashboard with one-click device sync and live coordinate feedback.
- Added active classroom geofence display (center, radius, max accuracy) so teacher always knows the reference location.
- Added real-time check-in diagnostics on student result card (distance in meters, classroom radius, GPS accuracy, and actionable hints).
- Enabled re-submission of updated evidence within 90-second deadline after initial rejection, while maintaining terminal idempotency for verified records.
- Expanded automated Playwright browser test suite to validate "My device" mode with browser Geolocation and Camera stream mocks.

## 0.1.0-local — 2026-10-01

### Added

- Working student-to-teacher local attendance flow with synthetic accounts.
- Session controls, QR challenges, independent attempts, deadline handling, and duplicate prevention.
- Pure Trust Engine with geofence accuracy and recoverable error handling.
- Live teacher dashboard, outcomes, reasons, and classroom utilization.
- Browser location/camera mode and clearly labelled simulated scenarios.
- Policy/API tests, Chrome browser test, reproducible dependency lockfile, VS Code tasks, and formatting checks.

### Limitations

- Local prototype only. Firebase, real authentication, cloud evidence storage, phone validation, ESP32, and face matching remain pending.

## Documentation baseline — 2026-10-01

- Architecture V0.1, documentation workflow, VS Code workspace, and planned demo checklist.

## Unreleased — 2026-10-01 repair pass

- Restored clean-install image dependency and repaired registration, enrollment, concurrent-session, persistence, and upload-timing boundaries.
- Isolated browser test storage; added runtime host/store settings.
- ESP32 power-on firmware pending board and standalone-versus-companion decision.

## Unreleased — ESP32 companion

- Auto-starting Wi-Fi proof portal, attempt-bound HMAC responses, explicit teacher hardware policy, student copy/paste workflow, and private configuration/build/upload scripts.
- Firmware compiled for ESP32 Dev Module; physical tests pending.
