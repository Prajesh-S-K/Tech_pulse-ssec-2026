import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
export function hashPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 10 ||
    password.length > 128
  )
    throw Error("PASSWORD_MUST_BE_10_TO_128_CHARACTERS");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}
export function verifyPassword(password, encoded) {
  if (
    typeof password !== "string" ||
    password.length > 128 ||
    typeof encoded !== "string"
  )
    return false;
  const [salt, hash] = encoded.split(":");
  if (!salt || !hash || hash.length !== 64) return false;
  try {
    return timingSafeEqual(
      scryptSync(password, salt, 32),
      Buffer.from(hash, "hex"),
    );
  } catch {
    return false;
  }
}
export function publicData(value) {
  if (Array.isArray(value)) return value.map(publicData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            ![
              "password",
              "passwordHash",
              "passwordSalt",
              "credential",
            ].includes(k),
        )
        .map(([k, v]) => [k, publicData(v)]),
    );
  return value;
}
export const FIXTURE_PASSWORD = "fixture-password-only";
export const FIXTURE_HASH = hashPassword(FIXTURE_PASSWORD);
