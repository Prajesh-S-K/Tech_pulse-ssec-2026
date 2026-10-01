// Resolves local vs connected mode and validates Firebase configuration.
// No silent fallback: an invalid connected-mode configuration is a hard error.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  checkServiceAccount,
  FIREBASE_PROJECT,
} from "../../scripts/lib/serviceAccount.js";

const WEB_FIELDS = ["apiKey", "authDomain", "projectId", "appId"];

export function readRuntime(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("RUNTIME_CONFIG_INVALID_JSON");
  }
}

export function resolveMode(runtime, env = process.env) {
  const mode = env.AUTH_MODE || runtime.mode || "local";
  if (!["local", "firebase"].includes(mode))
    throw new Error(`AUTH_MODE_INVALID:${mode}`);
  return mode;
}

export function validateFirebaseConfig(
  runtime,
  rootDir,
  { emulator = false } = {},
) {
  const fb = runtime.firebase || {};
  const web = fb.web || {};
  const problems = [];
  for (const k of WEB_FIELDS)
    if (!web[k]) problems.push(`firebase.web.${k} missing`);
  const projectId = web.projectId;
  if (!emulator && projectId && projectId !== FIREBASE_PROJECT)
    problems.push(`firebase.web.projectId must be ${FIREBASE_PROJECT}`);
  let serviceAccountPath = null;
  if (!emulator) {
    const rel =
      fb.serviceAccountPath || "private/firebase-service-account.json";
    serviceAccountPath = isAbsolute(rel) ? rel : resolve(rootDir, rel);
    const check = checkServiceAccount(
      serviceAccountPath,
      projectId || FIREBASE_PROJECT,
    );
    if (!check.ok) problems.push(`service account: ${check.problem}`);
  }
  if (problems.length)
    throw new Error(`FIREBASE_CONFIG_INVALID: ${problems.join("; ")}`);
  return { web, projectId, serviceAccountPath };
}
