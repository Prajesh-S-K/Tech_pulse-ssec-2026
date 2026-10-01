// Firestore persistence for connected mode. Never writes passwords, hashes,
// submitted photos, enrolled reference photos or ESP32 signing keys.
export const COLLECTIONS = [
  "users",
  "classrooms",
  "schedules",
  "sessions",
  "attempts",
  "attendance",
  "roomPresences",
];
const NEVER_STORE = [
  "password",
  "passwordHash",
  "passwordSalt",
  "credential",
  "photo",
  "referencePhoto",
  "secret",
];
const MAX_OPS = 450;

export class PersistenceError extends Error {
  constructor(cause) {
    super("PERSISTENCE_FAILED", { cause });
    this.code = "PERSISTENCE_FAILED";
  }
}

export function sanitize(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc))
    if (!NEVER_STORE.includes(k)) out[k] = v;
  return JSON.parse(JSON.stringify(out));
}

export class FirestoreRepository {
  constructor(db) {
    this.db = db;
  }

  async loadAll() {
    const data = {};
    for (const col of COLLECTIONS) {
      const snap = await this.db.collection(col).get();
      data[col] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    }
    return data;
  }

  // changes: [{ op: "create" | "set" | "delete", col, id, data? }]. One transaction, so the
  // attempt result and the unique attendance/presence records succeed or fail together.
  // Returns { retained }: documents a "create" found already present and therefore kept
  // as they were, so the caller can align its cache with what is actually durable.
  async commit(changes) {
    if (!changes.length) return { retained: [] };
    if (changes.length > MAX_OPS)
      throw new PersistenceError(new Error("CHANGESET_TOO_LARGE"));
    try {
      return await this.db.runTransaction(async (tx) => {
        const refs = changes.map((c) => this.db.collection(c.col).doc(c.id));
        // Every read happens before the first write (Firestore requirement).
        const existing = await Promise.all(
          changes.map((c, i) => (c.op === "create" ? tx.get(refs[i]) : null)),
        );
        const retained = [];
        changes.forEach((c, i) => {
          if (c.op === "delete") return tx.delete(refs[i]);
          // "create" = first writer wins (deterministic attendance/presence ids);
          // "set" = authorised update, e.g. a checkout.
          if (c.op === "create" && existing[i]?.exists) {
            retained.push({
              col: c.col,
              id: c.id,
              data: { ...existing[i].data(), id: c.id },
            });
            return;
          }
          tx.set(refs[i], c.data);
        });
        return { retained };
      });
    } catch (e) {
      throw new PersistenceError(e);
    }
  }
}
