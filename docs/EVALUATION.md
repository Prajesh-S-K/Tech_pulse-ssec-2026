# Evaluation map — Problem Statement 3

**Geo-Fenced Smart Attendance & Resource Management System** (Domain 2: Smart Campus & Geo-Location Services). Source: `problem-statements.pdf` (kept locally, not redistributed). This page maps each requirement to behaviour you can demonstrate, the tests that cover it and what is _not_ claimed. Test names refer to files under `tests/`; results are in [FINAL_CHECKLIST.md](FINAL_CHECKLIST.md).

## Challenge

> Cross-platform solution using precise geo-fencing (GPS, local Wi-Fi handshakes or Bluetooth beacons) to verify presence while safeguarding location privacy.

| Element               | Implemented                                                                                                                                                                                                                                                          | Not claimed                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Cross-platform        | Responsive web client; works in iPhone Safari / Android Chrome over HTTPS (`demo:phones`) and desktop                                                                                                                                                                | Real-phone runs are _not tested_ yet                                       |
| Geo-fencing           | Server computes distance to the venue and compares it with the radius, using GPS accuracy                                                                                                                                                                            | Indoor GPS can be poor; no beacons                                         |
| Local Wi-Fi handshake | Optional **ESP32 classroom proof**: the board's own Wi-Fi signs an attempt-bound request (HMAC)                                                                                                                                                                      | Relay of a live response is possible; no hardware-security claim           |
| Location privacy      | One-shot location read at check-in; the server keeps only the computed **distance and accuracy** (no raw coordinates, no routes) and presence records hold ids and timestamps only; submitted photos expire from memory in ≤ 15 min; only teachers/devs see evidence | Distance and accuracy remain visible to the responsible teacher for review |

## Deliverable 1 — client to register attendance within boundaries

| Behaviour                                                                                  | Demo                                               | Tests                                                                                                                    |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Student claims a session by QR, shares location, takes a photo, submits                    | DEMO.md steps 2–3                                  | `attendance.test.js` (genuine evidence, six independent students), `browser.spec.js`                                     |
| Server picks session, course and room from the QR; explicit enrollment                     | Start two classes; each QR resolves its own course | `unenrolled students cannot claim a course QR`, `new sessions do not close another teacher's unrelated classroom`        |
| Scheduled classes enforce the Asia/Kolkata timetable; demo override is labelled and logged | Session type selector                              | `scheduled sessions enforce Asia/Kolkata; demo override is logged`                                                       |
| Baseline 90 s / companion 180 s windows, server-owned clocks, forged client time ignored   | —                                                  | `forged client capture times never extend the server deadline`, `slow-network server allowance…`                         |
| Clear outcomes, retry for recoverable problems                                             | Poor GPS → “Try that step again”                   | `outside geofence is rejected, uncertain accuracy and boundary are retryable`, `recoverable GPS failure can be retried…` |
| No hardware needed                                                                         | Default policy                                     | `occupancy.test.js › baseline attendance needs no ESP32 configuration at all`                                            |

## Deliverable 2 — admin panel: real-time occupancy and anomaly detection

| Behaviour                                                                                                                                                                                                                                | Demo                                              | Tests                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live updates over server-sent events                                                                                                                                                                                                     | Watch the teacher panel update as students submit | `browser.spec.js`, `ui-policy.spec.js`                                                                                                                   |
| **Estimated room occupancy** (approved check-ins − check-outs − expiry), unique students per room; teachers see only their sessions, developers the aggregate; configured seats shown separately as informational                        | DEMO.md step 5                                    | `occupancy.test.js` (approval, duplicates, checkout, expiry by clock, restart, cross-student reads), `connected.emulator.test.js › room presence…`       |
| **Checks and anomalies** panel from real server reasons: _Suspicious_ (invalid/altered ESP32 proof), _Rejected_ (outside geofence, teacher-rejected), _Needs action_ (uncertain GPS, missing proof, denied permission, expired evidence) | `06a`, `06b` screenshots                          | `ui-policy.spec.js › …anomalies without cheating language`, `attendance.test.js` (location), `stabilization.test.js` (proof tamper/expiry/cross-student) |
| Teacher review before attendance is recorded; similarity is advisory only                                                                                                                                                                | Review drawer                                     | `ui-review.spec.js`, `stabilization.test.js › normal four-user flow…`                                                                                    |

Occupancy is an **estimate**: approved check-ins, reported check-outs and expiry (scheduled class end, or 60 min after a demo session starts). People may leave without checking out; it is not a headcount.

## Evaluation criteria

### Anti-spoofing robustness

Layered, not absolute: server-selected session and server clocks; short-lived QR challenge; geofence with accuracy; optional signed ESP32 proof (tamper/expiry/cross-student/reuse tests); teacher identity review; one attendance per student per event (deterministic ids, transactional writes); attempts and approvals audited. **Not claimed:** universal spoofed-GPS detection, QR forwarding prevention in baseline mode, face recognition. Weak GPS, denied permissions or an offline board are treated as _retryable_, never as cheating. Tests: `stabilization.test.js` (companion flow, boolean/corrupt photo, simulation flags), `ui-policy.spec.js`.

### Battery efficiency

Design: location is read **once** per check-in (no watch), the camera is opened only on demand, its tracks are stopped when leaving the capture screen and on sign-out (`ui-phone.spec.js › … camera tracks stop…`), and the live event stream is a single lightweight connection. **Physical battery measurement: not tested.** No battery figures are claimed.

### Location accuracy

The review drawer and student result show **distance and GPS accuracy**. Rules (`src/domain/trust.js`): accuracy worse than the venue tolerance → retry; definitely outside (even with the optimistic accuracy circle) → rejected; boundary-uncertain → retry; inside → continue. Covered by `attendance.test.js › outside geofence is rejected, uncertain accuracy and boundary are retryable` and `realistic indoor/Wi-Fi accuracy (65m)…`. Radii and tolerance are per venue. **The shipped coordinates are illustrative; replace them with the real demonstration venue before a live demo.** Map radius is drawn in metres (`ui-maps.spec.js › …radius is metres…`).

### UI/UX

Single responsive interface (checked at 360/390/430 px with no horizontal page scroll, keyboard-closable dialogs, reduced-motion respected: `ui-phone.spec.js`), plain-language outcome text, accessible confirmation dialogs, camera/location-denial guidance, map with a usable schematic fallback when tiles fail (`ui-maps.spec.js`), copy-link fallback when the clipboard is unavailable.

## Known limitations

- Prototype sized for four simultaneous users; not load-tested beyond that.
- Photo similarity is a coarse advisory feature, not facial recognition.
- Baseline proof is weaker than ESP32 proof; the UI says so.
- One running backend per data store. Firebase mode keeps Firestore as metadata store only.
- Hardware and phone acceptance, and any battery measurement, are _not tested_ until performed.
