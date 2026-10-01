// Starts the real server in CONNECTED mode against the Auth + Firestore EMULATORS
// (run inside `firebase emulators:exec`). Seeds a teacher and one course first.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFirebaseGateway } from "../../server/firebase/admin.js";
import { defaultClassrooms } from "../../server/store.js";

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!authHost || !process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error("Run via npm run test:firebase (emulators required).");
const PROJECT = "demo-tech-pulse";
const dir = mkdtempSync(join(tmpdir(), "tp-fb-ui-"));
writeFileSync(
  join(dir, "runtime.json"),
  JSON.stringify({
    mode: "firebase",
    firebase: {
      web: {
        apiKey: "fake-key",
        authDomain: "localhost",
        projectId: PROJECT,
        appId: "1:1:web:1",
      },
    },
  }),
);
const gateway = createFirebaseGateway({ projectId: PROJECT, emulator: true });
const signUp = await fetch(
  `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "teacher@example.test",
      password: "correct-horse-battery",
      returnSecureToken: true,
    }),
  },
).then((r) => r.json());
const db = gateway.db;
await db.collection("users").doc(signUp.localId).set({
  name: "Test Teacher",
  role: "admin",
  email: "teacher@example.test",
});
for (const c of defaultClassrooms)
  await db.collection("classrooms").doc(c.id).set(c);
await db.collection("schedules").doc("sched-t").set({
  classId: "ECE-T",
  subject: "Test Course",
  teacherId: signUp.localId,
  createdBy: signUp.localId,
  classroomId: "room-1",
  time: "09:00 - 10:30",
  days: "Mon",
  enrollmentIds: [],
});
await gateway.close();
process.env.RUNTIME_CONFIG = join(dir, "runtime.json");
process.env.AUTH_MODE = "firebase";
process.env.PORT = process.env.PORT || "5190";
process.env.REFERENCE_PHOTO_PATH = join(dir, "reference-photos.json");
await import("../../server/index.js");
