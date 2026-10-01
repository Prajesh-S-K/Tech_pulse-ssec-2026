// Pure policy: device/transport failures never become cheating verdicts.
export function distanceMeters(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat),
    dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function evaluate({ location, photo, localProof }, room, presenceMode) {
  const pending = (reason, extra = {}) => ({
    decision: null,
    phase: "RETRY",
    reasons: [reason],
    ...extra,
  });
  if (
    !location ||
    !["lat", "lng", "accuracy"].every((k) => Number.isFinite(location[k])) ||
    Math.abs(location.lat) > 90 ||
    Math.abs(location.lng) > 180 ||
    location.accuracy < 0
  )
    return pending("LOCATION_REQUIRED");

  const maxAcc = room.maxAccuracy ?? 100;
  const distance = distanceMeters(room, location);

  if (location.accuracy > maxAcc)
    return pending("GPS_UNCERTAIN", { distance, accuracy: location.accuracy });

  // Definitively outside: even the most optimistic accuracy boundary is outside the geofence
  if (distance - location.accuracy > room.radius)
    return {
      decision: "REJECTED",
      phase: "COMPLETED",
      reasons: ["OUTSIDE_GEOFENCE"],
      distance,
      accuracy: location.accuracy,
    };

  // Measured position is outside the radius, but accuracy circle touches the room
  if (distance > room.radius)
    return pending("GEOFENCE_BOUNDARY_UNCERTAIN", {
      distance,
      accuracy: location.accuracy,
    });

  // Measured position is inside the room, but right at the boundary edge (outer 20%) and error circle spills out
  if (
    distance > room.radius * 0.8 &&
    distance + location.accuracy > room.radius
  )
    return pending("GEOFENCE_BOUNDARY_UNCERTAIN", {
      distance,
      accuracy: location.accuracy,
    });

  if (!photo)
    return pending("PHOTO_REQUIRED", { distance, accuracy: location.accuracy });
  if (presenceMode === "local") {
    if (localProof === "invalid")
      return {
        decision: "SUSPICIOUS",
        phase: "COMPLETED",
        reasons: ["LOCAL_PROOF_INVALID"],
        distance,
        accuracy: location.accuracy,
      };
    if (localProof !== "verified")
      return pending("LOCAL_PROOF_UNAVAILABLE", {
        distance,
        accuracy: location.accuracy,
      });
  }
  return {
    decision: "VERIFIED",
    phase: "COMPLETED",
    reasons: [presenceMode === "local" ? "LOCAL_EVIDENCE" : "REDUCED_EVIDENCE"],
    distance,
    accuracy: location.accuracy,
  };
}
