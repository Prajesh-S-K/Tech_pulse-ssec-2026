// Validates a Firebase Admin service-account file WITHOUT ever returning or
// printing its contents.
import { existsSync, readFileSync, statSync } from "node:fs";

export const FIREBASE_PROJECT = "tech-pulse-ssec";

export function checkServiceAccount(path, expectedProject = FIREBASE_PROJECT) {
  if (!path || !existsSync(path))
    return { ok: false, problem: "file not found" };
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {
      ok: false,
      problem:
        "not valid JSON (the Console's key download is a .json file; a Node snippet beginning with `var admin = require(...)` is not the key)",
    };
  }
  if (json.type !== "service_account")
    return { ok: false, problem: 'JSON does not have type "service_account"' };
  for (const field of ["project_id", "private_key", "client_email"])
    if (typeof json[field] !== "string" || !json[field])
      return { ok: false, problem: `missing field ${field}` };
  if (!json.private_key.includes("BEGIN PRIVATE KEY"))
    return { ok: false, problem: "private_key is not a PEM key" };
  if (json.project_id !== expectedProject)
    return {
      ok: false,
      problem: `belongs to a different project than ${expectedProject}`,
    };
  const mode = statSync(path).mode & 0o777;
  return { ok: true, looseMode: (mode & 0o077) !== 0, mode: mode.toString(8) };
}
