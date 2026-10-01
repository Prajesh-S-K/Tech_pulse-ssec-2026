import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { hashPassword, FIXTURE_HASH, publicData } from "./auth.js";
import { scheduledWindow } from "./timetable.js";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { decodeImage } from "./biometrics.js";
import { dirname } from "node:path";
import { evaluate } from "../src/domain/trust.js";
import { PresenceService } from "./presence.js";
import { compareFaces } from "./biometrics.js";

export const defaultPeople = [
  {
    id: "teacher",
    name: "Demo teacher",
    role: "admin",
    email: "teacher@ssec.edu",
    dept: "ECE",
  },
  {
    id: "teacher-2",
    name: "Prof. Rajesh Kumar",
    role: "admin",
    email: "rajesh@ssec.edu",
    dept: "CSE",
  },
  {
    id: "dev",
    name: "System Developer",
    role: "dev",
    email: "dev@ssec.edu",
    dept: "Infrastructure & Platform",
  },
  ...["Aarav", "Diya", "Kavin", "Meera", "Nila", "Rohan"].map((name, i) => ({
    id: `student-${i + 1}`,
    name,
    role: "student",
    roll: `ECE${String(i + 1).padStart(3, "0")}`,
    email: `${name.toLowerCase()}@student.ssec.edu`,
    dept: "ECE",
    referencePhoto: null,
  })),
];

export const defaultClassrooms = [
  {
    id: "room-1",
    name: "ECE Lab 1",
    capacity: 40,
    lat: 13.0827,
    lng: 80.2707,
    radius: 75,
    maxAccuracy: 150,
  },
  {
    id: "room-2",
    name: "Smart Lecture Hall 302",
    capacity: 60,
    lat: 13.0831,
    lng: 80.2712,
    radius: 100,
    maxAccuracy: 150,
  },
  {
    id: "room-3",
    name: "IoT Research Lab",
    capacity: 30,
    lat: 13.0825,
    lng: 80.2703,
    radius: 50,
    maxAccuracy: 120,
  },
];

export const defaultSchedules = [
  {
    id: "sched-1",
    classId: "ECE-DEMO",
    subject: "Embedded Systems",
    teacherId: "teacher",
    createdBy: "teacher",
    classroomId: "room-1",
    time: "09:00 - 10:30",
    days: "Mon, Wed, Fri",
    enrollmentIds: [
      "student-1",
      "student-2",
      "student-3",
      "student-4",
      "student-5",
      "student-6",
    ],
  },
  {
    id: "sched-2",
    classId: "ECE-302",
    subject: "Digital Signal Processing",
    teacherId: "teacher",
    createdBy: "teacher",
    classroomId: "room-2",
    time: "11:00 - 12:30",
    days: "Tue, Thu",
    enrollmentIds: ["student-1", "student-2", "student-4", "student-5"],
  },
  {
    id: "sched-3",
    classId: "ECE-401",
    subject: "IoT Systems & Robotics",
    teacherId: "teacher-2",
    createdBy: "teacher-2",
    classroomId: "room-3",
    time: "14:00 - 15:30",
    days: "Mon, Thu",
    enrollmentIds: ["student-2", "student-3", "student-6"],
  },
];

export const people = defaultPeople;

export class DemoStore {
  constructor(clock = Date.now, options = {}) {
    this.clock = clock;
    this.testMode = options.testMode === true;
    // 15 minutes; the override exists so browser tests can observe expiry quickly.
    this.reviewTtlMs = options.reviewTtlMs ?? 15 * 60 * 1000;
    this.reviewPhotos = new Map();
    this.presence = new PresenceService(options.presenceConfig, clock);
    this.persistPath = options.persistPath || null;
    // Connected mode starts empty and is hydrated from Firestore.
    this.connected = options.empty === true;
    this.users = this.connected ? [] : structuredClone(defaultPeople);
    this.classrooms = this.connected ? [] : structuredClone(defaultClassrooms);
    this.schedules = this.connected ? [] : structuredClone(defaultSchedules);
    this.sessions = [];
    this.attempts = [];
    this.attendance = [];
    this.roomPresences = [];
    this.logs = [];
    this.saveError = null;

    if (this.persistPath) {
      this.load();
    }
    if (this.testMode) {
      for (const u of this.users) u.passwordHash ||= FIXTURE_HASH;
    } else if (options.credentialsPath) {
      let credentials = existsSync(options.credentialsPath)
        ? JSON.parse(readFileSync(options.credentialsPath, "utf8"))
        : {};
      for (const u of this.users)
        if (!u.passwordHash) {
          const password = randomBytes(12).toString("base64url");
          u.passwordHash = hashPassword(password);
          credentials[u.id] = { email: u.email, password };
        }
      mkdirSync(dirname(options.credentialsPath), { recursive: true });
      writeFileSync(
        options.credentialsPath,
        JSON.stringify(credentials, null, 2) + "\n",
        { mode: 0o600 },
      );
      for (const a of this.attempts) {
        delete a.photo;
        if (a.phase === "AWAITING_REVIEW") {
          a.phase = "RETRY";
          a.reasons = ["REVIEW_EVIDENCE_LOST_RECAPTURE"];
          a.eligibleForReview = false;
        }
      }
      for (const a of this.attendance) delete a.photo;
      this.save();
    }
  }

  hydrate(data = {}) {
    for (const key of [
      "users",
      "classrooms",
      "schedules",
      "sessions",
      "attempts",
      "attendance",
      "roomPresences",
    ])
      this[key] = Array.isArray(data[key]) ? data[key] : [];
  }

  // Connected mode: the Firebase UID is the user id; role is server-controlled
  // and a self-provisioned account can only ever be a student.
  provisionExternalUser({ uid, email, name }) {
    if (!uid || typeof uid !== "string") throw new Error("UID_REQUIRED");
    const existing = this.getUser(uid);
    if (existing) return existing;
    const display =
      (typeof name === "string" && name.trim().slice(0, 80)) ||
      (email ? email.split("@")[0] : "Student");
    const user = {
      id: uid,
      name: display,
      role: "student",
      email: email || null,
      dept: "ECE",
      roll: null,
      referencePhoto: null,
      createdAt: this.clock(),
    };
    this.users.push(user);
    this.log("auth", user, `Provisioned student account: ${user.name}`, {
      userId: uid,
    });
    return user;
  }

  setUserRole(uid, role, actor) {
    if (actor?.role !== "dev") throw new Error("DEV_REQUIRED");
    if (!["student", "admin"].includes(role)) throw new Error("INVALID_ROLE");
    const user = this.getUser(uid);
    if (!user) throw new Error("USER_NOT_FOUND");
    if (user.role === "dev") throw new Error("DEV_ROLE_IS_FIXED");
    user.role = role;
    this.log("auth", actor, `Set role of ${user.name} to ${role}`, {
      userId: uid,
      role,
    });
    return user;
  }

  load() {
    try {
      if (!this.persistPath || !existsSync(this.persistPath)) return;
      const data = JSON.parse(readFileSync(this.persistPath, "utf-8"));
      if (Array.isArray(data.users) && data.users.length) {
        this.users = data.users;
        if (!this.users.some((u) => u.id === "dev")) {
          this.users.push(
            structuredClone(defaultPeople.find((u) => u.id === "dev")),
          );
        }
      }
      if (Array.isArray(data.classrooms) && data.classrooms.length)
        this.classrooms = data.classrooms;
      if (Array.isArray(data.schedules) && data.schedules.length)
        this.schedules = data.schedules;
      if (Array.isArray(data.sessions)) this.sessions = data.sessions;
      if (Array.isArray(data.attempts)) this.attempts = data.attempts;
      if (Array.isArray(data.attendance)) this.attendance = data.attendance;
      if (Array.isArray(data.roomPresences))
        this.roomPresences = data.roomPresences;
      if (Array.isArray(data.logs)) this.logs = data.logs;
    } catch (error) {
      throw new Error("STORE_LOAD_FAILED", { cause: error });
    }
  }

  save() {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const payload = JSON.stringify(
        {
          users: this.users,
          classrooms: this.classrooms,
          schedules: this.schedules,
          sessions: this.sessions,
          attempts: this.attempts.map(({ photo, ...a }) => a),
          attendance: this.attendance.map(({ photo, ...a }) => a),
          roomPresences: this.roomPresences,
          logs: this.logs.slice(0, 500),
        },
        null,
        2,
      );
      writeFileSync(this.persistPath + ".tmp", payload, {
        encoding: "utf-8",
        mode: 0o600,
      });
      renameSync(this.persistPath + ".tmp", this.persistPath);
      this.saveError = null;
    } catch (err) {
      // Never swallowed: the API layer checks this and rolls back (503).
      this.saveError = err;
    }
  }

  // Throws if the last disk write failed, so callers cannot report a durable update.
  assertDurable() {
    if (!this.persistPath) return;
    this.save();
    if (this.saveError) {
      const e = new Error("PERSISTENCE_FAILED", { cause: this.saveError });
      e.code = "PERSISTENCE_FAILED";
      throw e;
    }
  }

  log(category, actor, message, details = {}, level = "info") {
    const entry = {
      id: randomUUID(),
      timestamp: this.clock(),
      level,
      category,
      actor: actor
        ? { id: actor.id, name: actor.name, role: actor.role }
        : { id: "system", name: "System", role: "system" },
      message,
      details,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 500) this.logs.length = 500;
    this.save();
    return entry;
  }

  listDemoAccounts() {
    const ids = [
      "teacher",
      "teacher-2",
      "dev",
      "student-1",
      "student-2",
      "student-4",
    ];
    return this.users.filter((u) => ids.includes(u.id));
  }

  listUsers(actor = null) {
    if (actor && actor.role === "student") {
      throw new Error("ADMIN_REQUIRED");
    }
    return this.users;
  }

  getUser(id) {
    return this.users.find((u) => u.id === id);
  }

  createUser(input = {}, actor = null) {
    if (!input.name || !input.name.trim()) throw new Error("NAME_REQUIRED");
    let role = "student";
    if (["admin", "dev"].includes(input.role) && actor?.role !== "dev")
      throw new Error("DEV_REQUIRED");
    if (input.role === "admin") role = "admin";
    if (input.role === "dev") role = "dev";

    const id =
      input.id ||
      (role === "student"
        ? `student-${this.users.filter((u) => u.role === "student").length + 1}`
        : role === "admin"
          ? `teacher-${this.users.filter((u) => u.role === "admin").length + 1}`
          : `dev-${this.users.filter((u) => u.role === "dev").length + 1}`);

    if (
      this.users.some(
        (u) => u.id === id || (input.email && u.email === input.email),
      )
    ) {
      throw new Error("USER_ALREADY_EXISTS");
    }

    if (
      !this.testMode &&
      input.referencePhoto &&
      !decodeImage(input.referencePhoto)
    )
      throw Error("VALID_REFERENCE_PHOTO_REQUIRED");
    const user = {
      id,
      name: input.name.trim(),
      role,
      roll:
        role === "student"
          ? input.roll || `ECE${String(this.users.length + 1).padStart(3, "0")}`
          : input.roll || undefined,
      email: input.email || `${id}@ssec.edu`,
      dept: input.dept || "ECE",
      referencePhoto: input.referencePhoto || null,
      passwordHash:
        this.testMode && !input.password
          ? FIXTURE_HASH
          : hashPassword(input.password),
      createdAt: this.clock(),
    };

    this.users.push(user);
    this.log(
      "auth",
      actor || user,
      `Registered new user: ${user.name} (${user.role.toUpperCase()})`,
      { userId: user.id, role: user.role, email: user.email },
    );
    this.save();
    return user;
  }

  updateUser(id, updates = {}, actor = null) {
    const user = this.getUser(id);
    if (!user) throw new Error("USER_NOT_FOUND");
    if (actor && actor.id !== id && actor.role !== "dev") {
      throw new Error("PERMISSION_DENIED");
    }

    if (
      !this.testMode &&
      updates.referencePhoto &&
      (typeof updates.referencePhoto !== "string" ||
        updates.referencePhoto.length > 1500000 ||
        !decodeImage(updates.referencePhoto))
    )
      throw Error("VALID_REFERENCE_PHOTO_REQUIRED");
    if (updates.name !== undefined && updates.name.trim()) {
      user.name = updates.name.trim();
    }
    if (updates.email !== undefined && updates.email.trim()) {
      user.email = updates.email.trim();
    }
    if (updates.dept !== undefined && updates.dept.trim()) {
      user.dept = updates.dept.trim();
    }
    if (updates.roll !== undefined) {
      user.roll = updates.roll.trim();
    }
    if (updates.referencePhoto !== undefined) {
      user.referencePhoto = updates.referencePhoto;
    }

    this.log("auth", actor || user, `Updated user profile for ${user.name}`, {
      userId: user.id,
    });
    this.save();
    return user;
  }

  updateProfilePhoto(uid, referencePhoto, actor = null) {
    return this.updateUser(uid, { referencePhoto }, actor);
  }

  listClassrooms() {
    return this.classrooms;
  }

  createClassroom(input = {}, actor = null) {
    if (actor && actor.role !== "admin" && actor.role !== "dev") {
      throw new Error("TEACHER_OR_DEV_ONLY");
    }
    if (!input.name || !input.name.trim())
      throw new Error("ROOM_NAME_REQUIRED");
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    const radius = Number(input.radius || 75);
    const maxAccuracy = Number(input.maxAccuracy || 100);
    const capacity = Number(input.capacity || 40);

    if (
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(lng) ||
      Math.abs(lng) > 180
    )
      throw new Error("INVALID_COORDINATES");

    if (!Number.isSafeInteger(capacity) || capacity <= 0)
      throw new Error("INVALID_CAPACITY");
    if (![25, 50, 75, 100, 150, 200, 300, 500].includes(radius))
      throw new Error("INVALID_RADIUS");
    if (!Number.isFinite(maxAccuracy) || maxAccuracy <= 0)
      throw new Error("INVALID_ACCURACY");
    const room = {
      id:
        input.id ||
        `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name.trim(),
      capacity,
      lat,
      lng,
      radius,
      maxAccuracy,
    };

    this.classrooms.push(room);
    this.log("geofence", actor, `Created campus geo location: ${room.name}`, {
      roomId: room.id,
      lat,
      lng,
      radius,
      maxAccuracy,
      capacity,
    });
    this.save();
    return room;
  }

  updateClassroom(id, updates = {}, actor = null) {
    if (actor && actor.role !== "admin" && actor.role !== "dev") {
      throw new Error("TEACHER_OR_DEV_ONLY");
    }
    const room = this.classrooms.find((c) => c.id === id);
    if (!room) throw new Error("ROOM_NOT_FOUND");

    if (updates.name !== undefined) {
      if (!updates.name.trim()) throw new Error("ROOM_NAME_REQUIRED");
      room.name = updates.name.trim();
    }
    if (updates.lat !== undefined) {
      const lat = Number(updates.lat);
      if (!Number.isFinite(lat) || Math.abs(lat) > 90)
        throw new Error("INVALID_COORDINATES");
      room.lat = lat;
    }
    if (updates.lng !== undefined) {
      const lng = Number(updates.lng);
      if (!Number.isFinite(lng) || Math.abs(lng) > 180)
        throw new Error("INVALID_COORDINATES");
      room.lng = lng;
    }
    if (updates.radius !== undefined) {
      const radius = Number(updates.radius);
      if (![25, 50, 75, 100, 150, 200, 300, 500].includes(radius))
        throw new Error("INVALID_RADIUS");
      room.radius = radius;
    }
    if (updates.maxAccuracy !== undefined) {
      const maxAccuracy = Number(updates.maxAccuracy);
      if (!Number.isFinite(maxAccuracy) || maxAccuracy <= 0)
        throw new Error("INVALID_ACCURACY");
      room.maxAccuracy = maxAccuracy;
    }
    if (updates.capacity !== undefined) {
      const cap = Number(updates.capacity);
      if (!Number.isSafeInteger(cap) || cap <= 0)
        throw new Error("INVALID_CAPACITY");
      room.capacity = cap;
    }

    this.log("geofence", actor, `Updated campus geo location: ${room.name}`, {
      roomId: room.id,
      updates,
    });
    this.save();
    return room;
  }

  deleteClassroom(id, actor = null) {
    if (actor && actor.role !== "admin" && actor.role !== "dev") {
      throw new Error("TEACHER_OR_DEV_ONLY");
    }
    const idx = this.classrooms.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error("ROOM_NOT_FOUND");
    const room = this.classrooms[idx];
    this.classrooms.splice(idx, 1);
    this.log("geofence", actor, `Deleted campus geo location: ${room.name}`, {
      roomId: room.id,
    });
    this.save();
    return { ok: true, id };
  }

  listSchedules(forUserId = null) {
    if (!forUserId) return this.schedules;
    const user = this.getUser(forUserId);
    if (!user) return [];
    if (user.role === "dev") return this.schedules;
    if (user.role === "admin") {
      // Teacher only gets their own assigned schedules
      return this.schedules.filter((s) => s.teacherId === user.id);
    }
    return this.schedules.filter(
      (s) =>
        Array.isArray(s.enrollmentIds) && s.enrollmentIds.includes(user.id),
    );
  }

  createSchedule(input = {}, actor = null) {
    if (!input.subject || !input.subject.trim())
      throw new Error("SUBJECT_REQUIRED");
    if (!input.classId || !input.classId.trim())
      throw new Error("CLASS_ID_REQUIRED");

    let teacherId = null;
    if (actor?.role === "admin") {
      // Teacher assigns themselves as the permission grantor
      teacherId = input.teacherId || actor.id;
    } else if (actor?.role === "dev") {
      teacherId = input.teacherId || actor.id;
    } else {
      // Student can propose course and assign a teacher if chosen
      teacherId = input.teacherId || null;
    }

    let enrollmentIds = [];
    if (input.enrollmentIds !== undefined && actor?.role === "student") {
      const requested = this.normalizeRoster(input.enrollmentIds);
      if (requested.length !== 1 || requested[0] !== actor.id)
        throw new Error("ROSTER_FORBIDDEN");
      enrollmentIds = requested;
    } else if (input.enrollmentIds !== undefined) {
      enrollmentIds = this.normalizeRoster(input.enrollmentIds);
    } else if (actor?.role === "student") {
      enrollmentIds = [actor.id];
    } else {
      enrollmentIds = this.users
        .filter((u) => u.role === "student")
        .map((s) => s.id);
    }

    const schedule = {
      id:
        input.id ||
        `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      classId: input.classId.trim().toUpperCase(),
      subject: input.subject.trim(),
      teacherId,
      createdBy: actor?.id || "teacher",
      classroomId: input.classroomId || this.classrooms[0]?.id || "room-1",
      time: input.time || "09:00 - 10:30",
      days: input.days || "Mon, Wed, Fri",
      enrollmentIds,
    };

    this.schedules.push(schedule);
    this.log(
      "schedule",
      actor,
      `Created course schedule: ${schedule.subject} (${schedule.classId})`,
      {
        scheduleId: schedule.id,
        teacherId: schedule.teacherId,
        classroomId: schedule.classroomId,
        time: schedule.time,
        days: schedule.days,
      },
    );
    this.save();
    return schedule;
  }

  normalizeRoster(ids) {
    if (!Array.isArray(ids)) throw new Error("ROSTER_INVALID");
    const students = new Set(
      this.users.filter((u) => u.role === "student").map((u) => u.id),
    );
    const roster = [];
    for (const id of ids) {
      if (typeof id !== "string" || !students.has(id))
        throw new Error("ROSTER_UNKNOWN_STUDENT");
      if (!roster.includes(id)) roster.push(id);
    }
    return roster;
  }

  updateSchedule(id, updates = {}, actor = null) {
    const sched = this.schedules.find((s) => s.id === id);
    if (!sched) throw new Error("SCHEDULE_NOT_FOUND");

    // Permission check: Dev can edit anything.
    // If schedule has an assigned teacher: only that teacher can edit/permit.
    // If no assigned teacher: only the creator can edit.
    if (actor && actor.role !== "dev") {
      if (sched.teacherId && actor.id !== sched.teacherId) {
        throw new Error("TEACHER_PERMISSION_REQUIRED");
      }
      if (!sched.teacherId && actor.id !== sched.createdBy) {
        throw new Error("CREATOR_PERMISSION_REQUIRED");
      }
    }

    // Validate everything before touching the schedule so a rejection changes nothing.
    let roster;
    if (updates.enrollmentIds !== undefined) {
      if (actor?.role === "student") throw new Error("ROSTER_FORBIDDEN");
      roster = this.normalizeRoster(updates.enrollmentIds);
    }
    if (updates.subject !== undefined && !updates.subject.trim())
      throw new Error("SUBJECT_REQUIRED");
    if (updates.classId !== undefined && !updates.classId.trim())
      throw new Error("CLASS_ID_REQUIRED");
    if (updates.subject !== undefined) {
      sched.subject = updates.subject.trim();
    }
    if (updates.classId !== undefined) {
      sched.classId = updates.classId.trim().toUpperCase();
    }
    if (updates.classroomId !== undefined) {
      sched.classroomId = updates.classroomId;
    }
    if (updates.time !== undefined) {
      sched.time = updates.time.trim();
    }
    if (updates.days !== undefined) {
      sched.days = updates.days.trim();
    }
    if (updates.teacherId !== undefined) {
      sched.teacherId = updates.teacherId;
    }
    if (roster !== undefined) sched.enrollmentIds = roster;

    this.log(
      "schedule",
      actor,
      `Updated course schedule: ${sched.subject} (${sched.classId})`,
      { scheduleId: sched.id, updates },
    );
    this.save();
    return sched;
  }

  deleteSchedule(id, actor = null) {
    const idx = this.schedules.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error("SCHEDULE_NOT_FOUND");
    const sched = this.schedules[idx];

    // Permission check: Dev can delete anything.
    // If schedule has an assigned teacher: only that teacher can delete/permit.
    // If no assigned teacher: only creator can delete.
    if (actor && actor.role !== "dev") {
      if (sched.teacherId && actor.id !== sched.teacherId) {
        throw new Error("TEACHER_PERMISSION_REQUIRED");
      }
      if (!sched.teacherId && actor.id !== sched.createdBy) {
        throw new Error("CREATOR_PERMISSION_REQUIRED");
      }
    }

    this.schedules.splice(idx, 1);
    this.log(
      "schedule",
      actor,
      `Deleted course schedule: ${sched.subject} (${sched.classId})`,
      { scheduleId: sched.id },
    );
    this.save();
    return { ok: true, id };
  }

  start(input = {}, actor = null) {
    let room = {
      name: "ECE Lab 1",
      capacity: 40,
      lat: 13.0827,
      lng: 80.2707,
      radius: 75,
      maxAccuracy: 100,
    };

    let subject = "Embedded Systems";
    let classId = "ECE-DEMO";
    let scheduleId = input.scheduleId || "sched-1";
    let teacherId = actor?.id || "teacher";
    const sessionType =
      input.sessionType || (this.testMode ? "demo" : undefined);
    if (!["demo", "scheduled"].includes(sessionType))
      throw Error("INVALID_SESSION_TYPE");

    if (input.scheduleId) {
      const sched = this.schedules.find((s) => s.id === input.scheduleId);
      if (sched) {
        if (
          actor &&
          actor.role !== "dev" &&
          sched.teacherId &&
          sched.teacherId !== actor.id
        ) {
          throw new Error("TEACHER_PERMISSION_REQUIRED");
        }
        subject = sched.subject;
        classId = sched.classId;
        scheduleId = sched.id;
        teacherId = sched.teacherId || actor?.id || "teacher";
        const assignedRoom = this.classrooms.find(
          (c) => c.id === (input.classroomId || sched.classroomId),
        );
        if (!assignedRoom) throw new Error("ROOM_NOT_FOUND");
        if (assignedRoom) {
          room = { ...assignedRoom };
        }
      } else {
        throw new Error("SCHEDULE_NOT_FOUND");
      }
    } else if (input.classroomId) {
      const assignedRoom = this.classrooms.find(
        (c) => c.id === input.classroomId,
      );
      if (assignedRoom) room = { ...assignedRoom };
    }

    if (input.room) {
      room = { ...room, ...input.room };
    } else if (input.lat !== undefined && input.lng !== undefined) {
      room = { ...room, ...input };
    }

    if (
      !Number.isFinite(room.lat) ||
      Math.abs(room.lat) > 90 ||
      !Number.isFinite(room.lng) ||
      Math.abs(room.lng) > 180 ||
      ![25, 50, 75, 100, 150, 200, 300, 500].includes(room.radius) ||
      (room.maxAccuracy !== undefined &&
        (!Number.isFinite(room.maxAccuracy) || room.maxAccuracy <= 0))
    )
      throw new Error("INVALID_ROOM");

    const scheduled = this.schedules.find((sc) => sc.id === scheduleId);
    const window =
      sessionType === "scheduled"
        ? scheduledWindow(scheduled, this.clock())
        : null;
    if (input.presenceMode === "local" && !this.presence.available(room.id))
      throw new Error("PRESENCE_DEVICE_NOT_CONFIGURED_FOR_ROOM");
    for (const s of this.sessions) {
      if (s.classId === classId || s.room.id === room.id) s.open = false;
    }

    const sessionId = randomUUID();
    const s = {
      id: sessionId,
      attendanceEventId: input.attendanceEventId || sessionId,
      replacesSessionId: input.replacesSessionId || null,
      scheduleId,
      classId,
      subject,
      teacherId,
      room,
      sessionType,
      scheduleEndsAt: window?.endsAt || null,
      opensAt: this.clock(),
      closesAt: Math.min(this.clock() + 300000, window?.endsAt || Infinity),
      open: true,
      presenceMode: input.presenceMode === "local" ? "local" : "baseline",
      challenges: [],
    };

    if (s.presenceMode === "local" && !this.presence.available(s.room.id))
      throw new Error("PRESENCE_DEVICE_NOT_CONFIGURED_FOR_ROOM");
    this.sessions.push(s);
    this.rotate(s.id, actor);
    this.log(
      "session",
      actor,
      `Started attendance session: ${subject} (${classId}) at ${room.name}`,
      {
        sessionId: s.id,
        room,
        teacherId,
        sessionType,
        timetableOverride: sessionType === "demo",
      },
    );
    this.save();
    return s;
  }

  // Switch an ESP32-required session to GPS + teacher review. The old session is
  // never edited: it closes to new claims and a new baseline session continues
  // the same attendance event (so a student can only be recorded once).
  replaceWithoutEsp32(sessionId, actor) {
    const old = this.session(sessionId);
    if (!actor || (actor.role !== "dev" && old.teacherId !== actor.id))
      throw new Error("TEACHER_PERMISSION_REQUIRED");
    if (old.presenceMode !== "local")
      throw new Error("SESSION_NOT_ESP32_REQUIRED");
    if (!old.open || this.clock() >= old.closesAt)
      throw new Error("SESSION_CLOSED");
    const s = this.start(
      {
        scheduleId: old.scheduleId,
        sessionType: old.sessionType,
        room: { ...old.room },
        presenceMode: "baseline",
        attendanceEventId: old.attendanceEventId || old.id,
        replacesSessionId: old.id,
      },
      actor,
    );
    this.log(
      "session",
      actor,
      "Replaced ESP32-required session with GPS + teacher review session",
      { oldSessionId: old.id, sessionId: s.id },
      "warn",
    );
    return s;
  }

  updateSessionVenue(sessionId, roomInput = {}, actor = null) {
    const s = this.session(sessionId);
    if (!s.open || this.clock() >= s.closesAt)
      throw new Error("SESSION_CLOSED");

    // Teacher can only update their own session venue
    if (
      actor &&
      actor.role !== "dev" &&
      s.teacherId &&
      s.teacherId !== actor.id
    ) {
      throw new Error("TEACHER_PERMISSION_REQUIRED");
    }

    let newRoom = { ...s.room };

    if (roomInput.classroomId) {
      const c = this.classrooms.find((r) => r.id === roomInput.classroomId);
      if (c) newRoom = { ...c };
    }

    if (roomInput.name) newRoom.name = roomInput.name.trim();
    if (roomInput.lat !== undefined) newRoom.lat = Number(roomInput.lat);
    if (roomInput.lng !== undefined) newRoom.lng = Number(roomInput.lng);
    if (roomInput.radius !== undefined)
      newRoom.radius = Number(roomInput.radius);
    if (roomInput.maxAccuracy !== undefined)
      newRoom.maxAccuracy = Number(roomInput.maxAccuracy);

    if (
      !Number.isFinite(newRoom.lat) ||
      Math.abs(newRoom.lat) > 90 ||
      !Number.isFinite(newRoom.lng) ||
      Math.abs(newRoom.lng) > 180 ||
      ![25, 50, 75, 100, 150, 200, 300, 500].includes(newRoom.radius) ||
      (newRoom.maxAccuracy !== undefined &&
        (!Number.isFinite(newRoom.maxAccuracy) || newRoom.maxAccuracy <= 0))
    )
      throw new Error("INVALID_ROOM");

    if (s.presenceMode === "local" && !this.presence.available(newRoom.id))
      throw new Error("PRESENCE_DEVICE_NOT_CONFIGURED_FOR_ROOM");
    const oldVenue = `${s.room.name} (${s.room.lat.toFixed(4)}, ${s.room.lng.toFixed(4)})`;
    s.room = newRoom;
    const newVenue = `${s.room.name} (${s.room.lat.toFixed(4)}, ${s.room.lng.toFixed(4)})`;

    this.log("venue", actor, `Relocated active session venue to ${newVenue}`, {
      sessionId: s.id,
      oldVenue,
      newVenue,
      newRoom,
    });
    this.save();
    return s;
  }

  session(id) {
    const s = this.sessions.find((s) => s.id === id);
    if (!s) throw new Error("SESSION_NOT_FOUND");
    return s;
  }

  rotate(id, actor = null) {
    const s = this.session(id);
    if (
      actor &&
      actor.role !== "dev" &&
      s.teacherId &&
      s.teacherId !== actor.id
    ) {
      throw new Error("TEACHER_PERMISSION_REQUIRED");
    }
    if (!s.open || this.clock() >= s.closesAt)
      throw new Error("SESSION_CLOSED");
    const c = {
      id: randomUUID(),
      expiresAt: Math.min(this.clock() + 60000, s.closesAt),
    };
    s.challenges.push(c);
    this.log("session", actor, `Rotated classroom QR challenge for session`, {
      sessionId: s.id,
      challengeId: c.id,
    });
    this.save();
    return c;
  }

  stop(id, actor = null) {
    const s = this.session(id);
    if (
      actor &&
      actor.role !== "dev" &&
      s.teacherId &&
      s.teacherId !== actor.id
    ) {
      throw new Error("TEACHER_PERMISSION_REQUIRED");
    }
    s.open = false;
    this.log("session", actor, `Closed attendance session`, { sessionId: id });
    this.save();
  }

  claim(uid, challengeId, classId) {
    const student = this.users.find(
      (p) => p.id === uid && p.role === "student",
    );
    if (!student) throw new Error("IDENTITY_INVALID");

    const s = this.sessions.find((s) =>
      s.challenges.some((c) => c.id === challengeId),
    );
    if (!s) throw new Error("CHALLENGE_INVALID");
    if (classId !== undefined && classId !== s.classId)
      throw new Error("SCHEDULE_INVALID");
    const schedule = this.schedules.find((sc) => sc.id === s.scheduleId);
    if (
      !Array.isArray(schedule?.enrollmentIds) ||
      !schedule.enrollmentIds.includes(uid)
    )
      throw new Error("NOT_ENROLLED");

    if (s.sessionType === "scheduled") scheduledWindow(schedule, this.clock());
    const existing = this.attempts.find(
      (a) => a.uid === uid && a.sessionId === s.id,
    );
    if (existing) return existing;

    const c = s.challenges.find((c) => c.id === challengeId);
    if (!s.open || this.clock() >= s.closesAt || this.clock() >= c.expiresAt)
      throw new Error("CHALLENGE_EXPIRED_OR_CLOSED");

    const a = {
      id: randomUUID(),
      uid,
      sessionId: s.id,
      challengeId,
      claimedAt: this.clock(),
      deadline: this.clock() + (s.presenceMode === "local" ? 180000 : 90000),
      phase: "COLLECTING",
      decision: null,
      reasons: [],
      simulated: false,
    };

    this.attempts.push(a);
    this.log("attempt", student, `Claimed check-in attempt for ${classId}`, {
      challengeId,
      sessionId: s.id,
      deadline: a.deadline,
    });
    this.save();
    return a;
  }

  presenceRequest(uid, id) {
    const a = this.attempts.find((a) => a.id === id && a.uid === uid);
    if (!a) throw new Error("ATTEMPT_NOT_FOUND");
    const s = this.session(a.sessionId);
    if (s.presenceMode !== "local") throw new Error("LOCAL_PROOF_NOT_REQUIRED");
    const result = this.presence.issue(a, s.room.id);
    this.save();
    return result;
  }

  submitFixture(uid, id, evidence = {}) {
    const a = this.attempts.find((a) => a.id === id && a.uid === uid);
    if (!a) throw new Error("ATTEMPT_NOT_FOUND");

    if (a.decision === "VERIFIED") return a;

    if (this.clock() > a.deadline) {
      // Server grants a fixed upload allowance; a client clock cannot prove capture time.
      const isWithinGrace = this.clock() <= a.deadline + 15000;

      if (!isWithinGrace) {
        Object.assign(a, {
          phase: "PENDING_REVIEW",
          reasons: ["COMPLETION_WINDOW_ELAPSED"],
        });
        this.save();
        return a;
      }
    }

    const s = this.session(a.sessionId);
    const localProof = this.presence.verify(
      a,
      s.room.id,
      evidence.presenceProof,
    );
    const evalResult = evaluate(
      { ...evidence, localProof },
      s.room,
      s.presenceMode,
    );
    Object.assign(a, evalResult, {
      simulated: !!evidence.simulated,
      updatedAt: this.clock(),
    });

    if (
      typeof evidence.photo === "string" &&
      evidence.photo.startsWith("data:")
    ) {
      a.photo = evidence.photo;
    }

    const user = this.getUser(uid);

    // Biometric Facial Recognition Verification
    if (a.decision === "VERIFIED" && evidence.photo) {
      const facialResult = compareFaces(user?.referencePhoto, evidence.photo, {
        simulated: !!evidence.simulated,
        faceMismatch: !!evidence.faceMismatch,
      });

      a.facialMatch = facialResult.match;
      a.facialConfidence = facialResult.confidence;
      a.facialStatus = facialResult.status;

      if (!facialResult.match) {
        a.decision = "SUSPICIOUS";
        a.phase = "COMPLETED";
        a.reasons = ["FACIAL_MISMATCH"];
      } else if (facialResult.status === "FACIAL_MATCH") {
        if (!a.reasons.includes("FACIAL_MATCH")) {
          a.reasons = ["FACIAL_MATCH", ...a.reasons];
        }
      }
    }

    if (a.decision === "VERIFIED") {
      this.attendance.push({
        id: `${s.id}_${a.uid}`,
        sessionId: s.id,
        scheduleId: s.scheduleId,
        subject: s.subject,
        classId: s.classId,
        teacherId: s.teacherId,
        uid,
        studentName: user ? user.name : "Student",
        roll: user ? user.roll : "Unknown",
        verifiedAt: this.clock(),
        distance: a.distance,
        accuracy: a.accuracy,
        facialMatch: a.facialMatch,
        facialConfidence: a.facialConfidence,
        photo: a.photo || null,
        simulated: a.simulated,
      });
    }

    const faceText =
      a.facialMatch === true
        ? ` · Face Verified (${a.facialConfidence}%)`
        : a.facialMatch === false
          ? ` · Face Mismatch (${a.facialConfidence}%)`
          : "";

    this.log(
      "attempt",
      user,
      `Submitted check-in evidence: verdict ${a.decision}${a.distance !== null ? ` (${a.distance}m from venue)` : ""}${faceText}`,
      {
        decision: a.decision,
        reasons: a.reasons,
        distance: a.distance,
        accuracy: a.accuracy,
        facialMatch: a.facialMatch,
        facialConfidence: a.facialConfidence,
        simulated: a.simulated,
        sessionId: s.id,
      },
      a.decision === "VERIFIED"
        ? "info"
        : a.decision === "SUSPICIOUS"
          ? "warn"
          : "error",
    );

    this.save();
    return a;
  }

  expireReviewPhotos() {
    let changed = false;
    for (const [id, p] of this.reviewPhotos)
      if (this.clock() >= p.expiresAt) {
        changed = true;
        this.reviewPhotos.delete(id);
        const a = this.attempts.find((a) => a.id === id);
        if (a?.phase === "AWAITING_REVIEW") {
          a.phase = "RETRY";
          a.eligibleForReview = false;
          a.reasons = ["REVIEW_PHOTO_EXPIRED_RECAPTURE"];
        }
      }
    if (changed) this.save();
  }
  submit(uid, id, evidence = {}) {
    if (this.testMode) return this.submitFixture(uid, id, evidence);
    this.expireReviewPhotos();
    const a = this.attempts.find((a) => a.id === id && a.uid === uid);
    if (!a) throw Error("ATTEMPT_NOT_FOUND");
    if (a.decision === "VERIFIED" || a.reviewedAt) return a;
    if (evidence.simulated || evidence.faceMismatch)
      throw Error("SIMULATION_NOT_ALLOWED");
    const s = this.session(a.sessionId);

    const recapture = a.reasons?.some((r) => r.endsWith("RECAPTURE"));
    if (this.clock() > a.deadline + 15000 && !recapture) {
      a.phase = "PENDING_REVIEW";
      a.decision = null;
      a.eligibleForReview = false;
      a.reasons = ["COMPLETION_WINDOW_ELAPSED"];
      this.save();
      return a;
    }
    if (
      typeof evidence.photo !== "string" ||
      !/^data:image\/(jpeg|png);base64,/.test(evidence.photo) ||
      evidence.photo.length > 1500000 ||
      !decodeImage(evidence.photo)
    ) {
      a.phase = "RETRY";
      a.decision = null;
      a.reasons = ["VALID_CAMERA_PHOTO_REQUIRED"];
      this.save();
      return a;
    }
    if (recapture && a.validatedChecks) {
      // Recover only the review photo; previously accepted proximity/time/proof checks are immutable.
    } else {
      const localProof = this.presence.verify(
        a,
        s.room.id,
        evidence.presenceProof,
      );
      const result = evaluate(
        { ...evidence, localProof },
        s.room,
        s.presenceMode,
      );
      Object.assign(a, result, {
        updatedAt: this.clock(),
        simulated: false,
        eligibleForReview: false,
      });
      if (result.decision !== "VERIFIED") {
        this.reviewPhotos.delete(id);
        this.save();
        return a;
      }
      a.validatedChecks = {
        acceptedAt: this.clock(),
        reasons: result.reasons,
        room: structuredClone(s.room),
        presenceMode: s.presenceMode,
      };
    }
    const similarity = compareFaces(
      this.getUser(uid)?.referencePhoto,
      evidence.photo,
    );
    a.advisorySimilarity = similarity.confidence;
    a.facialMatch = null;
    a.facialConfidence = null;
    a.facialStatus = "MANUAL_REVIEW_REQUIRED";
    a.decision = null;
    a.phase = "AWAITING_REVIEW";
    a.eligibleForReview = true;
    a.reasons = ["TEACHER_IDENTITY_REVIEW_REQUIRED"];
    this.reviewPhotos.set(id, {
      photo: evidence.photo,
      expiresAt: this.clock() + this.reviewTtlMs,
    });
    this.save();
    return a;
  }
  review(id, decision, actor) {
    this.expireReviewPhotos();
    const a = this.attempts.find((a) => a.id === id);
    if (!a) throw Error("ATTEMPT_NOT_FOUND");
    const s = this.session(a.sessionId);
    if (
      !actor ||
      (actor.role !== "dev" &&
        (actor.role !== "admin" || actor.id !== s.teacherId))
    )
      throw Error("TEACHER_PERMISSION_REQUIRED");
    if (!["approve", "reject"].includes(decision))
      throw Error("INVALID_REVIEW_DECISION");
    if (a.reviewedAt) return a;
    if (
      a.phase !== "AWAITING_REVIEW" ||
      !a.validatedChecks ||
      !this.reviewPhotos.has(id)
    )
      throw Error("VALID_REVIEW_EVIDENCE_REQUIRED");
    a.decision = decision === "approve" ? "VERIFIED" : "REJECTED";
    a.phase = "COMPLETED";
    a.reviewedAt = this.clock();
    a.reviewedBy = actor.id;
    a.reasons = [
      decision === "approve"
        ? "TEACHER_IDENTITY_APPROVED"
        : "TEACHER_IDENTITY_REJECTED",
      ...a.validatedChecks.reasons,
    ];
    this.reviewPhotos.delete(id);
    const eventId = s.attendanceEventId || s.id;
    if (
      a.decision === "VERIFIED" &&
      !this.attendance.some(
        (r) => (r.eventId || r.sessionId) === eventId && r.uid === a.uid,
      )
    ) {
      const u = this.getUser(a.uid);
      this.recordPresence(s, a.uid, eventId);
      this.attendance.push({
        id: `${eventId}_${a.uid}`,
        eventId,
        sessionId: s.id,
        scheduleId: s.scheduleId,
        classId: s.classId,
        subject: s.subject,
        teacherId: s.teacherId,
        uid: a.uid,
        studentName: u.name,
        roll: u.roll,
        verifiedAt: this.clock(),
        reviewedBy: actor.id,
      });
    }
    this.log("review", actor, `Identity review ${decision}`, { attemptId: id });
    this.save();
    return a;
  }

  // Estimated room occupancy: identifiers, room/session link and timestamps only.
  presenceExpiry(s) {
    const horizon = s.opensAt + 60 * 60 * 1000;
    return s.sessionType === "scheduled" && s.scheduleEndsAt
      ? s.scheduleEndsAt
      : horizon;
  }

  recordPresence(s, uid, eventId) {
    const id = `${eventId}_${uid}`;
    if (this.roomPresences.some((r) => r.id === id)) return;
    this.roomPresences.push({
      id,
      eventId,
      sessionId: s.id,
      roomId: s.room.id,
      uid,
      checkedInAt: this.clock(),
      expiresAt: this.presenceExpiry(s),
      checkedOutAt: null,
    });
  }

  presenceActive(r) {
    return !r.checkedOutAt && this.clock() < r.expiresAt;
  }

  // Idempotent; the target must be a specific record owned by the caller.
  checkoutPresence(uid, presenceId) {
    const r = this.roomPresences.find(
      (x) => x.id === presenceId && x.uid === uid,
    );
    if (!r) throw new Error("PRESENCE_NOT_FOUND");
    if (!r.checkedOutAt) {
      r.checkedOutAt = this.clock();
      this.log("presence", this.getUser(uid), "Checked out of room", {
        presenceId,
      });
    }
    return r;
  }

  occupancyFor(user) {
    const sessions = new Map(this.sessions.map((s) => [s.id, s]));
    const rooms = new Map();
    for (const r of this.roomPresences) {
      if (!this.presenceActive(r)) continue;
      const s = sessions.get(r.sessionId);
      if (user.role !== "dev" && s?.teacherId !== user.id) continue;
      if (!rooms.has(r.roomId)) rooms.set(r.roomId, new Set());
      rooms.get(r.roomId).add(r.uid);
    }
    const scope = user.role === "dev" ? "all-sessions" : "your-sessions";
    return this.classrooms
      .map((c) => ({
        roomId: c.id,
        roomName: c.name,
        configuredSeats: c.capacity ?? null,
        estimated: rooms.get(c.id)?.size || 0,
        scope,
      }))
      .filter((o) => o.estimated > 0 || user.role === "dev");
  }

  getStats() {
    const verifiedCount = this.attempts.filter(
      (a) => a.decision === "VERIFIED",
    ).length;
    const suspiciousCount = this.attempts.filter(
      (a) => a.decision === "SUSPICIOUS",
    ).length;
    const rejectedCount = this.attempts.filter(
      (a) => a.decision === "REJECTED",
    ).length;
    const totalAttempts = this.attempts.length;
    const passRate =
      totalAttempts > 0 ? Math.round((verifiedCount / totalAttempts) * 100) : 0;

    return {
      totalSessions: this.sessions.length,
      activeSessions: this.sessions.filter(
        (s) => s.open && this.clock() < s.closesAt,
      ).length,
      totalAttempts,
      verifiedCount,
      suspiciousCount,
      rejectedCount,
      passRate,
      totalStudents: this.users.filter((u) => u.role === "student").length,
      totalTeachers: this.users.filter((u) => u.role === "admin").length,
      totalClassrooms: this.classrooms.length,
      totalSchedules: this.schedules.length,
      totalLogs: this.logs.length,
    };
  }

  reset(actor = null) {
    if (this.connected) throw new Error("DISABLED_IN_CONNECTED_MODE");
    const credentials = new Map(this.users.map((u) => [u.id, u.passwordHash]));
    this.users = structuredClone(defaultPeople).map((u) => ({
      ...u,
      passwordHash: credentials.get(u.id),
    }));
    this.reviewPhotos.clear();
    this.classrooms = structuredClone(defaultClassrooms);
    this.schedules = structuredClone(defaultSchedules);
    this.sessions = [];
    this.attempts = [];
    this.attendance = [];
    this.roomPresences = [];
    this.logs = [];
    this.log("system", actor, "Reset system state to factory defaults");
    this.save();
    return { ok: true, resetAt: this.clock() };
  }

  // Pure read: derives the effect of evidence expiry from the clock; mutation
  // happens only in expireReviewPhotos() (timer, review, submit).
  evidenceLive(id) {
    const p = this.reviewPhotos.get(id);
    return Boolean(p) && this.clock() < p.expiresAt;
  }

  snapshot(user) {
    const isAdmin = user.role === "admin";
    const isDev = user.role === "dev";

    let visibleSchedules = [];
    let visibleSessions = [];
    let visibleAttempts = [];
    let visibleAttendance = [];

    if (isDev) {
      visibleSchedules = this.schedules;
      visibleSessions = this.sessions;
      visibleAttempts = this.attempts;
      visibleAttendance = this.attendance;
    } else if (isAdmin) {
      // Teacher only sees schedules they teach
      visibleSchedules = this.schedules.filter((s) => s.teacherId === user.id);
      // Teacher only sees sessions for their classes
      visibleSessions = this.sessions.filter(
        (s) =>
          s.teacherId === user.id ||
          visibleSchedules.some((sc) => sc.id === s.scheduleId),
      );
      const teacherSessionIds = new Set(visibleSessions.map((s) => s.id));
      // Teacher only sees attempts for their sessions (no cross-class mixup!)
      visibleAttempts = this.attempts.filter((a) =>
        teacherSessionIds.has(a.sessionId),
      );
      // Teacher only sees attendance records for their sessions
      visibleAttendance = this.attendance.filter((rec) =>
        teacherSessionIds.has(rec.sessionId),
      );
    } else {
      // Student only sees enrolled schedules
      visibleSchedules = this.listSchedules(user.id);
      // Student sees open sessions or sessions where they have an attempt
      visibleSessions = this.sessions.filter(
        (s) =>
          (s.open && visibleSchedules.some((sc) => sc.id === s.scheduleId)) ||
          this.attempts.some((a) => a.sessionId === s.id && a.uid === user.id),
      );
      // Student only sees their own attempts
      visibleAttempts = this.attempts.filter((a) => a.uid === user.id);
      // Student only sees their own attendance records
      visibleAttendance = this.attendance.filter((rec) => rec.uid === user.id);
    }

    return {
      people:
        isAdmin || isDev
          ? this.users
          : this.users.filter((u) => u.id === user.id || u.role === "admin"),
      serverTime: this.clock(),
      classrooms: this.classrooms,
      schedules: visibleSchedules,
      sessions: visibleSessions.map(({ challenges, ...s }) => ({
        ...s,
        challenge: isAdmin || isDev ? challenges.at(-1) : undefined,
      })),
      attempts: visibleAttempts.map((a) => {
        const expired =
          a.phase === "AWAITING_REVIEW" && !this.evidenceLive(a.id);
        return {
          ...a,
          ...(expired
            ? {
                phase: "RETRY",
                eligibleForReview: false,
                reasons: ["REVIEW_PHOTO_EXPIRED_RECAPTURE"],
              }
            : {}),
          photo:
            (isAdmin || isDev) && this.evidenceLive(a.id)
              ? this.reviewPhotos.get(a.id).photo
              : undefined,
        };
      }),
      attendance: visibleAttendance,
      myPresence:
        isDev || isAdmin
          ? undefined
          : this.roomPresences
              .filter((r) => r.uid === user.id)
              .map((r) => ({ ...r, active: this.presenceActive(r) })),
      occupancy: isAdmin || isDev ? this.occupancyFor(user) : undefined,
      logs: isDev ? this.logs.slice(0, 100) : undefined,
      stats: isDev ? this.getStats() : undefined,
    };
  }
}
