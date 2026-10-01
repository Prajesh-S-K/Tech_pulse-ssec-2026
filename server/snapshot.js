// In-memory rollback shared by local and connected modes: a mutation that cannot
// be made durable must leave the complete store unchanged.
export const STATE_KEYS = [
  "users",
  "classrooms",
  "schedules",
  "sessions",
  "attempts",
  "attendance",
  "roomPresences",
];

export function takeSnapshot(store) {
  return {
    ...Object.fromEntries(
      STATE_KEYS.map((k) => [k, structuredClone(store[k])]),
    ),
    reviewPhotos: new Map(store.reviewPhotos),
  };
}

export function restoreSnapshot(store, snap) {
  for (const k of STATE_KEYS) store[k] = snap[k];
  store.reviewPhotos = snap.reviewPhotos;
}
