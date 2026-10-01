import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { DemoStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/auth.js";
import { signPresence } from "../server/presence.js";

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

function setup({ presence = true, persist = false } = {}) {
  let now = Date.parse("2026-10-01T04:00:00Z");
  const dir = mkdtempSync(join(tmpdir(), "tp-occ-"));
  const options = {
    ...(presence ? { presenceConfig: config } : {}),
    ...(persist ? { persistPath: join(dir, "store.json") } : {}),
  };
  const store = new DemoStore(() => now, options);
  for (const u of store.users)
    u.passwordHash = hashPassword("test-password-123");
  return {
    store,
    dir,
    options,
    advance: (n) => (now += n),
    clock: () => now,
    teacher: store.getUser("teacher"),
  };
}
const evidence = (s) => ({
  photo,
  location: { lat: s.room.lat, lng: s.room.lng, accuracy: 5 },
});
function start(f, mode, extra = {}) {
  return f.store.start(
    {
      scheduleId: "sched-1",
      sessionType: "demo",
      presenceMode: mode,
      ...extra,
    },
    f.teacher,
  );
}
function submitBaseline(f, s, uid) {
  const a = f.store.claim(uid, s.challenges.at(-1).id);
  f.store.submit(uid, a.id, evidence(s));
  return a;
}
function submitEsp(f, s, uid) {
  const a = f.store.claim(uid, s.challenges.at(-1).id);
  const req = f.store.presenceRequest(uid, a.id);
  const payload = req.requestCode.split(".").slice(0, 4).join(".");
  const proof = payload + "." + signPresence("proof", payload, config.secret);
  f.store.submit(uid, a.id, { ...evidence(s), presenceProof: proof });
  return a;
}
const estimate = (f, user = f.teacher) =>
  f.store.occupancyFor(user).find((o) => o.roomId === "room-1")?.estimated || 0;

test("baseline attendance needs no ESP32 configuration at all", () => {
  const f = setup({ presence: false });
  const s = start(f, "baseline");
  assert.equal(s.presenceMode, "baseline");
  const a = submitBaseline(f, s, "student-1");
  assert.equal(a.phase, "AWAITING_REVIEW");
  f.store.review(a.id, "approve", f.teacher);
  assert.equal(f.store.attendance.length, 1);
  assert.throws(
    () => start(f, "local"),
    /PRESENCE_DEVICE_NOT_CONFIGURED_FOR_ROOM/,
  );
});

test("approval adds one estimated presence; duplicates, awaiting and rejection add none", () => {
  const f = setup();
  const s = start(f, "baseline");
  const a = submitBaseline(f, s, "student-1");
  const b = submitBaseline(f, s, "student-2");
  const c = submitBaseline(f, s, "student-3");
  assert.equal(estimate(f), 0, "awaiting review is not presence");
  f.store.review(a.id, "approve", f.teacher);
  f.store.review(a.id, "approve", f.teacher);
  f.store.review(b.id, "reject", f.teacher);
  assert.equal(estimate(f), 1);
  assert.equal(f.store.roomPresences.length, 1);
  assert.equal(f.store.attendance.length, 1);
  assert.equal(c.phase, "AWAITING_REVIEW");
  assert.equal(estimate(f, f.store.getUser("teacher-2")), 0);
  assert.equal(estimate(f, f.store.getUser("dev")), 1);
});

test("checkout is idempotent, owner-only, targets one record, keeps attendance", () => {
  const f = setup();
  const s = start(f, "baseline");
  const ids = ["student-1", "student-2"].map((uid) => {
    const a = submitBaseline(f, s, uid);
    f.store.review(a.id, "approve", f.teacher);
    return a;
  });
  assert.equal(estimate(f), 2);
  const mine = f.store.roomPresences.find((r) => r.uid === "student-1");
  assert.throws(
    () => f.store.checkoutPresence("student-2", mine.id),
    /PRESENCE_NOT_FOUND/,
  );
  assert.throws(
    () => f.store.checkoutPresence("student-1", undefined),
    /PRESENCE_NOT_FOUND/,
  );
  assert.equal(estimate(f), 2);
  f.store.checkoutPresence("student-1", mine.id);
  const at = mine.checkedOutAt;
  f.advance(1000);
  f.store.checkoutPresence("student-1", mine.id);
  assert.equal(mine.checkedOutAt, at);
  assert.equal(estimate(f), 1);
  assert.equal(f.store.attendance.length, 2);
  // duplicate approval never reactivates a checked-out presence
  f.store.review(ids[0].id, "approve", f.teacher);
  assert.equal(estimate(f), 1);
});

test("presence expires by server clock without cleanup; late approval is never active", () => {
  const f = setup();
  const s = start(f, "baseline");
  const a = submitBaseline(f, s, "student-1");
  f.store.review(a.id, "approve", f.teacher);
  assert.equal(estimate(f), 1);
  f.advance(61 * 60 * 1000);
  assert.equal(estimate(f), 0);
  assert.equal(f.store.attendance.length, 1);
  // approval after the horizon records attendance but no active contribution
  const g = setup();
  const s2 = start(g, "baseline");
  const late = submitBaseline(g, s2, "student-2");
  g.store.sessions[0].opensAt = g.clock() - 61 * 60 * 1000;
  g.store.review(late.id, "approve", g.teacher);
  assert.equal(g.store.attendance.length, 1);
  assert.equal(estimate(g), 0);
});

test("students only see their own presence and never occupancy", () => {
  const f = setup();
  const s = start(f, "baseline");
  for (const uid of ["student-1", "student-2"]) {
    const a = submitBaseline(f, s, uid);
    f.store.review(a.id, "approve", f.teacher);
  }
  const view = f.store.snapshot(f.store.getUser("student-1"));
  assert.equal(view.occupancy, undefined);
  assert.deepEqual(
    view.myPresence.map((r) => r.uid),
    ["student-1"],
  );
});

test("restart preserves unexpired presence, checkout, and excludes expired", () => {
  const f = setup({ persist: true });
  const s = start(f, "baseline");
  const ids = ["student-1", "student-2"].map((uid) => {
    const a = submitBaseline(f, s, uid);
    f.store.review(a.id, "approve", f.teacher);
    return uid;
  });
  const out = f.store.roomPresences.find((r) => r.uid === ids[0]);
  f.store.checkoutPresence(ids[0], out.id);
  const again = new DemoStore(f.clock, f.options);
  assert.equal(
    again.roomPresences.find((r) => r.uid === ids[0]).checkedOutAt,
    out.checkedOutAt,
  );
  assert.equal(
    again
      .occupancyFor(again.getUser("teacher"))
      .find((o) => o.roomId === "room-1").estimated,
    1,
  );
  f.advance(61 * 60 * 1000);
  const later = new DemoStore(f.clock, f.options);
  assert.equal(
    later
      .occupancyFor(later.getUser("teacher"))
      .find((o) => o.roomId === "room-1"),
    undefined,
  );
});

test("replacement session: old attempts untouched, both approval orders give one record", () => {
  for (const order of ["original-first", "replacement-first"]) {
    const f = setup();
    const old = start(f, "local");
    const oldAttempt = submitEsp(f, old, "student-1");
    const oldDeadline = oldAttempt.deadline;
    assert.throws(
      () => f.store.replaceWithoutEsp32(old.id, f.store.getUser("teacher-2")),
      /PERMISSION/,
    );
    const repl = f.store.replaceWithoutEsp32(old.id, f.teacher);
    assert.equal(repl.presenceMode, "baseline");
    assert.equal(repl.attendanceEventId, old.id);
    assert.equal(old.open, false);
    assert.equal(oldAttempt.deadline, oldDeadline);
    assert.equal(old.presenceMode, "local");
    const newAttempt = submitBaseline(f, repl, "student-1");
    assert.notEqual(newAttempt.id, oldAttempt.id);
    const [first, second] =
      order === "original-first"
        ? [oldAttempt, newAttempt]
        : [newAttempt, oldAttempt];
    f.store.review(first.id, "approve", f.teacher);
    f.store.review(second.id, "approve", f.teacher);
    assert.equal(f.store.attendance.length, 1, order);
    assert.equal(f.store.roomPresences.length, 1, order);
    assert.equal(estimate(f), 1, order);
    assert.equal(f.store.attendance[0].id, `${old.id}_student-1`);
  }
});

test("students and non-owner teachers cannot change proof policy; ESP32 never blocks baseline", async () => {
  const f = setup({ presence: false });
  const app = createApp(f.store);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, token, body) => {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  const login = async (id) =>
    (await call("/api/login", null, { id, password: "test-password-123" })).body
      .token;
  try {
    const st = await login("student-1");
    assert.equal(
      (
        await call("/api/sessions", st, {
          scheduleId: "sched-1",
          sessionType: "demo",
          presenceMode: "baseline",
        })
      ).status,
      403,
    );
    const t = await login("teacher");
    const started = await call("/api/sessions", t, {
      scheduleId: "sched-1",
      sessionType: "demo",
      presenceMode: "baseline",
    });
    assert.equal(started.status, 200);
    assert.equal(
      (
        await call(
          `/api/sessions/${started.body.id}/replace-without-esp32`,
          st,
          {},
        )
      ).status,
      403,
    );
    const t2 = await login("teacher-2");
    assert.equal(
      (
        await call(
          `/api/sessions/${started.body.id}/replace-without-esp32`,
          t2,
          {},
        )
      ).status,
      400,
    );
    const state = await call("/api/state", st);
    assert.equal(state.body.occupancy, undefined);
    assert.equal(
      (await call(`/api/presence/not-mine/checkout`, st, {})).status,
      400,
    );
  } finally {
    server.close();
  }
});

test("local disk failure rolls back the whole mutation and returns retryable 503", async () => {
  const f = setup({ persist: true });
  const app = createApp(f.store);
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
  try {
    const t = (
      await call("/api/login", null, {
        id: "teacher",
        password: "test-password-123",
      })
    ).body.token;
    const before = JSON.stringify(f.store.schedules);
    // make the data directory unwritable so the next save fails
    chmodSync(f.dir, 0o500);
    const r = await call(
      "/api/schedules/sched-1",
      t,
      { subject: "Changed", enrollmentIds: [] },
      "PUT",
    );
    chmodSync(f.dir, 0o700);
    if (process.getuid?.() === 0) return; // root ignores permissions
    assert.equal(r.status, 503);
    assert.equal(r.body.retryable, true);
    assert.equal(JSON.stringify(f.store.schedules), before);
    const ok = await call(
      "/api/schedules/sched-1",
      t,
      { subject: "Changed" },
      "PUT",
    );
    assert.equal(ok.status, 200);
  } finally {
    try {
      chmodSync(f.dir, 0o700);
    } catch {}
    server.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("rejected schedule update leaves the entire schedule unchanged", () => {
  const f = setup();
  const before = structuredClone(f.store.schedules[0]);
  assert.throws(() =>
    f.store.updateSchedule(
      "sched-1",
      { subject: "Renamed", classId: "NEW", enrollmentIds: ["ghost"] },
      f.teacher,
    ),
  );
  assert.deepEqual(f.store.schedules[0], before);
});
