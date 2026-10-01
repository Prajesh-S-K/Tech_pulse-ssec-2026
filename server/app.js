import express from "express";
import { randomUUID } from "node:crypto";
import { publicData, verifyPassword } from "./auth.js";
import { DemoStore } from "./store.js";
import { takeSnapshot, restoreSnapshot } from "./snapshot.js";

export function createApp(store = new DemoStore(), options = {}) {
  const app = express(),
    tokens = new Map(),
    clients = new Set();

  // Connected (Firebase) mode: { gateway, mutate, webConfig }. Absent = local mode.
  const connected = options.connected || null;
  // Every state change goes through mutate(): connected mode commits to Firestore;
  // local mode rolls back the whole store if the disk write fails.
  const mutate =
    connected?.mutate ||
    (async (fn) => {
      const snap = takeSnapshot(store);
      try {
        const result = fn();
        store.assertDurable();
        return result;
      } catch (e) {
        restoreSnapshot(store, snap);
        if (e?.code === "PERSISTENCE_FAILED") store.save();
        throw e;
      }
    });
  // Reads never see an uncommitted result.
  const readState = connected?.read || (async (fn) => fn());
  const snapshotFor = (user) =>
    readState(() => publicData(store.snapshot(user)));
  const SESSION_MAX_MS = 8 * 60 * 60 * 1000;
  // Snapshot push interval (also refreshes time-based state such as evidence expiry).
  const SSE_MS = Number(process.env.TP_SSE_INTERVAL_MS) || 15000;

  const publicOrigin = options.publicOrigin || process.env.PUBLIC_ORIGIN;
  if (
    publicOrigin &&
    (new URL(publicOrigin).protocol !== "https:" ||
      new URL(publicOrigin).origin !== publicOrigin)
  )
    throw Error("PUBLIC_ORIGIN_MUST_BE_HTTPS_ORIGIN");
  if (publicOrigin)
    app.set(
      "trust proxy",
      options.trustProxy || process.env.TRUST_PROXY || "loopback",
    );
  app.use((req, res, next) => {
    const send = res.json.bind(res);
    res.json = (value) => send(publicData(value));
    next();
  });
  const issue = (user, expiresAt = store.clock() + SESSION_MAX_MS) => {
    const token = randomUUID();
    tokens.set(token, { uid: user.id, expiresAt });
    return { token, user, expiresAt };
  };
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));

  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const origin = req.get("origin");
    const localHost = /^(127\.0\.0\.1|localhost)$/.test(req.hostname || "");
    if (
      !localHost &&
      (!publicOrigin ||
        req.protocol !== "https" ||
        req.hostname !== new URL(publicOrigin).hostname)
    )
      return res.status(403).json({ error: "HOST_NOT_ALLOWED" });
    const expected =
      publicOrigin && !localHost
        ? publicOrigin
        : `${req.protocol}://${req.get("host")}`;
    if (origin && origin !== expected)
      return res.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
    next();
  });

  const sendTo = async (c) => {
    const entry = tokens.get(c.token);
    if (!entry || store.clock() >= entry.expiresAt) {
      c.res.end();
      clients.delete(c);
      return;
    }
    const user = store.getUser(entry.uid);
    if (!user) {
      c.res.end();
      clients.delete(c);
      return;
    }
    try {
      c.res.write(`data: ${JSON.stringify(await snapshotFor(user))}\n\n`);
    } catch {}
  };
  const emit = () => {
    for (const c of [...clients]) sendTo(c);
  };

  const fail = (res, e) =>
    e?.code === "PERSISTENCE_FAILED"
      ? res.status(503).json({ error: "PERSISTENCE_FAILED", retryable: true })
      : res.status(400).json({ error: e.message });

  const action = (fn) => async (req, res) => {
    try {
      const ctx = { warnings: [] };
      const result = await mutate(() => fn(req), ctx);
      emit();
      const out = result ?? { ok: true };
      res.json(
        ctx.warnings.length && !Array.isArray(out)
          ? { ...out, warnings: ctx.warnings }
          : out,
      );
    } catch (e) {
      fail(res, e);
    }
  };

  app.get("/api/config", (_, res) =>
    res.json(
      connected
        ? {
            mode: "firebase",
            firebase: {
              web: connected.webConfig,
              authEmulatorUrl: connected.authEmulatorUrl,
            },
          }
        : { mode: "local" },
    ),
  );

  // Connected mode: exchange a verified Firebase ID token for a revocable server
  // session bound to the Firebase UID. The session can never outlive eight hours
  // from the ORIGINAL Firebase sign-in (auth_time), however often tokens refresh.
  app.post("/api/session/exchange", async (req, res) => {
    if (!connected)
      return res.status(404).json({ error: "NOT_CONNECTED_MODE" });
    let decoded;
    try {
      decoded = await connected.gateway.verifyIdToken(req.body?.idToken);
    } catch {
      return res.status(401).json({ error: "INVALID_ID_TOKEN" });
    }
    const expiresAt = Number(decoded.auth_time) * 1000 + SESSION_MAX_MS;
    if (!Number.isFinite(expiresAt) || store.clock() >= expiresAt)
      return res.status(401).json({ error: "SESSION_EXPIRED" });
    try {
      const user = await mutate(() =>
        store.provisionExternalUser({
          uid: decoded.uid,
          email: decoded.email,
          name: req.body?.name,
        }),
      );
      emit();
      res.json(issue(user, expiresAt));
    } catch (e) {
      fail(res, e);
    }
  });

  // Public Endpoints
  app.get("/api/demo-accounts", (_, res) =>
    res.json(
      connected
        ? []
        : store.listDemoAccounts().map(({ referencePhoto, ...u }) => u),
    ),
  );

  const localOnly = (req, res, next) =>
    connected ? res.status(400).json({ error: "LOCAL_AUTH_DISABLED" }) : next();

  app.post("/api/register", localOnly, async (req, res) => {
    try {
      const user = await mutate(() => store.createUser(req.body));
      emit();
      res.json(issue(user));
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/login", localOnly, (req, res) => {
    const users = store.listUsers();
    const query = (req.body.id || req.body.email || "").trim().toLowerCase();
    const user = users.find(
      (p) =>
        p.id.toLowerCase() === query ||
        (p.email && p.email.toLowerCase() === query) ||
        (p.roll && p.roll.toLowerCase() === query),
    );
    if (!user || !verifyPassword(req.body.password, user.passwordHash))
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    store.log(
      "auth",
      user,
      `User signed in: ${user.name} (${user.role.toUpperCase()})`,
    );
    res.json(issue(user));
  });

  // Auth Middleware
  app.use("/api", (req, res, next) => {
    req.token = req.get("authorization")?.replace("Bearer ", "");
    const entry = tokens.get(req.token);
    if (!entry || store.clock() >= entry.expiresAt) {
      tokens.delete(req.token);
      return res
        .status(401)
        .json({ error: entry ? "SESSION_EXPIRED" : "SIGN_IN_REQUIRED" });
    }
    req.user = store.getUser(entry.uid);
    if (!req.user) return res.status(401).json({ error: "SIGN_IN_REQUIRED" });
    next();
  });

  app.post("/api/logout", (req, res) => {
    tokens.delete(req.token);
    for (const c of clients)
      if (c.token === req.token) {
        c.res.end();
        clients.delete(c);
      }
    res.json({ ok: true });
  });

  const canAdmin = (req, res, next) =>
    req.user.role === "admin" || req.user.role === "dev"
      ? next()
      : res.status(403).json({ error: "ADMIN_REQUIRED" });

  const canDev = (req, res, next) =>
    req.user.role === "dev"
      ? next()
      : res.status(403).json({ error: "DEV_REQUIRED" });

  app.get("/api/presence/status", (req, res) =>
    res.json(store.presence.publicStatus()),
  );
  app.post(
    "/api/attempts/:id/presence-request",
    action((req) => store.presenceRequest(req.user.id, req.params.id)),
  );

  // Student & Faculty Directory - strictly Teacher and Dev only!
  app.get("/api/people", canAdmin, (req, res) =>
    res.json(store.listUsers(req.user)),
  );

  app.get("/api/state", async (req, res) =>
    res.json(await snapshotFor(req.user)),
  );

  app.get("/api/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive" });
    res.flushHeaders();
    const c = { res, user: req.user, token: req.token };
    clients.add(c);
    sendTo(c);
    const timer = setInterval(() => {
      const auth = tokens.get(c.token);
      if (!auth || store.clock() >= auth.expiresAt) {
        res.end();
        clients.delete(c);
        return;
      }
      sendTo(c);
    }, SSE_MS);
    req.on("close", () => {
      clearInterval(timer);
      clients.delete(c);
    });
  });

  // User Profile (for all roles)
  app.get("/api/profile", (req, res) => res.json(store.getUser(req.user.id)));
  app.put(
    "/api/profile",
    action((req) => {
      // Connected mode: the email is the Firebase identity and is not editable here.
      const { email, ...rest } = req.body || {};
      return store.updateUser(
        req.user.id,
        connected ? rest : req.body,
        req.user,
      );
    }),
  );
  app.post(
    "/api/people/:uid/role",
    canDev,
    action((req) =>
      store.setUserRole(req.params.uid, req.body?.role, req.user),
    ),
  );
  app.post(
    "/api/profile/photo",
    action((req) =>
      store.updateProfilePhoto(req.user.id, req.body.photo, req.user),
    ),
  );

  // Classrooms / Geo Locations (strictly Teacher and Dev only!)
  app.get("/api/classrooms", (_, res) => res.json(store.listClassrooms()));
  app.post(
    "/api/classrooms",
    canAdmin,
    action((req) => store.createClassroom(req.body, req.user)),
  );
  app.put(
    "/api/classrooms/:id",
    canAdmin,
    action((req) => store.updateClassroom(req.params.id, req.body, req.user)),
  );
  app.delete(
    "/api/classrooms/:id",
    canAdmin,
    action((req) => store.deleteClassroom(req.params.id, req.user)),
  );

  // Schedules / Timetables (All roles can create; delete/edit requires teacher permission)
  app.get("/api/schedules", (req, res) =>
    res.json(store.listSchedules(req.user.id)),
  );
  app.post(
    "/api/schedules",
    action((req) => store.createSchedule(req.body, req.user)),
  );
  app.put(
    "/api/schedules/:id",
    action((req) => store.updateSchedule(req.params.id, req.body, req.user)),
  );
  app.delete(
    "/api/schedules/:id",
    action((req) => store.deleteSchedule(req.params.id, req.user)),
  );

  // Sessions & Attendance (Teacher & Dev)
  app.post(
    "/api/sessions",
    canAdmin,
    action((req) => store.start(req.body, req.user)),
  );
  app.post(
    "/api/sessions/:id/replace-without-esp32",
    canAdmin,
    action((req) => store.replaceWithoutEsp32(req.params.id, req.user)),
  );
  app.post(
    "/api/sessions/:id/rotate",
    canAdmin,
    action((req) => store.rotate(req.params.id, req.user)),
  );
  app.post(
    "/api/sessions/:id/stop",
    canAdmin,
    action((req) => store.stop(req.params.id, req.user)),
  );
  app.post(
    "/api/sessions/:id/venue",
    canAdmin,
    action((req) =>
      store.updateSessionVenue(req.params.id, req.body, req.user),
    ),
  );
  app.post(
    "/api/claim",
    action((req) =>
      store.claim(req.user.id, req.body.challengeId, req.body.classId),
    ),
  );
  app.post(
    "/api/presence/:id/checkout",
    action((req) => store.checkoutPresence(req.user.id, req.params.id)),
  );
  app.post(
    "/api/attempts/:id/submit",
    action((req) => store.submit(req.user.id, req.params.id, req.body)),
  );

  app.post(
    "/api/attempts/:id/review",
    canAdmin,
    action((req) => store.review(req.params.id, req.body.decision, req.user)),
  );

  // Dev & System Endpoints
  app.get("/api/dev/logs", canDev, (_, res) => res.json(store.logs));
  app.post(
    "/api/dev/logs/clear",
    canDev,
    action((req) => {
      store.logs = [];
      store.save();
      return { ok: true };
    }),
  );
  app.get("/api/dev/stats", canDev, (_, res) => res.json(store.getStats()));
  app.post(
    "/api/dev/reset",
    canDev,
    action((req) => store.reset(req.user)),
  );
  app.get("/api/dev/export", canDev, (_, res) =>
    res.json({
      users: store.users,
      classrooms: store.classrooms,
      schedules: store.schedules,
      sessions: store.sessions,
      attempts: store.attempts.map(({ photo, ...a }) => a),
      attendance: store.attendance,
      logs: store.logs,
      exportedAt: store.clock(),
    }),
  );
  app.use("/api", (_, res) => res.status(404).json({ error: "NOT_FOUND" }));
  app.use((err, req, res, next) =>
    res.status(400).json({ error: "INVALID_REQUEST" }),
  );

  return app;
}
