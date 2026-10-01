// Bridges the synchronous DemoStore (authoritative in-memory cache) to Firestore.
// Every mutation: serialise -> run on cache -> diff -> transactional commit.
// If the commit fails the cache is rolled back and evidence photos restored, so
// nothing is ever reported (or cached) as approved without durable persistence.
// Reads go through the same queue, so nobody observes an uncommitted result.
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
import { COLLECTIONS, sanitize } from "./repository.js";
import { takeSnapshot, restoreSnapshot } from "../snapshot.js";

// Collections whose first write must not be overwritten by a racing duplicate.
const CREATE_ONCE = new Set(["attendance", "roomPresences"]);

export function createSidecar(path) {
  return {
    load(users) {
      if (!path || !existsSync(path)) return;
      try {
        const photos = JSON.parse(readFileSync(path, "utf8"));
        for (const u of users)
          if (photos[u.id]) u.referencePhoto = photos[u.id];
      } catch {}
    },
    save(users) {
      if (!path) return;
      const photos = {};
      for (const u of users)
        if (u.referencePhoto) photos[u.id] = u.referencePhoto;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path + ".tmp", JSON.stringify(photos), { mode: 0o600 });
      renameSync(path + ".tmp", path);
    },
  };
}

export async function createPersistence({ store, repo, sidecar }) {
  let committed = new Map();
  const docsNow = () => {
    const m = new Map();
    for (const col of COLLECTIONS)
      for (const d of store[col])
        m.set(`${col}/${d.id}`, { col, id: d.id, data: sanitize(d) });
    return m;
  };
  const diff = () => {
    const now = docsNow();
    const changes = [];
    for (const [key, v] of now) {
      const before = committed.get(key);
      if (!before)
        changes.push({ op: CREATE_ONCE.has(v.col) ? "create" : "set", ...v });
      else if (JSON.stringify(before.data) !== JSON.stringify(v.data))
        changes.push({ op: "set", ...v });
    }
    for (const [key, v] of committed)
      if (!now.has(key)) changes.push({ op: "delete", col: v.col, id: v.id });
    return { changes, now };
  };
  const flush = async (ctx) => {
    const { changes, now } = diff();
    if (changes.length) {
      const result = await repo.commit(changes);
      // A create that found an existing document kept it. Adopt the durable version so
      // the cache never advances to a record Firestore retained differently.
      for (const r of result?.retained ?? []) {
        const i = store[r.col].findIndex((d) => d.id === r.id);
        if (i >= 0) store[r.col][i] = r.data;
      }
      committed = docsNow();
    }
    // Firestore is already durable here, so a failure of the private reference
    // photo file is reported as a warning and NEVER rolls the commit back.
    try {
      sidecar?.save(store.users);
    } catch {
      ctx?.warnings?.push("REFERENCE_PHOTO_NOT_SAVED_LOCALLY");
    }
  };

  let chain = Promise.resolve();
  const enqueue = (job) => {
    const run = chain.then(job);
    chain = run.catch(() => {});
    return run;
  };
  const mutate = (fn, ctx) =>
    enqueue(async () => {
      const snap = takeSnapshot(store);
      try {
        const result = fn();
        await flush(ctx);
        return result;
      } catch (e) {
        restoreSnapshot(store, snap);
        throw e;
      }
    });
  const read = (fn) => enqueue(async () => fn());

  store.hydrate(await repo.loadAll());
  sidecar?.load(store.users);
  committed = docsNow();
  // Evidence photos live only in memory: pending reviews cannot survive a restart.
  await mutate(() => {
    for (const a of store.attempts)
      if (a.phase === "AWAITING_REVIEW") {
        a.phase = "RETRY";
        a.eligibleForReview = false;
        a.reasons = ["REVIEW_EVIDENCE_LOST_RECAPTURE"];
      }
  });
  return { mutate, read };
}
