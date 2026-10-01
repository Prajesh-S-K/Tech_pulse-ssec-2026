import test from "node:test";
import assert from "node:assert/strict";
import jpeg from "jpeg-js";
import { DemoStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/auth.js";

const photo =
  "data:image/jpeg;base64," +
  jpeg
    .encode({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, 255) }, 70)
    .data.toString("base64");
const pw = "test-password-123";

async function serve() {
  const now = Date.parse("2026-10-01T04:00:00Z");
  const store = new DemoStore(() => now, {
    presenceConfig: {
      deviceId: "ssec-room-1",
      roomId: "room-1",
      ssid: "T",
      secret: "a".repeat(64),
    },
  });
  for (const u of store.users) u.passwordHash = hashPassword(pw);
  const server = createApp(store).listen(0, "127.0.0.1");
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
    (await call("/api/login", null, { id, password: pw })).body.token;
  return { store, server, call, login };
}

async function attempt(call, session, token, loc) {
  const claim = await call("/api/claim", token, {
    challengeId: session.challenge.id,
  });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  const sub = await call(`/api/attempts/${claim.body.id}/submit`, token, {
    photo,
    location: loc,
  });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  return claim.body.id;
}

test("one teacher and three students complete attempts concurrently; a fourth follows; repeats add nothing", async () => {
  const { store, server, call, login } = await serve();
  try {
    const t = await login("teacher");
    const started = await call("/api/sessions", t, {
      scheduleId: "sched-1",
      sessionType: "demo",
      presenceMode: "baseline",
    });
    const room = started.body.room;
    const loc = { lat: room.lat, lng: room.lng, accuracy: 6 };
    const state = await call("/api/state", t);
    const session = state.body.sessions.find((s) => s.id === started.body.id);
    const ids = ["student-1", "student-2", "student-3"];
    const tokens = await Promise.all(ids.map(login));
    const attempts = await Promise.all(
      tokens.map((tok) => attempt(call, session, tok, loc)),
    );
    // repeated submissions do not create more attempts
    await Promise.all(
      tokens.map((tok, i) =>
        call(`/api/attempts/${attempts[i]}/submit`, tok, {
          photo,
          location: loc,
        }),
      ),
    );
    assert.equal(store.attempts.length, 3);
    // approve everyone concurrently, each twice
    const reviews = await Promise.all(
      attempts.flatMap((id) => [
        call(`/api/attempts/${id}/review`, t, { decision: "approve" }),
        call(`/api/attempts/${id}/review`, t, { decision: "approve" }),
      ]),
    );
    for (const r of reviews) assert.equal(r.status, 200);
    assert.equal(store.attendance.length, 3);
    assert.equal(store.roomPresences.length, 3);
    assert.deepEqual(
      [...new Set(store.attendance.map((a) => a.uid))].sort(),
      ids,
    );
    // fourth independent student afterwards
    const t4 = await login("student-4");
    const a4 = await attempt(call, session, t4, loc);
    assert.equal(
      (await call(`/api/attempts/${a4}/review`, t, { decision: "approve" }))
        .status,
      200,
    );
    assert.equal(store.attendance.length, 4);
    assert.equal(
      (await call("/api/state", t)).body.occupancy.find(
        (o) => o.roomId === room.id,
      ).estimated,
      4,
    );
  } finally {
    server.close();
  }
});

test("a missing or offline ESP32 never produces attendance in an ESP32-required session", async () => {
  const { store, server, call, login } = await serve();
  try {
    const t = await login("teacher");
    const started = await call("/api/sessions", t, {
      scheduleId: "sched-1",
      sessionType: "demo",
      presenceMode: "local",
    });
    const room = started.body.room;
    const state = await call("/api/state", t);
    const session = state.body.sessions.find((s) => s.id === started.body.id);
    const tok = await login("student-1");
    const id = await attempt(call, session, tok, {
      lat: room.lat,
      lng: room.lng,
      accuracy: 5,
    });
    const a = store.attempts.find((x) => x.id === id);
    assert.equal(a.phase, "RETRY");
    assert.deepEqual(a.reasons, ["LOCAL_PROOF_UNAVAILABLE"]);
    assert.equal(a.decision, null);
    const review = await call(`/api/attempts/${id}/review`, t, {
      decision: "approve",
    });
    assert.equal(review.status, 400);
    assert.equal(store.attendance.length, 0);
    assert.equal(store.roomPresences.length, 0);
    // no silent downgrade: the session is still ESP32-required
    assert.equal(store.sessions[0].presenceMode, "local");
  } finally {
    server.close();
  }
});

test("starting a second class and reloading does not move a student's attempt", async () => {
  const { store, server, call, login } = await serve();
  try {
    const t1 = await login("teacher");
    const t2 = await login("teacher-2");
    const first = await call("/api/sessions", t1, {
      scheduleId: "sched-1",
      sessionType: "demo",
      presenceMode: "baseline",
    });
    const st = await call("/api/state", t1);
    const s1 = st.body.sessions.find((s) => s.id === first.body.id);
    const tok = await login("student-2"); // enrolled in sched-1 and sched-3
    const room = first.body.room;
    const id = await attempt(call, s1, tok, {
      lat: room.lat,
      lng: room.lng,
      accuracy: 5,
    });
    const second = await call("/api/sessions", t2, {
      scheduleId: "sched-3",
      sessionType: "demo",
      presenceMode: "baseline",
    });
    assert.equal(second.status, 200);
    const reload = await call("/api/state", tok);
    const mine = reload.body.attempts.find((a) => a.id === id);
    assert.equal(mine.sessionId, first.body.id);
    assert.ok(reload.body.sessions.some((s) => s.id === first.body.id));
    assert.equal(store.attempts.filter((a) => a.uid === "student-2").length, 1);
  } finally {
    server.close();
  }
});
