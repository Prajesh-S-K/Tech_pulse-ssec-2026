# Demonstration guide

Everything below uses synthetic accounts and illustrative coordinates. Replace the venue coordinates with the real demonstration room first (**Classrooms → Edit**, or _Use my current location_).

## Ten-minute script (no hardware)

1. `npm run demo`, open the printed address, sign in as `teacher` (password from `private/account-passwords.json`).
2. **Live Attendance** → _Session type: Demo_, policy _GPS + teacher review — no ESP32 needed_ → **Start selected session**. The badge “Proof: GPS + teacher review (no ESP32)” is shown.
3. Open the check-in link in a second window as `student-1`: claim → _Read my location_ → _Open camera_ → _Capture photo_ → _Submit_. The student sees “Submitted — awaiting teacher review.”
4. Teacher: **Review Photos** — reference (or “No reference face enrolled”), live photo, advisory similarity, distance and GPS accuracy → **Approve Identity**. The student sees “Attendance recorded.” and **Check out of room**.
5. The **Estimated room occupancy** panel counts 1 (“your sessions only”); **Check out of room** brings it to 0; attendance stays recorded.
6. Sign in as `student-3` with a location far away (browser dev-tools sensor override) → _Rejected checks_ in **Checks and anomalies**: “Location was outside the classroom geofence”.
7. Show the **Classrooms** map: pins, geofence radius in metres, fall-back schematic if tiles are unavailable.

## With the ESP32

Choose _GPS + ESP32 classroom proof + teacher review_. Students follow [ESP32_COMPANION.md](ESP32_COMPANION.md). Show **Start replacement session without ESP32** and explain why baseline gives weaker proof. Only claim ESP32 results that were physically run.

## Screenshots

Generated from an isolated synthetic instance by `node tests/diagnostics/screenshots.mjs` into `docs/screenshots/` (map tiles replaced by a plain grid): hardware-free session, ESP32-required policy and guidance, classroom map/geofence, teacher review, estimated occupancy with checkout/expiry, anomaly states.

| Screenshot                                                                                         | Shows                                                      |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `01-hardware-free-session.png`                                                                     | Baseline session with approved student                     |
| `02a-policy-selector-esp32.png`, `02b-student-esp32-guidance.png`, `02c-teacher-esp32-session.png` | ESP32-required policy, student instructions, teacher badge |
| `03-classroom-map-geofence.png`                                                                    | Venues, geofence circles                                   |
| `04-teacher-review.png`                                                                            | Review drawer                                              |
| `05a`/`05b`/`05c`                                                                                  | Occupancy panel, student check-out card, after check-out   |
| `06a`, `06b`                                                                                       | Rejected + needs-action; suspicious ESP32 proof            |

## Real device acceptance (not tested until performed)

iPhone Safari and Android Chrome via [PHONES.md](PHONES.md); standalone-powered ESP32; exactly one approved record per student; real battery measurement (none taken).
