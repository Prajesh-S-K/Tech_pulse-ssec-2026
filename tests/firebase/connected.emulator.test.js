// Integration tests against the Firebase Auth + Firestore EMULATORS.
// Run with: npm run test:firebase  (needs JDK 21+ for the Firestore emulator)
import test from "node:test";
import assert from "node:assert/strict";
import {
  boot,
  clearEmulators,
  emulatorsAvailable,
  photo,
  seedCourse,
  signUp,
  PROJECT,
} from "./helpers.js";

const skip = emulatorsAvailable
  ? false
  : "Firebase emulators not running (use npm run test:firebase)";

async function world(opts) {
  await clearEmulators();
  const teacher = await signUp("teacher");
  const student = await signUp("student");
  const other = await signUp("other");
  const h = await boot(opts);
  const db = h.gateway.db;
  await db
    .collection("users")
    .doc(teacher.uid)
    .set({ name: "Teacher", role: "admin", email: teacher.email });
  await seedCourse(db, { teacherUid: teacher.uid, studentUids: [student.uid] });
  await h.close();
  const live = await boot(opts);
  return { h: live, teacher, student, other };
}
const login = async (h, u) => (await h.exchange(u)).body.token;

async function submitOne(h, tTok, sTok) {
  const started = await h.call("/api/sessions", tTok, {
    scheduleId: "sched-t",
    sessionType: "demo",
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const state = await h.call("/api/state", tTok);
  const challengeId = state.body.sessions.at(-1).challenge.id;
  const claim = await h.call("/api/claim", sTok, { challengeId });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  const room = started.body.room;
  const sub = await h.call(`/api/attempts/${claim.body.id}/submit`, sTok, {
    photo,
    location: { lat: room.lat, lng: room.lng, accuracy: 5 },
  });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  return { attemptId: claim.body.id, sessionId: started.body.id };
}

test(
  "ID tokens are verified; role comes from users/{uid}; local login is disabled",
  { skip },
  async () => {
    const { h, teacher, student } = await world();
    try {
      assert.equal(
        (await h.call("/api/session/exchange", null, { idToken: "garbage" }))
          .status,
        401,
      );
      const s = await h.exchange(student, { role: "dev", name: "Mallory" });
      assert.equal(s.status, 200);
      assert.equal(s.body.user.role, "student");
      assert.equal(s.body.user.id, student.uid);
      const t = await h.exchange(teacher);
      assert.equal(t.body.user.role, "admin");
      assert.equal(
        (await h.call("/api/login", null, { id: "x", password: "y" })).body
          .error,
        "LOCAL_AUTH_DISABLED",
      );
      assert.equal(
        (
          await h.call("/api/register", null, {
            name: "x",
            role: "dev",
            password: "0123456789",
          })
        ).body.error,
        "LOCAL_AUTH_DISABLED",
      );
      const doc = await h.gateway.db.collection("users").doc(student.uid).get();
      assert.equal(doc.data().role, "student");
      assert.equal(doc.data().passwordHash, undefined);
    } finally {
      await h.close();
    }
  },
);

test(
  "role elevation is dev-only and persisted; students cannot reach teacher/dev operations",
  { skip },
  async () => {
    const { h, teacher, student, other } = await world();
    try {
      const sTok = await login(h, student);
      const oTok = await login(h, other);
      const tTok = await login(h, teacher);
      assert.equal(
        (await h.call(`/api/people/${other.uid}/role`, sTok, { role: "admin" }))
          .status,
        403,
      );
      assert.equal(
        (await h.call(`/api/people/${other.uid}/role`, tTok, { role: "admin" }))
          .status,
        403,
      );
      assert.equal(
        (
          await h.call("/api/sessions", sTok, {
            scheduleId: "sched-t",
            sessionType: "demo",
          })
        ).status,
        403,
      );
      assert.equal((await h.call("/api/people", sTok)).status, 403);
      assert.equal((await h.call("/api/dev/reset", sTok, {})).status, 403);
      // a dev (server-provisioned) can promote a student to teacher; it is persisted
      await h.gateway.db
        .collection("users")
        .doc(teacher.uid)
        .update({ role: "dev" });
      await h.close();
      const h2 = await boot();
      try {
        const devTok = (await h2.exchange(teacher)).body.token;
        assert.equal((await h2.call("/api/dev/reset", devTok, {})).status, 400); // disabled in connected mode
        await h2.exchange(other);
        const up = await h2.call(`/api/people/${other.uid}/role`, devTok, {
          role: "admin",
        });
        assert.equal(up.status, 200);
        assert.equal(
          (await h2.gateway.db.collection("users").doc(other.uid).get()).data()
            .role,
          "admin",
        );
        assert.equal(
          (
            await h2.call(`/api/people/${other.uid}/role`, devTok, {
              role: "dev",
            })
          ).status,
          400,
        );
      } finally {
        await h2.close();
      }
    } finally {
      try {
        await h.close();
      } catch {}
    }
  },
);

test(
  "approval persists attempt + one attendance record atomically; duplicates return the existing result; no photos stored",
  { skip },
  async () => {
    const { h, teacher, student } = await world();
    try {
      const tTok = await login(h, teacher),
        sTok = await login(h, student);
      const { attemptId, sessionId } = await submitOne(h, tTok, sTok);
      const first = await h.call(`/api/attempts/${attemptId}/review`, tTok, {
        decision: "approve",
      });
      const second = await h.call(`/api/attempts/${attemptId}/review`, tTok, {
        decision: "approve",
      });
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(first.body.decision, "VERIFIED");
      assert.equal(first.body.phase, "COMPLETED");
      const att = await h.gateway.db.collection("attendance").get();
      assert.equal(att.size, 1);
      assert.equal(att.docs[0].id, `${sessionId}_${student.uid}`);
      const stored = (
        await h.gateway.db.collection("attempts").doc(attemptId).get()
      ).data();
      assert.equal(stored.decision, "VERIFIED");
      assert.equal(stored.phase, "COMPLETED");
      for (const col of [
        "users",
        "attempts",
        "attendance",
        "sessions",
        "classrooms",
        "schedules",
      ]) {
        const all = JSON.stringify(
          (await h.gateway.db.collection(col).get()).docs.map((d) => d.data()),
        );
        assert.ok(
          !all.includes("data:image"),
          `${col} must not contain photos`,
        );
      }
    } finally {
      await h.close();
    }
  },
);

test(
  "persistence failure is retryable, keeps reviewable evidence and never leaves a false VERIFIED",
  { skip },
  async () => {
    let failNext = false;
    const { h, teacher, student } = await world({
      wrapRepo: (repo) => {
        const real = repo.commit.bind(repo);
        repo.commit = async (c) => {
          if (failNext) {
            failNext = false;
            const { PersistenceError } =
              await import("../../server/firebase/repository.js");
            throw new PersistenceError(new Error("simulated outage"));
          }
          return real(c);
        };
      },
    });
    try {
      const tTok = await login(h, teacher),
        sTok = await login(h, student);
      const { attemptId } = await submitOne(h, tTok, sTok);
      failNext = true;
      const bad = await h.call(`/api/attempts/${attemptId}/review`, tTok, {
        decision: "approve",
      });
      assert.equal(bad.status, 503);
      assert.equal(bad.body.retryable, true);
      const cached = h.store.attempts.find((a) => a.id === attemptId);
      assert.equal(cached.phase, "AWAITING_REVIEW");
      assert.notEqual(cached.decision, "VERIFIED");
      assert.ok(h.store.reviewPhotos.has(attemptId));
      assert.equal(h.store.attendance.length, 0);
      assert.equal((await h.gateway.db.collection("attendance").get()).size, 0);
      const ok = await h.call(`/api/attempts/${attemptId}/review`, tTok, {
        decision: "approve",
      });
      assert.equal(ok.status, 200);
      assert.equal((await h.gateway.db.collection("attendance").get()).size, 1);
    } finally {
      await h.close();
    }
  },
);

test(
  "restart loses evidence photos, so pending reviews require recapture; attendance survives",
  { skip },
  async () => {
    const { h, teacher, student } = await world();
    let h2;
    try {
      const tTok = await login(h, teacher),
        sTok = await login(h, student);
      const { attemptId } = await submitOne(h, tTok, sTok);
      await h.close();
      h2 = await boot();
      const a = h2.store.attempts.find((x) => x.id === attemptId);
      assert.equal(a.phase, "RETRY");
      assert.deepEqual(a.reasons, ["REVIEW_EVIDENCE_LOST_RECAPTURE"]);
      const stored = (
        await h2.gateway.db.collection("attempts").doc(attemptId).get()
      ).data();
      assert.equal(stored.phase, "RETRY");
    } finally {
      try {
        await h2?.close();
      } catch {}
    }
  },
);

test(
  "ownership and enrollment are enforced; other students cannot touch attempts",
  { skip },
  async () => {
    const { h, teacher, student, other } = await world();
    try {
      const tTok = await login(h, teacher),
        sTok = await login(h, student),
        oTok = await login(h, other);
      const started = await h.call("/api/sessions", tTok, {
        scheduleId: "sched-t",
        sessionType: "demo",
      });
      const state = await h.call("/api/state", tTok);
      const challengeId = state.body.sessions.at(-1).challenge.id;
      assert.notEqual(
        (await h.call("/api/claim", oTok, { challengeId })).status,
        200,
      ); // not enrolled
      const claim = await h.call("/api/claim", sTok, { challengeId });
      assert.notEqual(
        (
          await h.call(`/api/attempts/${claim.body.id}/submit`, oTok, {
            photo,
            location: { lat: 0, lng: 0, accuracy: 5 },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await h.call(`/api/attempts/${claim.body.id}/review`, sTok, {
            decision: "approve",
          })
        ).status,
        403,
      );
      assert.equal(
        (await h.call(`/api/sessions/${started.body.id}/stop`, oTok, {}))
          .status,
        403,
      );
    } finally {
      await h.close();
    }
  },
);

test(
  "server session is capped at 8h from original Firebase sign-in and logout revokes it",
  { skip },
  async () => {
    const { h, student } = await world();
    let late;
    try {
      const s = await h.exchange(student);
      assert.equal(s.status, 200);
      const expires = s.body.expiresAt;
      assert.ok(Math.abs(expires - (Date.now() + 8 * 3600e3)) < 15000);
      const again = await h.exchange(student); // exchanging again must not extend the limit
      assert.equal(again.body.expiresAt, expires);
      assert.equal((await h.call("/api/state", s.body.token)).status, 200);
      assert.equal((await h.call("/api/logout", s.body.token, {})).status, 200);
      assert.equal((await h.call("/api/state", s.body.token)).status, 401);
      late = await boot({ offsetMs: 9 * 3600e3 });
      assert.equal(
        (await late.exchange(student)).body.error,
        "SESSION_EXPIRED",
      );
    } finally {
      await h.close();
      await late?.close();
    }
  },
);

test(
  "deny-all Firestore rules block browser SDK access, signed in or not",
  { skip },
  async () => {
    const { initializeApp, deleteApp } = await import("firebase/app");
    const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } =
      await import("firebase/auth");
    const {
      getFirestore,
      connectFirestoreEmulator,
      doc,
      getDoc,
      setDoc,
      terminate,
    } = await import("firebase/firestore");
    await clearEmulators();
    const u = await signUp("browser");
    const app = initializeApp(
      { projectId: PROJECT, apiKey: "fake" },
      "rules-test",
    );
    const [fh, fp] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
    const db = getFirestore(app);
    connectFirestoreEmulator(db, fh, Number(fp));
    const auth = getAuth(app);
    connectAuthEmulator(
      auth,
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,
      { disableWarnings: true },
    );
    await assert.rejects(getDoc(doc(db, "users", u.uid)), /permission/i);
    await signInWithEmailAndPassword(auth, u.email, "correct-horse-battery");
    await assert.rejects(getDoc(doc(db, "users", u.uid)), /permission/i);
    await assert.rejects(
      setDoc(doc(db, "users", u.uid), { role: "dev" }),
      /permission/i,
    );
    await assert.rejects(
      setDoc(doc(db, "attendance", "x_y"), { uid: u.uid }),
      /permission/i,
    );
    await terminate(db);
    await deleteApp(app);
  },
);

test(
  "room presence is created atomically with approval; checkout persists, survives restart and is never reactivated",
  { skip },
  async () => {
    const { h, teacher, student } = await world();
    let h2;
    try {
      const tTok = await login(h, teacher),
        sTok = await login(h, student);
      const { attemptId, sessionId } = await submitOne(h, tTok, sTok);
      const col = h.gateway.db.collection("roomPresences");
      assert.equal(
        (await col.get()).size,
        0,
        "awaiting review is not presence",
      );
      await h.call(`/api/attempts/${attemptId}/review`, tTok, {
        decision: "approve",
      });
      const docs = await col.get();
      assert.equal(docs.size, 1);
      const presenceId = `${sessionId}_${student.uid}`;
      assert.equal(docs.docs[0].id, presenceId);
      assert.equal(docs.docs[0].data().checkedOutAt, null);
      for (const k of Object.keys(docs.docs[0].data()))
        assert.ok(!/lat|lng|location|photo/i.test(k), `no ${k} stored`);
      const own = await h.call("/api/state", sTok);
      assert.equal(own.body.myPresence[0].active, true);
      assert.equal(
        (await h.call("/api/state", tTok)).body.occupancy.find(
          (o) => o.roomId === "room-1",
        ).estimated,
        1,
      );
      assert.notEqual(
        (await h.call(`/api/presence/${presenceId}/checkout`, tTok, {})).status,
        200,
      );
      assert.equal(
        (await h.call(`/api/presence/${presenceId}/checkout`, sTok, {})).status,
        200,
      );
      assert.equal(
        (await h.call(`/api/presence/${presenceId}/checkout`, sTok, {})).status,
        200,
      );
      await h.call(`/api/attempts/${attemptId}/review`, tTok, {
        decision: "approve",
      }); // duplicate
      const after = (await col.doc(presenceId).get()).data();
      assert.ok(after.checkedOutAt > 0);
      assert.equal((await h.gateway.db.collection("attendance").get()).size, 1);
      await h.close();
      h2 = await boot();
      assert.ok(h2.store.roomPresences[0].checkedOutAt > 0);
      assert.equal(
        h2.store
          .occupancyFor(h2.store.getUser(teacher.uid))
          .find((o) => o.roomId === "room-1")?.estimated || 0,
        0,
      );
    } finally {
      try {
        await h2?.close();
      } catch {}
      try {
        await h.close();
      } catch {}
    }
  },
);

test(
  "replacement chain: either approval order, even concurrent, yields one attendance and one presence",
  { skip },
  async () => {
    const { signPresence } = await import("../../server/presence.js");
    for (const mode of ["sequential", "concurrent"]) {
      const { h, teacher, student } = await world();
      try {
        const tTok = await login(h, teacher),
          sTok = await login(h, student);
        const started = await h.call("/api/sessions", tTok, {
          scheduleId: "sched-t",
          sessionType: "demo",
          presenceMode: "local",
        });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        const room = started.body.room;
        const ev = {
          photo,
          location: { lat: room.lat, lng: room.lng, accuracy: 5 },
        };
        let state = await h.call("/api/state", tTok);
        const claim1 = await h.call("/api/claim", sTok, {
          challengeId: state.body.sessions.at(-1).challenge.id,
        });
        const req = await h.call(
          `/api/attempts/${claim1.body.id}/presence-request`,
          sTok,
          {},
        );
        const payload = req.body.requestCode.split(".").slice(0, 4).join(".");
        const proof =
          payload + "." + signPresence("proof", payload, "a".repeat(64));
        assert.equal(
          (
            await h.call(`/api/attempts/${claim1.body.id}/submit`, sTok, {
              ...ev,
              presenceProof: proof,
            })
          ).status,
          200,
        );
        const repl = await h.call(
          `/api/sessions/${started.body.id}/replace-without-esp32`,
          tTok,
          {},
        );
        assert.equal(repl.status, 200, JSON.stringify(repl.body));
        assert.equal(repl.body.attendanceEventId, started.body.id);
        state = await h.call("/api/state", tTok);
        const claim2 = await h.call("/api/claim", sTok, {
          challengeId: state.body.sessions.at(-1).challenge.id,
        });
        assert.equal(
          (await h.call(`/api/attempts/${claim2.body.id}/submit`, sTok, ev))
            .status,
          200,
        );
        const approve = (id) =>
          h.call(`/api/attempts/${id}/review`, tTok, { decision: "approve" });
        if (mode === "sequential") {
          await approve(claim2.body.id);
          await approve(claim1.body.id);
        } else
          await Promise.all([approve(claim1.body.id), approve(claim2.body.id)]);
        const att = await h.gateway.db.collection("attendance").get();
        assert.equal(att.size, 1, mode);
        assert.equal(att.docs[0].id, `${started.body.id}_${student.uid}`);
        assert.equal(
          (await h.gateway.db.collection("roomPresences").get()).size,
          1,
          mode,
        );
      } finally {
        await h.close();
      }
    }
  },
);

test(
  "failed commit never creates presence or attendance",
  { skip },
  async () => {
    let failNext = false;
    const { h, teacher, student } = await world({
      wrapRepo: (repo) => {
        const real = repo.commit.bind(repo);
        repo.commit = async (c) => {
          if (failNext) {
            failNext = false;
            const { PersistenceError } =
              await import("../../server/firebase/repository.js");
            throw new PersistenceError(new Error("down"));
          }
          return real(c);
        };
      },
    });
    try {
      const tTok = await login(h, teacher),
        sTok = await login(h, student);
      const { attemptId } = await submitOne(h, tTok, sTok);
      failNext = true;
      assert.equal(
        (
          await h.call(`/api/attempts/${attemptId}/review`, tTok, {
            decision: "approve",
          })
        ).status,
        503,
      );
      assert.equal(h.store.roomPresences.length, 0);
      assert.equal(
        (await h.gateway.db.collection("roomPresences").get()).size,
        0,
      );
      assert.equal(
        (await h.call("/api/state", tTok)).body.occupancy.find(
          (o) => o.roomId === "room-1",
        )?.estimated || 0,
        0,
      );
    } finally {
      await h.close();
    }
  },
);

// ---- Regression: FirestoreRepository.commit "create" must never overwrite ----
async function repoFixture() {
  const { createFirebaseGateway } =
    await import("../../server/firebase/admin.js");
  const { FirestoreRepository } =
    await import("../../server/firebase/repository.js");
  await clearEmulators();
  const gateway = createFirebaseGateway({ projectId: PROJECT, emulator: true });
  return { gateway, repo: new FirestoreRepository(gateway.db), db: gateway.db };
}

test(
  "repository: creating existing attendance does not overwrite it",
  { skip },
  async () => {
    const { gateway, repo, db } = await repoFixture();
    try {
      await db
        .collection("attendance")
        .doc("e1_u1")
        .set({ uid: "u1", verifiedAt: 111, reviewedBy: "first" });
      const res = await repo.commit([
        {
          op: "create",
          col: "attendance",
          id: "e1_u1",
          data: { uid: "u1", verifiedAt: 999, reviewedBy: "second" },
        },
        {
          op: "create",
          col: "attendance",
          id: "e1_u2",
          data: { uid: "u2", verifiedAt: 5 },
        },
      ]);
      const kept = (
        await db.collection("attendance").doc("e1_u1").get()
      ).data();
      assert.equal(kept.verifiedAt, 111);
      assert.equal(kept.reviewedBy, "first");
      assert.equal(
        (await db.collection("attendance").doc("e1_u2").get()).data()
          .verifiedAt,
        5,
        "new doc is created",
      );
      assert.deepEqual(
        res.retained.map((r) => r.id),
        ["e1_u1"],
      );
      assert.equal(res.retained[0].data.verifiedAt, 111);
    } finally {
      await gateway.close();
    }
  },
);

test(
  "repository: creating existing checked-out presence preserves checkedOutAt; authorized checkout still persists",
  { skip },
  async () => {
    const { gateway, repo, db } = await repoFixture();
    try {
      await db
        .collection("roomPresences")
        .doc("e1_u1")
        .set({ uid: "u1", checkedInAt: 1, expiresAt: 9e12, checkedOutAt: 777 });
      await repo.commit([
        {
          op: "create",
          col: "roomPresences",
          id: "e1_u1",
          data: {
            uid: "u1",
            checkedInAt: 2,
            expiresAt: 9e12,
            checkedOutAt: null,
          },
        },
      ]);
      assert.equal(
        (await db.collection("roomPresences").doc("e1_u1").get()).data()
          .checkedOutAt,
        777,
      );
      // a fresh presence, then an authorised checkout update (op "set")
      await repo.commit([
        {
          op: "create",
          col: "roomPresences",
          id: "e1_u2",
          data: {
            uid: "u2",
            checkedInAt: 1,
            expiresAt: 9e12,
            checkedOutAt: null,
          },
        },
      ]);
      assert.equal(
        (await db.collection("roomPresences").doc("e1_u2").get()).data()
          .checkedOutAt,
        null,
      );
      await repo.commit([
        {
          op: "set",
          col: "roomPresences",
          id: "e1_u2",
          data: {
            uid: "u2",
            checkedInAt: 1,
            expiresAt: 9e12,
            checkedOutAt: 888,
          },
        },
      ]);
      assert.equal(
        (await db.collection("roomPresences").doc("e1_u2").get()).data()
          .checkedOutAt,
        888,
      );
    } finally {
      await gateway.close();
    }
  },
);

test(
  "persistence cache adopts the durable record when a create finds one already stored",
  { skip },
  async () => {
    const { gateway, repo, db } = await repoFixture();
    try {
      const { DemoStore } = await import("../../server/store.js");
      const { createPersistence } =
        await import("../../server/firebase/persistence.js");
      const store = new DemoStore(() => Date.now(), { empty: true });
      const { mutate } = await createPersistence({ store, repo });
      // another writer stores the presence (already checked out) after our cache loaded
      await db.collection("roomPresences").doc("e1_u1").set({
        uid: "u1",
        sessionId: "s",
        roomId: "room-1",
        eventId: "e1",
        checkedInAt: 1,
        expiresAt: 9e12,
        checkedOutAt: 777,
      });
      await mutate(() => {
        store.roomPresences.push({
          id: "e1_u1",
          uid: "u1",
          sessionId: "s",
          roomId: "room-1",
          eventId: "e1",
          checkedInAt: 2,
          expiresAt: 9e12,
          checkedOutAt: null,
        });
      });
      assert.equal(
        (await db.collection("roomPresences").doc("e1_u1").get()).data()
          .checkedOutAt,
        777,
      );
      assert.equal(
        store.roomPresences.find((r) => r.id === "e1_u1").checkedOutAt,
        777,
        "cache follows Firestore",
      );
      assert.equal(
        store
          .occupancyFor({ role: "dev", id: "d" })
          .every((o) => o.estimated === 0),
        true,
        "checked-out presence is not counted",
      );
    } finally {
      await gateway.close();
    }
  },
);
