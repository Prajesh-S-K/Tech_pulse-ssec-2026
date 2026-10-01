import test from "node:test";
import jpeg from "jpeg-js";
import assert from "node:assert/strict";
import { DemoStore } from "../server/store.js";
import { createPersistence } from "../server/firebase/persistence.js";
import { PersistenceError } from "../server/firebase/repository.js";

// Supplementary: an in-memory repository with the same interface as FirestoreRepository.
// The emulator suite (npm run test:firebase) is what proves Firestore integration.
function fakeRepo(seed = {}) {
  const docs = new Map();
  for (const [col, list] of Object.entries(seed))
    for (const d of list) docs.set(`${col}/${d.id}`, d);
  const repo = {
    docs,
    delay: 0,
    fail: false,
    async loadAll() {
      const out = {};
      for (const col of [
        "users",
        "classrooms",
        "schedules",
        "sessions",
        "attempts",
        "attendance",
        "roomPresences",
      ])
        out[col] = [...docs.entries()]
          .filter(([k]) => k.startsWith(col + "/"))
          .map(([, v]) => structuredClone(v));
      return out;
    },
    async commit(changes) {
      if (repo.delay) await new Promise((r) => setTimeout(r, repo.delay));
      if (repo.fail) throw new PersistenceError(new Error("down"));
      for (const c of changes) {
        const key = `${c.col}/${c.id}`;
        if (c.op === "delete") docs.delete(key);
        else if (c.op === "create" && docs.has(key)) continue;
        else docs.set(key, { ...c.data, id: c.id });
      }
    },
  };
  return repo;
}
const photo =
  "data:image/jpeg;base64," +
  jpeg
    .encode({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, 255) }, 70)
    .data.toString("base64");
const student = { id: "u1", name: "Ada", role: "student", email: "a@x.test" };

test("reference-photo file failure is a warning and never rolls back committed data", async () => {
  const repo = fakeRepo({ users: [student] });
  const store = new DemoStore(Date.now, { empty: true });
  const sidecar = {
    load() {},
    save() {
      throw new Error("disk full");
    },
  };
  const { mutate } = await createPersistence({ store, repo, sidecar });
  const ctx = { warnings: [] };
  const user = await mutate(
    () =>
      store.updateUser(
        "u1",
        { name: "Ada L", referencePhoto: photo },
        store.getUser("u1"),
      ),
    ctx,
  ).catch((e) => e);
  assert.ok(!(user instanceof Error), String(user));
  assert.deepEqual(ctx.warnings, ["REFERENCE_PHOTO_NOT_SAVED_LOCALLY"]);
  assert.equal(
    repo.docs.get("users/u1").name,
    "Ada L",
    "Firestore commit stands",
  );
  assert.equal(store.getUser("u1").name, "Ada L", "cache not rolled back");
  assert.equal(
    repo.docs.get("users/u1").referencePhoto,
    undefined,
    "photo never sent to Firestore",
  );
});

test("reads queue behind in-flight writes and never see a rolled-back mutation", async () => {
  const repo = fakeRepo({ users: [student] });
  const store = new DemoStore(Date.now, { empty: true });
  const { mutate, read } = await createPersistence({ store, repo });
  repo.delay = 40;
  repo.fail = true;
  const write = mutate(() => {
    store.getUser("u1").name = "Uncommitted";
  }).catch((e) => e);
  const seen = read(() => store.getUser("u1").name);
  assert.equal(
    await seen,
    "Ada",
    "read after a failed commit sees the original state",
  );
  assert.equal((await write).code, "PERSISTENCE_FAILED");
  repo.fail = false;
  await mutate(() => {
    store.getUser("u1").name = "Committed";
  });
  assert.equal(await read(() => store.getUser("u1").name), "Committed");
  assert.equal(repo.docs.get("users/u1").name, "Committed");
});

test("a rejected mutation restores the complete store, not only part of it", async () => {
  const repo = fakeRepo({
    users: [student, { id: "u2", name: "Bo", role: "student" }],
  });
  const store = new DemoStore(Date.now, { empty: true });
  const { mutate } = await createPersistence({ store, repo });
  store.schedules.push({
    id: "s1",
    subject: "A",
    classId: "A",
    teacherId: "t",
    enrollmentIds: [],
  });
  const before = JSON.stringify([store.users, store.schedules]);
  await assert.rejects(
    mutate(() => {
      store.schedules[0].subject = "changed";
      store.users[0].name = "changed";
      throw new Error("VALIDATION");
    }),
    /VALIDATION/,
  );
  assert.equal(JSON.stringify([store.users, store.schedules]), before);
});

test("snapshot() is a pure read: expiry is derived from the clock, state is untouched", () => {
  let now = 1_000_000;
  const store = new DemoStore(() => now, { reviewTtlMs: 5000 });
  const teacher = store.getUser("teacher");
  store.attempts.push({
    id: "a1",
    uid: "student-1",
    sessionId: "s",
    phase: "AWAITING_REVIEW",
    validatedChecks: {},
    reasons: [],
  });
  store.sessions.push({
    id: "s",
    teacherId: "teacher",
    scheduleId: "sched-1",
    room: { id: "room-1" },
    open: false,
    challenges: [],
    opensAt: now,
    closesAt: now,
  });
  store.reviewPhotos.set("a1", {
    photo: "data:image/jpeg;base64,xx",
    expiresAt: now + 5000,
  });
  let saves = 0;
  const realSave = store.save.bind(store);
  store.save = () => {
    saves++;
    return realSave();
  };
  const live = store.snapshot(teacher).attempts[0];
  assert.equal(live.phase, "AWAITING_REVIEW");
  assert.ok(live.photo);
  now += 5000; // exactly the expiry instant
  const expired = store.snapshot(teacher).attempts[0];
  assert.equal(expired.phase, "RETRY");
  assert.equal(expired.photo, undefined);
  assert.deepEqual(expired.reasons, ["REVIEW_PHOTO_EXPIRED_RECAPTURE"]);
  assert.equal(
    store.attempts[0].phase,
    "AWAITING_REVIEW",
    "snapshot did not mutate",
  );
  assert.equal(saves, 0, "snapshot did not write");
  assert.throws(
    () => store.review("a1", "approve", teacher),
    /VALID_REVIEW_EVIDENCE_REQUIRED/,
  );
});
