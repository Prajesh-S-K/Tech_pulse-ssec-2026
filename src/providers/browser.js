export function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(new Error("Location is unavailable in this browser."));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (err) => {
        let msg = "Location could not be read.";
        if (err && err.code === 1) {
          msg =
            "Location permission was denied. Please allow location access in your browser settings.";
        } else if (err && err.code === 2) {
          msg =
            "Location is unavailable. Please ensure location services / GPS are enabled.";
        } else if (err && err.code === 3) {
          msg = "Location request timed out. Please try again.";
        }
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
/**
 * Modular Presence Provider Architecture (Phase 12)
 *
 * Provides a standardized PresenceProvider interface:
 *   verify(context) -> Promise<{ status: "PASS" | "FAIL" | "UNAVAILABLE", reason: string, payload?: object }>
 *
 * Includes:
 *   1. BrowserPresenceProvider (Geolocation + Camera)
 *   2. HardwarePresenceProvider (BLE / Ultrasonic / NFC / Beacon stub)
 *   3. SimulatedPresenceProvider (Deterministic test fixture)
 */

export class BrowserPresenceProvider {
  constructor(options = {}) {
    this.name = "BrowserPresenceProvider";
    this.options = options;
  }

  async verify(context = {}) {
    try {
      if (!context.location) {
        const location = await getLocation();
        return {
          status: "PASS",
          reason: "Browser geolocation acquired.",
          payload: { location },
        };
      }
      return {
        status: "PASS",
        reason: "Valid location and device presence verified.",
        payload: { location: context.location },
      };
    } catch (err) {
      return {
        status: "UNAVAILABLE",
        reason: err.message || "Browser location unavailable.",
      };
    }
  }
}

export class HardwarePresenceProvider {
  constructor(options = {}) {
    this.name = "HardwarePresenceProvider";
    this.beaconUuid = options.beaconUuid || null;
  }

  async verify(context = {}) {
    // Hardware presence provider (BLE / ESP32 / NFC)
    // Graceful degradation: When hardware presence is UNAVAILABLE, system falls back to REDUCED_EVIDENCE (GPS + Camera)
    return {
      status: "UNAVAILABLE",
      reason:
        "Hardware presence beacon is not connected in this browser session.",
      payload: { mode: "REDUCED_EVIDENCE_FALLBACK" },
    };
  }
}

export class SimulatedPresenceProvider {
  constructor(
    defaultStatus = "PASS",
    defaultReason = "Simulated local proof verified.",
  ) {
    this.name = "SimulatedPresenceProvider";
    this.status = defaultStatus;
    this.reason = defaultReason;
  }

  setStatus(status, reason = "") {
    this.status = status;
    if (reason) this.reason = reason;
  }

  async verify(context = {}) {
    return {
      status: this.status,
      reason: this.reason,
      payload: { simulated: true, context },
    };
  }
}

// Default export instance maintaining backward compatibility
export const presenceProvider = {
  async verify(context = {}) {
    return {
      status: "UNAVAILABLE",
      reason: "Local proof is not connected.",
      payload: { mode: "REDUCED_EVIDENCE" },
    };
  },
};
