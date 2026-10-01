import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { DemoStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import { hashPassword, verifyPassword, publicData } from "../server/auth.js";
import { signPresence } from "../server/presence.js";
const password = "test-password-123";
const photo =
  "data:image/jpeg;base64," +
  jpeg
    .encode({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, 255) }, 70)
    .data.toString("base64");
const config = {
  deviceId: "ssec-room-1",
  roomId: "room-1",
  ssid: "Test",
  secret: "a".repeat(64),
};
function setup(persist = false) {
  let now = Date.parse("2026-10-01T04:00:00Z");
  const dir = mkdtempSync(join(tmpdir(), "tp-stable-"));
  const options = {
    presenceConfig: config,
    ...(persist
      ? {
          persistPath: join(dir, "store.json"),
          credentialsPath: join(dir, "passwords.json"),
        }
      : {}),
  };
  const store = new DemoStore(() => now, options);
  if (!persist)
    for (const u of store.users) u.passwordHash = hashPassword(password);
  return { store, dir, options, advance: (n) => (now += n), clock: () => now };
}
function session(f, local = false, teacher = "teacher", schedule = "sched-1") {
  return f.store.start(
    {
      scheduleId: schedule,
      sessionType: "demo",
      presenceMode: local ? "local" : "baseline",
    },
    f.store.getUser(teacher),
  );
}
function evidence(s) {
  return { photo, location: { lat: s.room.lat, lng: s.room.lng, accuracy: 5 } };
}
test("normal four-user flow requires responsible teacher review and records each attendance once", () => {
  const f = setup();
  const s = session(f);
  for (let i = 1; i <= 4; i++) {
    const a = f.store.claim(`student-${i}`, s.challenges[0].id);
    f.store.submit(a.uid, a.id, evidence(s));
    assert.equal(a.phase, "AWAITING_REVIEW");
    assert.equal(a.decision, null);
    assert.throws(
      () => f.store.review(a.id, "approve", f.store.getUser("teacher-2")),
      /PERMISSION/,
    );
    assert.throws(
      () => f.store.review(a.id, "approve", f.store.getUser(a.uid)),
      /PERMISSION/,
    );
  }
  assert.equal(f.store.attendance.length, 0);
  for (const a of f.store.attempts) {
    f.store.review(a.id, "approve", f.store.getUser("teacher"));
    f.store.review(a.id, "approve", f.store.getUser("teacher"));
    assert.equal(a.decision, "VERIFIED");
  }
  assert.equal(f.store.attendance.length, 4);
  assert.equal(f.store.reviewPhotos.size, 0);
});
test("boolean, corrupt photo and simulation cannot produce attendance; location failures cannot be reviewed", () => {
  const f = setup();
  const s = session(f);
  const a = f.store.claim("student-1", s.challenges[0].id);
  for (const bad of [true, false, "data:image/jpeg;base64,YmFk"]) {
    f.store.submit(a.uid, a.id, { ...evidence(s), photo: bad });
    assert.equal(a.phase, "RETRY");
    assert.throws(
      () => f.store.review(a.id, "approve", f.store.getUser("dev")),
      /VALID_REVIEW/,
    );
  }
  assert.throws(
    () => f.store.submit(a.uid, a.id, { ...evidence(s), simulated: true }),
    /SIMULATION/,
  );
  f.store.submit(a.uid, a.id, {
    ...evidence(s),
    location: { lat: 0, lng: 0, accuracy: 5 },
  });
  assert.notEqual(a.decision, "VERIFIED");
  assert.throws(
    () => f.store.review(a.id, "approve", f.store.getUser("teacher")),
    /VALID_REVIEW/,
  );
  assert.equal(f.store.attendance.length, 0);
});
test("server resolves simultaneous course challenges and rejects unenrolled accounts", () => {
  const f = setup();
  const a = session(f);
  const b = session(f, false, "teacher-2", "sched-3");
  assert.equal(f.store.claim("student-1", a.challenges[0].id).sessionId, a.id);
  assert.equal(f.store.claim("student-2", b.challenges[0].id).sessionId, b.id);
  f.store.schedules[0].enrollmentIds = [];
  assert.throws(() => f.store.claim("student-3", a.challenges[0].id), /ENROLL/);
});
test("temporary review photo is absent from disk, expires at 15 minutes, and restart requires recapture", () => {
  const f = setup(true);
  const s = session(f);
  const a = f.store.claim("student-1", s.challenges[0].id);
  f.store.submit(a.uid, a.id, evidence(s));
  assert.ok(f.store.snapshot(f.store.getUser("teacher")).attempts[0].photo);
  assert.ok(!f.store.snapshot(f.store.getUser("student-1")).attempts[0].photo);
  assert.ok(!readFileSync(f.options.persistPath, "utf8").includes(photo));
  const reloaded = new DemoStore(f.clock, f.options);
  assert.equal(reloaded.attempts[0].phase, "RETRY");
  assert.throws(
    () => reloaded.review(a.id, "approve", reloaded.getUser("teacher")),
    /VALID_REVIEW/,
  );
  f.advance(899999);
  f.store.expireReviewPhotos();
  assert.equal(f.store.reviewPhotos.size, 1);
  f.advance(1);
  f.store.expireReviewPhotos();
  assert.equal(a.phase, "RETRY");
  assert.throws(
    () => f.store.review(a.id, "approve", f.store.getUser("teacher")),
    /VALID_REVIEW/,
  );
  f.store.submit(a.uid, a.id, { photo });
  f.store.review(a.id, "approve", f.store.getUser("teacher"));
  assert.equal(f.store.attendance.length, 1);
  assert.ok(!readFileSync(f.options.persistPath, "utf8").includes(photo));
});
test("normal companion flow rejects altered, expired and cross-student proof, accepts valid proof only into review", () => {
  const f = setup();
  const s = session(f, true);
  const a = f.store.claim("student-1", s.challenges[0].id);
  const req = f.store.presenceRequest(a.uid, a.id);
  const payload = req.requestCode.split(".").slice(0, 4).join(".");
  const proof = payload + "." + signPresence("proof", payload, config.secret);
  const b = f.store.claim("student-2", s.challenges[0].id);
  for (const [attempt, p] of [
    [a, proof + "x"],
    [b, proof],
  ]) {
    f.store.submit(attempt.uid, attempt.id, {
      ...evidence(s),
      presenceProof: p,
    });
    assert.notEqual(attempt.decision, "VERIFIED");
    assert.throws(
      () => f.store.review(attempt.id, "approve", f.store.getUser("teacher")),
      /VALID_REVIEW/,
    );
  }
  f.store.submit(a.uid, a.id, { ...evidence(s), presenceProof: proof });
  assert.equal(a.phase, "AWAITING_REVIEW");
  f.store.review(a.id, "approve", f.store.getUser("teacher"));
  const c = f.store.claim("student-3", s.challenges[0].id);
  f.advance(196000);
  f.store.submit(c.uid, c.id, {
    ...evidence(s),
    presenceProof: proof,
    capturedAt: 1,
  });
  assert.notEqual(c.decision, "VERIFIED");
  assert.throws(
    () => f.store.review(c.id, "approve", f.store.getUser("teacher")),
    /VALID_REVIEW/,
  );
});
test("scheduled sessions enforce Asia/Kolkata; demo override is logged", () => {
  const f = setup();
  f.store.schedules[0].days = "Thu";
  f.store.schedules[0].time = "09:00 - 10:30";
  const s = f.store.start(
    { scheduleId: "sched-1", sessionType: "scheduled" },
    f.store.getUser("teacher"),
  );
  assert.equal(s.sessionType, "scheduled");
  f.advance(2 * 3600000);
  assert.throws(
    () =>
      f.store.start(
        { scheduleId: "sched-1", sessionType: "scheduled" },
        f.store.getUser("teacher"),
      ),
    /OUTSIDE_SCHEDULE/,
  );
  session(f);
  assert.ok(f.store.logs.some((l) => l.details?.timetableOverride === true));
});
test("salted credentials, registration, session expiry/logout, safe responses and HTTPS origin checks", async () => {
  const f = setup();
  assert.notEqual(hashPassword(password), hashPassword(password));
  assert.ok(verifyPassword(password, hashPassword(password)));
  const app = createApp(f.store, {
    publicOrigin: "https://demo.example",
    trustProxy: "loopback",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function req(path, body, token, headers = {}) {
    return fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  try {
    for (const p of ["", "wrong"])
      assert.equal(
        (await req("/login", { id: "student-1", password: p })).status,
        401,
      );
    assert.equal(
      (
        await req("/register", {
          name: "New",
          email: "new@example.test",
          password: "short",
        })
      ).status,
      400,
    );
    let response = await req("/login", { id: "student-1", password });
    let auth = await response.json();
    assert.ok(!JSON.stringify(auth).includes("passwordHash"));
    assert.equal((await req("/people", undefined, auth.token)).status, 403);
    await req("/logout", {}, auth.token);
    assert.equal((await req("/state", undefined, auth.token)).status, 401);
    auth = await (await req("/login", { id: "teacher", password })).json();
    const people = await (await req("/people", undefined, auth.token)).json();
    assert.ok(!JSON.stringify(people).includes("passwordHash"));
    f.advance(8 * 3600000);
    assert.equal((await req("/state", undefined, auth.token)).status, 401);
    assert.equal(
      (
        await req("/login", { id: "teacher", password }, null, {
          "X-Forwarded-Host": "demo.example",
          Origin: "https://evil.example",
          "X-Forwarded-Proto": "https",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await req("/login", { id: "teacher", password }, null, {
          "X-Forwarded-Host": "demo.example",
          Origin: "https://demo.example",
          "X-Forwarded-Proto": "https",
        })
      ).status,
      200,
    );
    assert.equal(
      publicData({ users: f.store.users }).users[0].passwordHash,
      undefined,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
test("four independent authenticated HTTP attempts submit and review concurrently without duplicates", async () => {
  const f = setup();
  const s = session(f);
  const server = createApp(f.store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function post(path, body, token) {
    const r = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200);
    return r.json();
  }
  try {
    const users = await Promise.all(
      [1, 2, 3, 4].map((i) => post("/login", { id: `student-${i}`, password })),
    );
    const teacher = await post("/login", { id: "teacher", password });
    const attempts = await Promise.all(
      users.map((u) =>
        post("/claim", { challengeId: s.challenges[0].id }, u.token),
      ),
    );
    await Promise.all(
      attempts.map((a, i) =>
        post(`/attempts/${a.id}/submit`, evidence(s), users[i].token),
      ),
    );
    assert.equal(f.store.attendance.length, 0);
    await Promise.all(
      attempts.flatMap((a) => [
        post(
          `/attempts/${a.id}/review`,
          { decision: "approve" },
          teacher.token,
        ),
        post(
          `/attempts/${a.id}/review`,
          { decision: "approve" },
          teacher.token,
        ),
      ]),
    );
    assert.equal(f.store.attendance.length, 4);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
