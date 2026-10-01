import test from "node:test";
import assert from "node:assert/strict";
import { DemoStore } from "../server/store.js";
import { signPresence, PresenceService } from "../server/presence.js";
import { createApp } from "../server/app.js";
const config = {
  deviceId: "ssec-room-1",
  roomId: "room-1",
  ssid: "Test-Classroom",
  secret: "a".repeat(64),
};
function fixture() {
  let now = 1000000;
  const store = new DemoStore(() => now, {
    presenceConfig: config,
    testMode: true,
  });
  const s = store.start(
    { scheduleId: "sched-1", presenceMode: "local" },
    store.getUser("teacher"),
  );
  const a = store.claim("student-1", s.challenges[0].id, s.classId);
  const evidence = {
    location: { lat: s.room.lat, lng: s.room.lng, accuracy: 5 },
    photo: true,
    simulated: true,
  };
  const req = store.presenceRequest(a.uid, a.id);
  const payload = req.requestCode.split(".").slice(0, 4).join(".");
  const proof = payload + "." + signPresence("proof", payload, config.secret);
  return { store, s, a, evidence, req, proof, advance: (n) => (now += n) };
}
test("local mode requires configured room before starting", () => {
  const store = new DemoStore(Date.now, { testMode: true });
  assert.throws(() => store.start({ presenceMode: "local" }), /NOT_CONFIGURED/);
});
test("local attempts have 180 seconds and signed response is required even for simulation", () => {
  const f = fixture();
  assert.equal(f.a.deadline - f.a.claimedAt, 180000);
  const noProof = f.store.submit(f.a.uid, f.a.id, {
    ...f.evidence,
    localProof: "verified",
  });
  assert.equal(noProof.phase, "RETRY");
  const valid = f.store.submit(f.a.uid, f.a.id, {
    ...f.evidence,
    presenceProof: f.proof,
  });
  assert.equal(valid.decision, "VERIFIED");
  assert.ok(valid.reasons.includes("LOCAL_EVIDENCE"));
  assert.equal(
    f.store.submit(f.a.uid, f.a.id, { ...f.evidence, presenceProof: f.proof })
      .decision,
    "VERIFIED",
  );
  assert.equal(f.store.attendance.length, 1);
});
test("request signatures cannot be used as proofs; tampering cannot verify", () => {
  const f = fixture();
  for (const proof of [
    f.req.requestCode,
    f.proof.slice(0, -1) + "z",
    f.proof.replace("ssec-room-1", "room-2"),
  ])
    assert.equal(f.store.presence.verify(f.a, "room-1", proof), "invalid");
});
test("proof cannot be replayed for another attempt or another device", () => {
  const f = fixture();
  const a2 = f.store.claim("student-2", f.s.challenges[0].id, f.s.classId);
  f.store.presenceRequest(a2.uid, a2.id);
  assert.equal(f.store.presence.verify(a2, "room-1", f.proof), "invalid");
  assert.equal(
    new PresenceService(
      { ...config, secret: "b".repeat(64) },
      () => 1000000,
    ).verify(f.a, "room-1", f.proof),
    "invalid",
  );
});
test("expiry is controlled by server time without an ESP32 wall clock", () => {
  const f = fixture();
  f.advance(195001);
  assert.equal(f.store.presence.verify(f.a, "room-1", f.proof), "invalid");
  assert.equal(
    f.store.submit(f.a.uid, f.a.id, { ...f.evidence, presenceProof: f.proof })
      .phase,
    "PENDING_REVIEW",
  );
});
test("proof request endpoint enforces attempt ownership and does not reveal key", async (t) => {
  const f = fixture();
  const server = createApp(f.store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login(id) {
    return (
      await (
        await fetch(base + "/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "fixture-password-only", id }),
        })
      ).json()
    ).token;
  }
  const token = await login("student-2");
  const r = await fetch(base + `/api/attempts/${f.a.id}/presence-request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(r.status, 400);
  assert.ok(
    !JSON.stringify(f.store.presence.publicStatus()).includes(config.secret),
  );
});
