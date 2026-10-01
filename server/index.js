import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import express from "express";
import { loadPresenceConfig } from "./presence.js";
import { existsSync } from "node:fs";
import { DemoStore } from "./store.js";
import {
  readRuntime,
  resolveMode,
  validateFirebaseConfig,
} from "./firebase/config.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const runtime = process.env.TP_IGNORE_RUNTIME
  ? {}
  : readRuntime(
      process.env.RUNTIME_CONFIG ||
        fileURLToPath(new URL("../private/runtime.json", import.meta.url)),
    );
const mode = resolveMode(runtime);
const configPath =
  process.env.PRESENCE_CONFIG ||
  fileURLToPath(new URL("../private/presence.json", import.meta.url));
const presenceConfig = existsSync(configPath)
  ? loadPresenceConfig(configPath)
  : null;

let store;
let connected = null;
let cleanup;
if (mode === "firebase") {
  // Connected mode never falls back to local identities: invalid config is fatal.
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  let cfg;
  try {
    cfg = validateFirebaseConfig(runtime, rootDir, { emulator });
  } catch (e) {
    console.error(
      `Connected mode cannot start: ${e.message}\nRun npm run doctor, or start local mode with npm run demo.`,
    );
    process.exit(1);
  }
  const { createFirebaseGateway } = await import("./firebase/admin.js");
  const { FirestoreRepository } = await import("./firebase/repository.js");
  const { createPersistence, createSidecar } =
    await import("./firebase/persistence.js");
  const gateway = createFirebaseGateway({
    projectId: cfg.projectId,
    serviceAccountPath: cfg.serviceAccountPath,
    emulator,
  });
  store = new DemoStore(Date.now, {
    presenceConfig,
    empty: true,
    reviewTtlMs: Number(process.env.TP_REVIEW_TTL_MS) || undefined,
  });
  const persistence = await createPersistence({
    store,
    repo: new FirestoreRepository(gateway.db),
    sidecar: createSidecar(
      process.env.REFERENCE_PHOTO_PATH ||
        fileURLToPath(new URL("./data/reference-photos.json", import.meta.url)),
    ),
  });
  connected = {
    gateway,
    mutate: persistence.mutate,
    read: persistence.read,
    webConfig: cfg.web,
    // Test-only: lets the browser SDK talk to the local Auth emulator.
    authEmulatorUrl: process.env.FIREBASE_AUTH_EMULATOR_HOST
      ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`
      : undefined,
  };
  cleanup = setInterval(
    () => persistence.mutate(() => store.expireReviewPhotos()).catch(() => {}),
    60000,
  );
  console.log(
    `CONNECTED mode: Firebase project ${cfg.projectId}${emulator ? " (EMULATOR)" : ""}`,
  );
} else {
  const persistPath =
    process.env.STORE_PATH ||
    fileURLToPath(new URL("./data/store.json", import.meta.url));
  const credentialsPath =
    process.env.CREDENTIALS_PATH ||
    fileURLToPath(
      new URL("../private/account-passwords.json", import.meta.url),
    );
  store = new DemoStore(Date.now, {
    persistPath,
    presenceConfig,
    credentialsPath,
    reviewTtlMs: Number(process.env.TP_REVIEW_TTL_MS) || undefined,
  });
  cleanup = setInterval(() => store.expireReviewPhotos(), 60000);
  console.log(
    "Initial account passwords: private/account-passwords.json (keep private)",
  );
}
cleanup.unref();
const app = createApp(store, { connected });
if (process.argv.includes("--production")) {
  const root = fileURLToPath(new URL("../dist/", import.meta.url));
  app.use(express.static(root));
  app.get("/{*path}", (_, res) => res.sendFile(`${root}index.html`));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: {
      middlewareMode: true,
      ...(process.env.TP_NO_HMR ? { hmr: false } : {}),
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 5173);
app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `${mode === "firebase" ? "Connected" : "Local"} demo: http://127.0.0.1:${port}`,
  ),
);
