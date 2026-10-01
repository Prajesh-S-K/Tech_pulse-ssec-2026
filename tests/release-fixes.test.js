import test from "node:test";
import assert from "node:assert/strict";
import { DemoStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/auth.js";

const password = "test-password-123";

function fixture() {
  const now = Date.parse("2026-10-01T04:00:00Z");
  const store = new DemoStore(() => now);
  for (const u of store.users) u.passwordHash = hashPassword(password);
  return store;
}

async function serve(store) {
  const server = createApp(store).listen(0, "127.0.0.1");
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
  const login = async (id) =>
    (await call("/api/login", null, { id, password })).body.token;
  return { server, call, login };
}

test("roster IDs are validated, deduplicated, and empty rosters are preserved", () => {
  const store = fixture();
  const teacher = store.getUser("teacher");
  const base = { subject: "Test", classId: "T-1" };
  const s = store.createSchedule(
    { ...base, enrollmentIds: ["student-1", "student-1", "student-2"] },
    teacher,
  );
  assert.deepEqual(s.enrollmentIds, ["student-1", "student-2"]);
  assert.deepEqual(
    store.createSchedule({ ...base, enrollmentIds: [] }, teacher).enrollmentIds,
    [],
  );
  assert.deepEqual(
    store.updateSchedule(s.id, { enrollmentIds: [] }, teacher).enrollmentIds,
    [],
  );
  for (const bad of [["nobody"], ["teacher"], "student-1", [1], null])
    assert.throws(
      () => store.updateSchedule(s.id, { enrollmentIds: bad }, teacher),
      /ROSTER_/,
    );
  assert.deepEqual(s.enrollmentIds, []);
});

test("students cannot edit rosters but may propose a course for themselves", () => {
  const store = fixture();
  const student = store.getUser("student-1");
  const base = { subject: "Mine", classId: "M-1" };
  assert.throws(
    () =>
      store.createSchedule(
        { ...base, enrollmentIds: ["student-1", "student-2"] },
        student,
      ),
    /ROSTER_FORBIDDEN/,
  );
  const mine = store.createSchedule(base, student);
  assert.deepEqual(mine.enrollmentIds, ["student-1"]);
  assert.throws(
    () => store.updateSchedule(mine.id, { enrollmentIds: [] }, student),
    /ROSTER_FORBIDDEN/,
  );
  assert.deepEqual(mine.enrollmentIds, ["student-1"]);
});

test("the live-store simulation endpoint no longer exists", async () => {
  const store = fixture();
  const { server, call, login } = await serve(store);
  try {
    const token = await login("dev");
    const before = store.sessions.length;
    const r = await call("/api/dev/simulate", token, {
      scenario: "concurrency",
    });
    assert.equal(r.status, 404);
    assert.equal(store.sessions.length, before);
  } finally {
    server.close();
  }
});

test("review of expired evidence is refused and attempt asks for recapture", () => {
  let now = Date.parse("2026-10-01T04:00:00Z");
  const store = new DemoStore(() => now, { testMode: false });
  for (const u of store.users) u.passwordHash = hashPassword(password);
  const attempt = {
    id: "a-1",
    uid: "student-1",
    sessionId: "s-1",
    phase: "AWAITING_REVIEW",
    validatedChecks: { reasons: [] },
  };
  store.sessions.push({
    id: "s-1",
    teacherId: "teacher",
    scheduleId: "sched-1",
    classId: "ECE-DEMO",
    subject: "x",
  });
  store.attempts.push(attempt);
  store.reviewPhotos.set("a-1", { photo: "x", expiresAt: now + 1000 });
  now += 2000;
  assert.throws(
    () => store.review("a-1", "approve", store.getUser("teacher")),
    /VALID_REVIEW_EVIDENCE_REQUIRED/,
  );
  assert.equal(attempt.phase, "RETRY");
  assert.deepEqual(attempt.reasons, ["REVIEW_PHOTO_EXPIRED_RECAPTURE"]);
  assert.equal(store.attendance.length, 0);
});
