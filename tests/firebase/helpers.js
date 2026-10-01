import jpeg from "jpeg-js";
import { createFirebaseGateway } from "../../server/firebase/admin.js";
import { FirestoreRepository } from "../../server/firebase/repository.js";
import { createPersistence } from "../../server/firebase/persistence.js";
import { DemoStore, defaultClassrooms } from "../../server/store.js";
import { createApp } from "../../server/app.js";

export const PROJECT = "demo-tech-pulse";
export const ESP_CONFIG = {
  deviceId: "ssec-room-1",
  roomId: "room-1",
  ssid: "Test",
  secret: "a".repeat(64),
};
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
export const emulatorsAvailable = Boolean(authHost && fsHost);

export const photo =
  "data:image/jpeg;base64," +
  jpeg
    .encode({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, 255) }, 70)
    .data.toString("base64");

export async function clearEmulators() {
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, {
    method: "DELETE",
  });
}

let n = 0;
export async function signUp(label) {
  const email = `${label}-${Date.now()}-${n++}@example.test`;
  const r = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "correct-horse-battery",
        returnSecureToken: true,
      }),
    },
  );
  const j = await r.json();
  return { uid: j.localId, idToken: j.idToken, email };
}

export async function boot({ offsetMs = 0, wrapRepo } = {}) {
  const gateway = createFirebaseGateway({ projectId: PROJECT, emulator: true });
  const repo = new FirestoreRepository(gateway.db);
  if (wrapRepo) wrapRepo(repo);
  const store = new DemoStore(() => Date.now() + offsetMs, {
    empty: true,
    presenceConfig: ESP_CONFIG,
  });
  const persistence = await createPersistence({ store, repo });
  const app = createApp(store, {
    connected: {
      gateway,
      mutate: persistence.mutate,
      read: persistence.read,
      webConfig: { projectId: PROJECT },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, token, body, method) => {
    const r = await fetch(base + path, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  const exchange = async (user, extra = {}) =>
    await call("/api/session/exchange", null, {
      idToken: user.idToken,
      ...extra,
    });
  return {
    gateway,
    repo,
    store,
    call,
    exchange,
    base,
    close: async () => {
      server.close();
      await gateway.close();
    },
  };
}

export async function seedCourse(db, { teacherUid, studentUids }) {
  for (const c of defaultClassrooms)
    await db.collection("classrooms").doc(c.id).set(c);
  await db.collection("schedules").doc("sched-t").set({
    classId: "ECE-T",
    subject: "Test Course",
    teacherId: teacherUid,
    createdBy: teacherUid,
    classroomId: "room-1",
    time: "09:00 - 10:30",
    days: "Mon",
    enrollmentIds: studentUids,
  });
}
