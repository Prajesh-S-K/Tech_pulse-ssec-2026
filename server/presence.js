import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
export function loadPresenceConfig(path) {
  if (!path) return null;
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (
    !/^[a-zA-Z0-9_-]{1,32}$/.test(config.deviceId) ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(config.roomId) ||
    !/^[a-f0-9]{64}$/.test(config.secret)
  )
    throw Error("INVALID_PRESENCE_CONFIG");
  return config;
}
export function signPresence(kind, payload, secret) {
  return createHmac("sha256", secret)
    .update(`${kind}|${payload}`)
    .digest("hex");
}
export function constantEqual(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  );
}
export class PresenceService {
  constructor(config = null, clock = Date.now) {
    this.config = config;
    this.clock = clock;
  }
  available(roomId) {
    return !!this.config && this.config.roomId === roomId;
  }
  publicStatus() {
    return this.config
      ? {
          configured: true,
          deviceId: this.config.deviceId,
          roomId: this.config.roomId,
          ssid: this.config.ssid,
          portalUrl: "http://192.168.4.1",
        }
      : { configured: false };
  }
  issue(attempt, roomId) {
    if (!this.available(roomId))
      throw Error("PRESENCE_DEVICE_NOT_CONFIGURED_FOR_ROOM");
    if (attempt.decision === "VERIFIED")
      throw Error("ATTEMPT_ALREADY_VERIFIED");
    if (this.clock() > attempt.deadline)
      throw Error("COMPLETION_WINDOW_ELAPSED");
    const request = attempt.presenceRequest;
    if (!request) {
      const nonce = randomBytes(16).toString("hex");
      const expires = attempt.deadline + 15000;
      attempt.presenceRequest = {
        payload: `${attempt.id}.${nonce}.${expires}.${this.config.deviceId}`,
        expires,
      };
    }
    const payload = attempt.presenceRequest.payload;
    return {
      ...this.publicStatus(),
      requestCode: `${payload}.${signPresence("request", payload, this.config.secret)}`,
      expiresAt: attempt.presenceRequest.expires,
    };
  }
  verify(attempt, roomId, proof) {
    if (!this.available(roomId)) return "unavailable";
    if (!proof) return "unavailable";
    if (
      typeof proof !== "string" ||
      proof.length > 250 ||
      !attempt.presenceRequest
    )
      return "invalid";
    const parts = proof.trim().split(".");
    if (parts.length !== 5) return "invalid";
    const payload = parts.slice(0, 4).join(".");
    if (
      payload !== attempt.presenceRequest.payload ||
      this.clock() > attempt.presenceRequest.expires
    )
      return "invalid";
    return constantEqual(
      parts[4],
      signPresence("proof", payload, this.config.secret),
    )
      ? "verified"
      : "invalid";
  }
}
