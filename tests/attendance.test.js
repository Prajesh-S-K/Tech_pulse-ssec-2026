import test from "node:test";
import assert from "node:assert/strict";
import { DemoStore } from "../server/store.js";
import { evaluate } from "../src/domain/trust.js";
import { createApp } from "../server/app.js";
import {
  BrowserPresenceProvider,
  HardwarePresenceProvider,
  SimulatedPresenceProvider,
  presenceProvider,
} from "../src/providers/browser.js";
function fixture() {
  let now = 1000000;
  const store = new DemoStore(() => now, { testMode: true });
  const session = store.start();
  const challenge = session.challenges[0].id;
  const evidence = {
    location: { lat: session.room.lat, lng: session.room.lng, accuracy: 5 },
    photo: true,
    simulated: true,
  };
  return { store, session, challenge, evidence, advance: (n) => (now += n) };
}
test("genuine evidence passes with reduced evidence label", () => {
  const f = fixture();
  assert.equal(
    evaluate(f.evidence, f.session.room, "baseline").decision,
    "VERIFIED",
  );
});
test("outside geofence is rejected, uncertain accuracy and boundary are retryable", () => {
  const f = fixture();
  const e = structuredClone(f.evidence);
  e.location.lat += 0.01;
  assert.equal(evaluate(e, f.session.room, "baseline").decision, "REJECTED");
  e.location.accuracy = 200;
  assert.equal(evaluate(e, f.session.room, "baseline").phase, "RETRY");
  e.location = {
    lat: f.session.room.lat + 0.00065,
    lng: f.session.room.lng,
    accuracy: 20,
  };
  assert.equal(evaluate(e, f.session.room, "baseline").phase, "RETRY");
});
test("malformed coordinates cannot pass", () => {
  const f = fixture();
  for (const location of [
    null,
    { lat: NaN, lng: 80, accuracy: 1 },
    { lat: 200, lng: 80, accuracy: 1 },
    { lat: 13, lng: 80, accuracy: -1 },
  ])
    assert.equal(
      evaluate({ ...f.evidence, location }, f.session.room, "baseline")
        .decision,
      null,
    );
});
test("missing photo and missing local provider are not cheating", () => {
  const f = fixture();
  assert.equal(
    evaluate({ ...f.evidence, photo: false }, f.session.room, "baseline").phase,
    "RETRY",
  );
  assert.equal(evaluate(f.evidence, f.session.room, "local").phase, "RETRY");
  assert.equal(
    evaluate({ ...f.evidence, localProof: "invalid" }, f.session.room, "local")
      .decision,
    "SUSPICIOUS",
  );
});
test("expiry blocks new claims but not previously claimed attempts", () => {
  const f = fixture();
  const a = f.store.claim("student-1", f.challenge);
  f.advance(61000);
  assert.throws(() => f.store.claim("student-2", f.challenge), /EXPIRED/);
  assert.equal(
    f.store.submit("student-1", a.id, f.evidence).decision,
    "VERIFIED",
  );
});
test("closing session preserves existing completion windows", () => {
  const f = fixture();
  const a = f.store.claim("student-1", f.challenge);
  f.store.stop(f.session.id);
  assert.throws(() => f.store.claim("student-2", f.challenge), /CLOSED/);
  assert.equal(
    f.store.submit("student-1", a.id, f.evidence).decision,
    "VERIFIED",
  );
});
test("six independent students, repeated claims and submissions remain unique", async () => {
  const f = fixture();
  const attempts = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      Promise.resolve(f.store.claim(`student-${i + 1}`, f.challenge)),
    ),
  );
  assert.equal(new Set(attempts.map((a) => a.id)).size, 6);
  for (const a of attempts) {
    const deadline = a.deadline;
    f.advance(1);
    assert.equal(f.store.claim(a.uid, f.challenge).deadline, deadline);
    f.store.submit(a.uid, a.id, f.evidence);
    f.store.submit(a.uid, a.id, f.evidence);
  }
  assert.equal(
    f.store.attempts.filter((a) => a.decision === "VERIFIED").length,
    6,
  );
});
test("late upload remains pending review, not suspicious or backdated", () => {
  const f = fixture();
  const a = f.store.claim("student-1", f.challenge);
  f.advance(105001);
  assert.equal(
    f.store.submit("student-1", a.id, { ...f.evidence, claimedAt: 1 }).phase,
    "PENDING_REVIEW",
  );
  assert.equal(a.decision, null);
});
test("wrong class and cross-student submit are blocked", () => {
  const f = fixture();
  assert.throws(
    () => f.store.claim("student-1", f.challenge, "WRONG"),
    /SCHEDULE/,
  );
  const a = f.store.claim("student-1", f.challenge);
  assert.throws(
    () => f.store.submit("student-2", a.id, f.evidence),
    /NOT_FOUND/,
  );
});
test("recoverable GPS failure can be retried within original deadline", () => {
  const f = fixture();
  const a = f.store.claim("student-1", f.challenge);
  f.store.submit(a.uid, a.id, { ...f.evidence, location: null });
  assert.equal(a.phase, "RETRY");
  assert.equal(f.store.submit(a.uid, a.id, f.evidence).decision, "VERIFIED");
});
test("realistic indoor/Wi-Fi accuracy (65m) in same room verifies successfully", () => {
  const f = fixture();
  // Simulated laptop/mobile Wi-Fi: 9m away from classroom center, 65m accuracy, 75m radius
  const wifiEvidence = {
    location: {
      lat: f.session.room.lat + 0.00008,
      lng: f.session.room.lng,
      accuracy: 65,
    },
    photo: true,
    simulated: false,
  };
  const res = evaluate(wifiEvidence, f.session.room, "baseline");
  assert.equal(res.decision, "VERIFIED");
  assert.equal(res.phase, "COMPLETED");
  assert.ok(res.distance < 15);
});
test("student initially outside or boundary-uncertain can re-submit and verify within deadline", () => {
  const f = fixture();
  const a = f.store.claim("student-1", f.challenge);

  // First submission: student is 500m away (outside geofence)
  const outsideEvidence = {
    location: {
      lat: f.session.room.lat + 0.005,
      lng: f.session.room.lng,
      accuracy: 15,
    },
    photo: true,
  };
  const sub1 = f.store.submit(a.uid, a.id, outsideEvidence);
  assert.equal(sub1.decision, "REJECTED");
  assert.deepEqual(sub1.reasons, ["OUTSIDE_GEOFENCE"]);

  // Student walks into classroom within their 90-second deadline
  f.advance(15000);
  const insideEvidence = {
    location: {
      lat: f.session.room.lat,
      lng: f.session.room.lng,
      accuracy: 25,
    },
    photo: true,
  };
  const sub2 = f.store.submit(a.uid, a.id, insideEvidence);
  assert.equal(sub2.decision, "VERIFIED");
  assert.equal(sub2.phase, "COMPLETED");

  // Subsequent duplicate submit is idempotent
  const sub3 = f.store.submit(a.uid, a.id, outsideEvidence);
  assert.equal(sub3.decision, "VERIFIED");
});
test("HTTP rejects student admin actions, hides other attempts, ignores client verdict", async (t) => {
  const f = fixture();
  const server = createApp(f.store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function req(path, token, body) {
    return fetch(base + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body
        ? JSON.stringify({ password: "fixture-password-only", ...body })
        : undefined,
    });
  }
  const login = await (await req("/login", null, { id: "student-1" })).json();
  assert.equal((await req("/sessions", login.token, {})).status, 403);
  assert.equal((await req("/state")).status, 401);
  const a = await (
    await req("/claim", login.token, { challengeId: f.challenge })
  ).json();
  const outcome = await (
    await req(`/attempts/${a.id}/submit`, login.token, { decision: "VERIFIED" })
  ).json();
  assert.equal(outcome.decision, null);
  f.store.claim("student-2", f.challenge);
  const state = await (await req("/state", login.token)).json();
  assert.equal(state.attempts.length, 1);
  assert.equal(state.sessions[0].challenge, undefined);
});
test("user registration, face profile photo update, and directory snapshot", () => {
  const f = fixture();
  const newStudent = f.store.createUser({
    name: "Vikram Raman",
    email: "vikram@ssec.edu",
    role: "student",
    roll: "ECE099",
    dept: "ECE",
  });
  assert.equal(newStudent.name, "Vikram Raman");
  assert.equal(newStudent.roll, "ECE099");
  assert.equal(newStudent.referencePhoto, null);

  const samplePhoto = "data:image/jpeg;base64,sampleFaceData";
  f.store.updateProfilePhoto(newStudent.id, samplePhoto);
  const updated = f.store.getUser(newStudent.id);
  assert.equal(updated.referencePhoto, samplePhoto);

  const adminSnapshot = f.store.snapshot(f.store.getUser("teacher"));
  assert.ok(adminSnapshot.people.some((p) => p.id === newStudent.id));
});
test("classroom creation, schedule assignment, and course-linked attendance recording", () => {
  const f = fixture();
  const newRoom = f.store.createClassroom({
    name: "VLSI Design Center",
    capacity: 35,
    lat: 13.085,
    lng: 80.275,
    radius: 100,
    maxAccuracy: 100,
  });
  assert.equal(newRoom.name, "VLSI Design Center");

  const newSchedule = f.store.createSchedule({
    classId: "ECE-501",
    subject: "VLSI Circuit Design",
    classroomId: newRoom.id,
    teacherId: "teacher",
    time: "10:00 - 11:30",
    days: "Tue, Fri",
    enrollmentIds: ["student-1", "student-2"],
  });
  assert.equal(newSchedule.subject, "VLSI Circuit Design");

  const sess = f.store.start({ scheduleId: newSchedule.id });
  assert.equal(sess.subject, "VLSI Circuit Design");
  assert.equal(sess.classId, "ECE-501");
  assert.equal(sess.room.name, "VLSI Design Center");
  assert.equal(sess.room.radius, 100);

  const challengeId = sess.challenges[0].id;
  const a = f.store.claim("student-1", challengeId, "ECE-501");
  const sub = f.store.submit("student-1", a.id, {
    location: { lat: 13.085, lng: 80.275, accuracy: 15 },
    photo: true,
  });
  assert.equal(sub.decision, "VERIFIED");

  const attendanceRec = f.store.attendance.find(
    (r) => r.scheduleId === newSchedule.id && r.uid === "student-1",
  );
  assert.ok(attendanceRec);
  assert.equal(attendanceRec.subject, "VLSI Circuit Design");
  assert.equal(attendanceRec.studentName, "Aarav");
});

test("classroom CRUD and schedule editing / deletion", () => {
  const f = fixture();
  // Classroom CRUD
  const room = f.store.createClassroom({
    name: "Temporary Seminar Hall",
    capacity: 100,
    lat: 13.084,
    lng: 80.272,
    radius: 100,
    maxAccuracy: 100,
  });
  assert.equal(room.name, "Temporary Seminar Hall");

  const updatedRoom = f.store.updateClassroom(room.id, {
    name: "Main Campus Auditorium",
    radius: 150,
  });
  assert.equal(updatedRoom.name, "Main Campus Auditorium");
  assert.equal(updatedRoom.radius, 150);

  // Schedule CRUD
  const sched = f.store.createSchedule({
    classId: "ECE-601",
    subject: "Advanced Robotics",
    classroomId: room.id,
    time: "15:00 - 16:30",
    days: "Mon, Wed",
  });
  assert.equal(sched.subject, "Advanced Robotics");

  const updatedSched = f.store.updateSchedule(sched.id, {
    subject: "Autonomous Mobile Robotics",
    time: "15:30 - 17:00",
  });
  assert.equal(updatedSched.subject, "Autonomous Mobile Robotics");
  assert.equal(updatedSched.time, "15:30 - 17:00");

  f.store.deleteSchedule(sched.id);
  assert.ok(!f.store.schedules.some((s) => s.id === sched.id));

  f.store.deleteClassroom(room.id);
  assert.ok(!f.store.classrooms.some((c) => c.id === room.id));
});

test("professor on-the-fly session venue relocation updates geofence dynamically", () => {
  const f = fixture();
  // Start session at default room (13.0827, 80.2707, radius 75)
  const sess = f.store.start();
  assert.equal(sess.room.radius, 75);

  // Professor relocates the class to an outdoor campus ground (13.0890, 80.2790, radius 200)
  const relocated = f.store.updateSessionVenue(sess.id, {
    name: "Outdoor Quadrangle",
    lat: 13.089,
    lng: 80.279,
    radius: 200,
    maxAccuracy: 150,
  });
  assert.equal(relocated.room.name, "Outdoor Quadrangle");
  assert.equal(relocated.room.radius, 200);

  // Student claims and submits with coordinates at the new outdoor location
  const challengeId = sess.challenges[0].id;
  const a = f.store.claim("student-2", challengeId, sess.classId);
  const sub = f.store.submit("student-2", a.id, {
    location: { lat: 13.089, lng: 80.279, accuracy: 25 },
    photo: true,
  });
  assert.equal(sub.decision, "VERIFIED");
  assert.ok(sub.distance <= 10);
});

test("developer account, audit logs, and system telemetry stats", async (t) => {
  const f = fixture();
  const devUser = f.store.getUser("dev");
  assert.ok(devUser);
  assert.equal(devUser.role, "dev");

  // Perform an action that generates audit logs
  f.store.start();
  const devSnapshot = f.store.snapshot(devUser);
  assert.ok(Array.isArray(devSnapshot.logs));
  assert.ok(devSnapshot.logs.length > 0);
  assert.ok(devSnapshot.stats);
  assert.equal(devSnapshot.stats.totalSessions, 2);
  assert.equal(devSnapshot.stats.activeSessions, 1);

  // Test dev HTTP endpoints
  const server = createApp(f.store).listen(0);
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const loginRes = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "fixture-password-only", id: "dev" }),
  });
  const devLogin = await loginRes.json();
  assert.ok(devLogin.token);

  const logsRes = await (
    await fetch(`${base}/api/dev/logs`, {
      headers: { Authorization: `Bearer ${devLogin.token}` },
    })
  ).json();
  assert.ok(Array.isArray(logsRes));
  assert.ok(logsRes.length > 0);

  const statsRes = await (
    await fetch(`${base}/api/dev/stats`, {
      headers: { Authorization: `Bearer ${devLogin.token}` },
    })
  ).json();
  assert.ok(statsRes.totalStudents >= 6);
  assert.ok(statsRes.totalClassrooms >= 3);
});

test("only teacher and dev can create locations; students are forbidden", async (t) => {
  const f = fixture();
  const student = f.store.getUser("student-1");
  const teacher = f.store.getUser("teacher");
  const dev = f.store.getUser("dev");

  // Direct store tests
  assert.throws(
    () =>
      f.store.createClassroom(
        { name: "Unauthorized Room", lat: 13.08, lng: 80.27, radius: 75 },
        student,
      ),
    /TEACHER_OR_DEV_ONLY/,
  );

  const teacherRoom = f.store.createClassroom(
    { name: "Teacher Lab", lat: 13.08, lng: 80.27, radius: 75 },
    teacher,
  );
  assert.ok(teacherRoom.id);

  const devRoom = f.store.createClassroom(
    { name: "Dev Workshop", lat: 13.08, lng: 80.27, radius: 75 },
    dev,
  );
  assert.ok(devRoom.id);

  // HTTP endpoint tests
  const server = createApp(f.store).listen(0);
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const studentLogin = await (
    await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "fixture-password-only",
        id: "student-1",
      }),
    })
  ).json();

  const studentCreateRes = await fetch(`${base}/api/classrooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${studentLogin.token}`,
    },
    body: JSON.stringify({
      name: "Student Room",
      lat: 13.08,
      lng: 80.27,
      radius: 75,
    }),
  });
  assert.equal(studentCreateRes.status, 403);
  const err = await studentCreateRes.json();
  assert.equal(err.error, "ADMIN_REQUIRED");
});

test("course creation by all roles and teacher permission enforcement for deletion", async (t) => {
  const f = fixture();
  const student = f.store.getUser("student-1");
  const teacher = f.store.getUser("teacher");
  const dev = f.store.getUser("dev");

  // 1. Student creates a course assigned to Teacher
  const sched1 = f.store.createSchedule(
    {
      subject: "Quantum Computing",
      classId: "ECE-701",
      teacherId: "teacher",
      time: "10:00 - 11:30",
      days: "Tue, Thu",
    },
    student,
  );
  assert.equal(sched1.subject, "Quantum Computing");
  assert.equal(sched1.teacherId, "teacher");
  assert.equal(sched1.createdBy, "student-1");

  // 2. Student attempts to delete it without teacher permission -> throws TEACHER_PERMISSION_REQUIRED
  assert.throws(
    () => f.store.deleteSchedule(sched1.id, student),
    /TEACHER_PERMISSION_REQUIRED/,
  );

  // 3. Student attempts to update it without teacher permission -> throws TEACHER_PERMISSION_REQUIRED
  assert.throws(
    () => f.store.updateSchedule(sched1.id, { subject: "Hacked" }, student),
    /TEACHER_PERMISSION_REQUIRED/,
  );

  // 4. Assigned teacher CAN update and delete it
  const updated = f.store.updateSchedule(
    sched1.id,
    { subject: "Quantum Computing Lab" },
    teacher,
  );
  assert.equal(updated.subject, "Quantum Computing Lab");

  f.store.deleteSchedule(sched1.id, teacher);
  assert.ok(!f.store.schedules.some((s) => s.id === sched1.id));

  // 5. Course created by teacher automatically sets teacherId = teacher.id
  const sched2 = f.store.createSchedule(
    {
      subject: "Digital Signal Processing",
      classId: "ECE-305",
      time: "09:00 - 10:30",
      days: "Mon, Wed",
    },
    teacher,
  );
  assert.equal(sched2.teacherId, teacher.id);

  // 6. Dev has superuser permission to delete any course
  f.store.deleteSchedule(sched2.id, dev);
  assert.ok(!f.store.schedules.some((s) => s.id === sched2.id));
});

test("teacher-scoped attendance and attempt isolation: no cross-class mixup", () => {
  const f = fixture();
  // Second teacher
  const teacher2 =
    f.store.getUser("teacher-2") ||
    f.store.createUser({
      id: "teacher-2",
      name: "Prof. Priya",
      role: "admin",
      dept: "ECE",
    });

  // Course 1 assigned to teacher 1
  const sched1 = f.store.createSchedule(
    {
      subject: "VLSI Design",
      classId: "ECE-501",
      teacherId: "teacher",
    },
    f.store.getUser("teacher"),
  );

  // Course 2 assigned to teacher 2
  const sched2 = f.store.createSchedule(
    {
      subject: "Computer Networks",
      classId: "ECE-502",
      teacherId: "teacher-2",
    },
    teacher2,
  );

  // Teacher 1 starts session and Student 1 checks in
  const sess1 = f.store.start(
    { scheduleId: sched1.id },
    f.store.getUser("teacher"),
  );
  const a1 = f.store.claim("student-1", sess1.challenges[0].id, sched1.classId);
  f.store.submit("student-1", a1.id, f.evidence);

  // Teacher 2 starts session and Student 2 checks in
  const sess2 = f.store.start({ scheduleId: sched2.id }, teacher2);
  const a2 = f.store.claim("student-2", sess2.challenges[0].id, sched2.classId);
  f.store.submit("student-2", a2.id, f.evidence);

  // Teacher 1 snapshot: ONLY includes their own courses, sessions, and attempts
  const snap1 = f.store.snapshot(f.store.getUser("teacher"));
  assert.ok(snap1.schedules.some((s) => s.id === sched1.id));
  assert.ok(!snap1.schedules.some((s) => s.id === sched2.id));
  assert.ok(snap1.sessions.some((s) => s.id === sess1.id));
  assert.ok(!snap1.sessions.some((s) => s.id === sess2.id));
  assert.ok(snap1.attempts.some((a) => a.uid === "student-1"));
  assert.ok(!snap1.attempts.some((a) => a.uid === "student-2")); // Zero cross-class mixup!

  // Teacher 2 snapshot: ONLY includes their own courses, sessions, and attempts
  const snap2 = f.store.snapshot(teacher2);
  assert.ok(snap2.schedules.some((s) => s.id === sched2.id));
  assert.ok(!snap2.schedules.some((s) => s.id === sched1.id));
  assert.ok(snap2.sessions.some((s) => s.id === sess2.id));
  assert.ok(!snap2.sessions.some((s) => s.id === sess1.id));
  assert.ok(snap2.attempts.some((a) => a.uid === "student-2"));
  assert.ok(!snap2.attempts.some((a) => a.uid === "student-1"));

  // Student 1 snapshot: only their own attempts and records
  const studentSnap = f.store.snapshot(f.store.getUser("student-1"));
  assert.ok(studentSnap.attempts.some((a) => a.uid === "student-1"));
  assert.ok(!studentSnap.attempts.some((a) => a.uid === "student-2"));
});

test("user profile self-update and credential persistence", async (t) => {
  const f = fixture();
  const server = createApp(f.store).listen(0);
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const studentLogin = await (
    await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "fixture-password-only",
        id: "student-1",
      }),
    })
  ).json();

  // Student updates their profile
  const updateRes = await fetch(`${base}/api/profile`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${studentLogin.token}`,
    },
    body: JSON.stringify({
      name: "Aarav Sharma Updated",
      dept: "ECE Advanced",
      roll: "ECE999",
      email: "aarav.new@ssec.edu",
      referencePhoto: "data:image/png;base64,newphoto",
    }),
  });
  assert.equal(updateRes.status, 200);
  const updatedUser = await updateRes.json();
  assert.equal(updatedUser.name, "Aarav Sharma Updated");
  assert.equal(updatedUser.dept, "ECE Advanced");
  assert.equal(updatedUser.roll, "ECE999");
  assert.equal(updatedUser.email, "aarav.new@ssec.edu");
  assert.equal(updatedUser.referencePhoto, "data:image/png;base64,newphoto");

  // Check persisted in store
  const stored = f.store.getUser("student-1");
  assert.equal(stored.name, "Aarav Sharma Updated");
  assert.equal(stored.email, "aarav.new@ssec.edu");
});

test("students cannot access student directory and directory endpoints are protected", async (t) => {
  const f = fixture();
  const server = createApp(f.store).listen(0);
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  // 1. /api/demo-accounts returns only designated demo personas
  const demoRes = await (await fetch(`${base}/api/demo-accounts`)).json();
  const demoIds = demoRes.map((u) => u.id);
  assert.ok(demoIds.includes("teacher"));
  assert.ok(demoIds.includes("dev"));
  assert.ok(demoIds.includes("student-1"));
  // Does not leak custom registered students or complete roster
  assert.ok(!demoIds.includes("student-3"));
  assert.ok(!demoIds.includes("student-5"));
  assert.ok(!demoIds.includes("student-6"));

  // 2. Direct sign-in using roll number
  const rollLogin = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "fixture-password-only", id: "ECE001" }),
  });
  assert.equal(rollLogin.status, 200);
  const studentAuth = await rollLogin.json();
  assert.equal(studentAuth.user.id, "student-1");

  // 3. /api/people is strictly blocked for students
  const studentPeopleRes = await fetch(`${base}/api/people`, {
    headers: { Authorization: `Bearer ${studentAuth.token}` },
  });
  assert.equal(studentPeopleRes.status, 403);
  const errData = await studentPeopleRes.json();
  assert.equal(errData.error, "ADMIN_REQUIRED");

  // 4. /api/people is accessible to teachers
  const teacherLogin = await (
    await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "fixture-password-only",
        id: "teacher",
      }),
    })
  ).json();
  const teacherPeopleRes = await fetch(`${base}/api/people`, {
    headers: { Authorization: `Bearer ${teacherLogin.token}` },
  });
  assert.equal(teacherPeopleRes.status, 200);
  const people = await teacherPeopleRes.json();
  assert.ok(people.length >= 8);

  // 5. Student snapshot contains NO other students
  const studentSnap = f.store.snapshot(f.store.getUser("student-1"));
  const studentSnapStudents = studentSnap.people.filter(
    (p) => p.role === "student",
  );
  assert.equal(studentSnapStudents.length, 1);
  assert.equal(studentSnapStudents[0].id, "student-1");
});

test("biometrics module decodes images, extracts features, and distinguishes faces", async () => {
  const { default: jpeg } = await import("jpeg-js");
  const { compareFaces, decodeImage, extractFaceFeatures } =
    await import("../server/biometrics.js");

  function makeSyntheticFace(r, g, b, hair, eyeDist) {
    const width = 64,
      height = 64;
    const raw = Buffer.alloc(width * height * 4);
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = 230;
      raw[i + 1] = 230;
      raw[i + 2] = 230;
      raw[i + 3] = 255;
    }
    for (let y = 10; y < 55; y++) {
      for (let x = 12; x < 52; x++) {
        const dx = (x - 32) / 18,
          dy = (y - 32) / 22;
        if (dx * dx + dy * dy <= 1) {
          const idx = (y * width + x) * 4;
          raw[idx] = r;
          raw[idx + 1] = g;
          raw[idx + 2] = b;
        }
      }
    }
    for (let y = 8; y < 20; y++) {
      for (let x = 14; x < 50; x++) {
        const idx = (y * width + x) * 4;
        raw[idx] = hair[0];
        raw[idx + 1] = hair[1];
        raw[idx + 2] = hair[2];
      }
    }
    const eyeY = 28;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const idxL = ((eyeY + dy) * width + (32 - eyeDist + dx)) * 4;
        const idxR = ((eyeY + dy) * width + (32 + eyeDist + dx)) * 4;
        raw[idxL] = 20;
        raw[idxL + 1] = 20;
        raw[idxL + 2] = 20;
        raw[idxR] = 20;
        raw[idxR + 1] = 20;
        raw[idxR + 2] = 20;
      }
    }
    const enc = jpeg.encode({ data: raw, width, height }, 80);
    return "data:image/jpeg;base64," + enc.data.toString("base64");
  }

  const faceA1 = makeSyntheticFace(210, 160, 130, [40, 25, 15], 8);
  const faceA2 = makeSyntheticFace(212, 162, 132, [40, 25, 15], 8);

  // 1. Image decoding
  const decoded = decodeImage(faceA1);
  assert.ok(decoded);
  assert.equal(decoded.width, 64);
  assert.equal(decoded.height, 64);

  // 2. Feature extraction
  const features = extractFaceFeatures(decoded);
  assert.equal(features.normGray.length, 32 * 32);
  assert.equal(features.colorHist.length, 32);
  assert.equal(features.blocks.length, 16);

  // 3. Same face matching
  const matchRes = compareFaces(faceA1, faceA2);
  assert.equal(matchRes.match, true);
  assert.ok(matchRes.confidence >= 90);
  assert.equal(matchRes.status, "FACIAL_MATCH");

  // 4. Simulated mismatch
  const simMismatch = compareFaces(faceA1, faceA1, {
    simulated: true,
    faceMismatch: true,
  });
  assert.equal(simMismatch.match, false);
  assert.equal(simMismatch.status, "FACIAL_MISMATCH");
  assert.equal(simMismatch.confidence, 28);

  // 5. Unenrolled reference
  const unEnrolled = compareFaces(null, faceA1);
  assert.equal(unEnrolled.match, true);
  assert.equal(unEnrolled.status, "NO_REFERENCE_ENROLLED");
});

test("facial recognition check-in: matching enrolled face verifies, and impersonation flags SUSPICIOUS", async () => {
  const f = fixture();
  const { default: jpeg } = await import("jpeg-js");

  function makeFace(r, g, b) {
    const width = 64,
      height = 64;
    const raw = Buffer.alloc(width * height * 4);
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
    const enc = jpeg.encode({ data: raw, width, height }, 80);
    return "data:image/jpeg;base64," + enc.data.toString("base64");
  }

  const enrolledFace = makeFace(200, 150, 120);

  // 1. Enroll reference face on student-1
  f.store.updateProfilePhoto("student-1", enrolledFace);
  assert.equal(f.store.getUser("student-1").referencePhoto, enrolledFace);

  // 2. Matching check-in photo verifies with FACIAL_MATCH
  const a1 = f.store.claim("student-1", f.challenge);
  const verifyRes = f.store.submit("student-1", a1.id, {
    ...f.evidence,
    photo: enrolledFace,
  });
  assert.equal(verifyRes.decision, "VERIFIED");
  assert.equal(verifyRes.facialMatch, true);
  assert.ok(verifyRes.facialConfidence >= 80);
  assert.ok(verifyRes.reasons.includes("FACIAL_MATCH"));

  // Verify attendance record contains facial metrics
  const attRec = f.store.attendance.find(
    (rec) => rec.sessionId === f.session.id && rec.uid === "student-1",
  );
  assert.ok(attRec);
  assert.equal(attRec.facialMatch, true);
  assert.ok(attRec.facialConfidence >= 80);

  // 3. Impersonation / face mismatch attempt triggers SUSPICIOUS
  f.store.updateProfilePhoto("student-2", enrolledFace);
  const a2 = f.store.claim("student-2", f.challenge);
  const mismatchRes = f.store.submit("student-2", a2.id, {
    ...f.evidence,
    simulated: true,
    faceMismatch: true,
  });
  assert.equal(mismatchRes.decision, "SUSPICIOUS");
  assert.equal(mismatchRes.facialMatch, false);
  assert.equal(mismatchRes.facialConfidence, 28);
  assert.deepEqual(mismatchRes.reasons, ["FACIAL_MISMATCH"]);

  // Impersonator does NOT get attendance logged
  const imposterRec = f.store.attendance.find((rec) => rec.uid === "student-2");
  assert.equal(imposterRec, undefined);
});

test("teacher ownership: teacher cannot start or rotate another teacher's class session, dev can manage all", () => {
  const f = fixture();
  const teacher1 = f.store.getUser("teacher");
  const teacher2 = f.store.getUser("teacher-2");
  const dev = f.store.getUser("dev");

  // sched-1 belongs to teacher, sched-3 belongs to teacher-2
  assert.equal(
    f.store.schedules.find((s) => s.id === "sched-1").teacherId,
    "teacher",
  );
  assert.equal(
    f.store.schedules.find((s) => s.id === "sched-3").teacherId,
    "teacher-2",
  );

  // Teacher 2 cannot start Teacher 1's class session
  assert.throws(
    () => f.store.start({ scheduleId: "sched-1" }, teacher2),
    /TEACHER_PERMISSION_REQUIRED/,
  );

  // Teacher 1 cannot start Teacher 2's class session
  assert.throws(
    () => f.store.start({ scheduleId: "sched-3" }, teacher1),
    /TEACHER_PERMISSION_REQUIRED/,
  );

  // Teacher 2 CAN start their own class session
  const sess2 = f.store.start({ scheduleId: "sched-3" }, teacher2);
  assert.equal(sess2.teacherId, "teacher-2");

  // Teacher 1 cannot rotate Teacher 2's session QR challenge
  assert.throws(
    () => f.store.rotate(sess2.id, teacher1),
    /TEACHER_PERMISSION_REQUIRED/,
  );

  // Teacher 2 CAN rotate their own session QR challenge
  const rotRes = f.store.rotate(sess2.id, teacher2);
  assert.ok(rotRes.id);

  // Dev CAN rotate and start any session
  const devRot = f.store.rotate(sess2.id, dev);
  assert.ok(devRot.id);
});

test("slow-network server allowance succeeds within grace and ignores forged capture timestamps", () => {
  const f = fixture();
  // Claim both student attempts while challenge is open
  const a1 = f.store.claim("student-1", f.challenge);
  const a2 = f.store.claim("student-2", f.challenge);
  const deadline = a1.deadline;

  // Case 1: Upload completes 5 seconds after deadline, but evidence was captured 10s before deadline (capturedAt <= deadline)
  // Current time is deadline + 5000ms (within the 15000ms grace window)
  f.advance(95000); // clock is now 1000000 + 95000 = 1095000 (deadline is 1090000)
  assert.ok(f.store.clock() > deadline);
  assert.ok(f.store.clock() <= deadline + 15000);

  const graceSubmit = f.store.submit("student-1", a1.id, {
    ...f.evidence,
    capturedAt: deadline - 1000, // Captured before deadline
  });
  assert.equal(graceSubmit.decision, "VERIFIED");

  // Case 2: Exceed the 15s grace window (clock > deadline + 15000)
  f.advance(15000); // clock is now deadline + 20000ms (> 15000ms grace)
  const lateSubmit = f.store.submit("student-2", a2.id, {
    ...f.evidence,
    capturedAt: a2.deadline - 500,
  });
  assert.equal(lateSubmit.phase, "PENDING_REVIEW");
  assert.deepEqual(lateSubmit.reasons, ["COMPLETION_WINDOW_ELAPSED"]);
});

test("modular presence providers: Browser, Hardware graceful degradation, Simulated deterministic control", async () => {
  // 1. Hardware Presence Provider returns UNAVAILABLE and graceful degradation payload
  const hw = new HardwarePresenceProvider({ beaconUuid: "ssec-ble-01" });
  const hwRes = await hw.verify({});
  assert.equal(hwRes.status, "UNAVAILABLE");
  assert.equal(hwRes.payload.mode, "REDUCED_EVIDENCE_FALLBACK");

  // 2. Default presenceProvider backward compatibility
  const defRes = await presenceProvider.verify();
  assert.equal(defRes.status, "UNAVAILABLE");

  // 3. Simulated Presence Provider supports deterministic test status injection
  const sim = new SimulatedPresenceProvider("PASS", "All checks passed.");
  assert.equal((await sim.verify()).status, "PASS");
  sim.setStatus("FAIL", "Spoofed signal detected.");
  assert.equal((await sim.verify()).status, "FAIL");
  assert.equal((await sim.verify()).reason, "Spoofed signal detected.");

  // 4. Browser Presence Provider with provided location context
  const bp = new BrowserPresenceProvider();
  const bpRes = await bp.verify({
    location: { lat: 13.0827, lng: 80.2707, accuracy: 5 },
  });
  assert.equal(bpRes.status, "PASS");
  assert.equal(bpRes.payload.location.lat, 13.0827);
});

test("public registration cannot create a privileged account", async (t) => {
  const f = fixture();
  assert.throws(
    () => f.store.createUser({ name: "Attacker", role: "dev" }),
    /DEV_REQUIRED/,
  );
  const server = createApp(f.store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const res = await fetch(
    `http://127.0.0.1:${server.address().port}/api/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Attacker", role: "admin" }),
    },
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "DEV_REQUIRED");
});

test("new sessions do not close another teacher's unrelated classroom", () => {
  const f = fixture();
  const second = f.store.start(
    { scheduleId: "sched-3" },
    f.store.getUser("teacher-2"),
  );
  assert.equal(f.session.open, true);
  assert.equal(second.open, true);
  assert.throws(
    () =>
      f.store.start({ scheduleId: "nonexistent" }, f.store.getUser("teacher")),
    /SCHEDULE_NOT_FOUND/,
  );
});

test("unenrolled students cannot claim a course QR", () => {
  const f = fixture();
  const s = f.store.start(
    { scheduleId: "sched-3" },
    f.store.getUser("teacher-2"),
  );
  assert.throws(
    () => f.store.claim("student-1", s.challenges[0].id, s.classId),
    /NOT_ENROLLED/,
  );
});

test("forged client capture times never extend the server deadline", () => {
  const f = fixture();
  const a = f.store.claim("student-1", f.challenge);
  f.advance(105001);
  assert.equal(
    f.store.submit(a.uid, a.id, { ...f.evidence, capturedAt: a.deadline - 1 })
      .phase,
    "PENDING_REVIEW",
  );
});
