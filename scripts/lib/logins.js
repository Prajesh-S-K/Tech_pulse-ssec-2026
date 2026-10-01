// Writes a human-friendly list of the demo accounts (this copy's generated passwords) so a
// judge never has to read JSON. The file lives in private/ (ignored by Git, never released).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ROLES = {
  teacher: [
    "Teacher",
    "Embedded Systems + Digital Signal Processing. Starts sessions, reviews photos.",
  ],
  "teacher-2": [
    "Teacher",
    "IoT Systems & Robotics. Shows that teachers only see their own classes.",
  ],
  dev: [
    "Developer",
    "Sees everything, audit logs, can change student/teacher roles.",
  ],
  "student-1": ["Student", "Enrolled in Embedded Systems and DSP."],
  "student-2": [
    "Student",
    "Enrolled in all three courses (good for two simultaneous classes).",
  ],
  "student-3": ["Student", "Embedded Systems and IoT."],
  "student-4": ["Student", "Embedded Systems and DSP."],
  "student-5": ["Student", "Embedded Systems and DSP."],
  "student-6": ["Student", "Embedded Systems and IoT."],
};

export function buildLogins({ credentialsPath, url, phoneUrl }) {
  if (!existsSync(credentialsPath)) return null;
  const creds = JSON.parse(readFileSync(credentialsPath, "utf8"));
  const order = Object.keys(ROLES).filter((id) => creds[id]);
  const extra = Object.keys(creds).filter((id) => !ROLES[id]);
  const row = (id) => {
    const [role, note] = ROLES[id] || ["User", ""];
    return `  ${id.padEnd(10)} ${creds[id].password.padEnd(18)} ${role.padEnd(10)} ${note}`;
  };
  return `TECH PULSE — DEMO LOGINS  (synthetic accounts, valid for this copy only)
===================================================================================
Open the portal:  ${url}${phoneUrl ? `\nOn phones:        ${phoneUrl}   (see the README: scan the two QR codes)` : ""}

Sign in with the "Student Roll No, Faculty ID, or Email" box = the ACCOUNT below.

  ACCOUNT    PASSWORD           ROLE       WHAT IT IS GOOD FOR
  ---------- ------------------ ---------- ---------------------------------------------
${[...order, ...extra].map(row).join("\n")}

TRY THIS (5 minutes)
  1. Sign in as  teacher  -> Live Attendance -> Session type "Demo" -> Start selected session.
  2. In a second window (or a phone), sign in as  student-1  and open the check-in link
     (teacher screen: "Student check-in link"). Claim -> Read my location -> Open camera
     -> Capture photo -> Submit.
  3. As teacher: Review Photos -> Approve Identity.  The student sees "Attendance recorded."
  4. Teacher screen: "Estimated room occupancy" shows 1.  Student: "Check out of room" -> 0.
  5. Optional: choose the ESP32 proof policy, or use a far-away location to see a rejection.

Passwords are generated when the program first starts and are not shared with anyone.
Delete the folder "private" to get a fresh set (this also clears the demo data).
`;
}

export function writeLogins(opts, outPath) {
  const text = buildLogins(opts);
  if (!text) return false;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text, { mode: 0o600 });
  return true;
}
