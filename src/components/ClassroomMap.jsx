import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { distanceMeters } from "../domain/trust";
const valid = (r) => Number.isFinite(r?.lat) && Number.isFinite(r?.lng);
const pin = (selected) =>
  L.divIcon({
    className: "room-pin",
    html: `<svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg"><path d="M15 37C12 31 1 22 1 15a14 14 0 0 1 28 0c0 7-11 16-14 22Z" fill="${selected ? "#0f766e" : "#14243b"}" stroke="white" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="white"/></svg>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
  });
export default function ClassroomMap({
  rooms = [],
  selectedId,
  onSelect,
  sessions = [],
  location,
  draft,
  onDraftChange,
  compact = false,
}) {
  const host = useRef(null),
    map = useRef(null),
    layers = useRef(null),
    tiles = useRef(null),
    callbacks = useRef({ onSelect, onDraftChange });
  callbacks.current = { onSelect, onDraftChange };
  const [failed, setFailed] = useState(!navigator.onLine),
    [retry, setRetry] = useState(0);
  const initial = useRef(false),
    lastSelection = useRef(null);
  const visible = rooms.filter(valid),
    selected = visible.find((r) => r.id === selectedId) || visible[0],
    display = draft && valid(draft) ? { ...selected, ...draft } : selected;
  useEffect(() => {
    if (failed || !host.current) return;
    const m = L.map(host.current, { scrollWheelZoom: false });
    map.current = m;
    layers.current = L.layerGroup().addTo(m);
    const t = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    tiles.current = t;
    t.on("tileerror", () => setFailed(true));
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(host.current);
    const offline = () => setFailed(true);
    window.addEventListener("offline", offline);
    return () => {
      resize.disconnect();
      window.removeEventListener("offline", offline);
      m.remove();
      map.current = null;
      layers.current = null;
      initial.current = false;
      lastSelection.current = null;
    };
  }, [failed, retry]);
  const roomKey = JSON.stringify(visible),
    sessionKey = JSON.stringify(
      sessions.map((s) => ({
        id: s.id,
        room: s.room?.id,
        subject: s.subject,
        open: s.open,
        closesAt: s.closesAt,
      })),
    ),
    pointKey = JSON.stringify(location),
    draftKey = JSON.stringify(draft);
  useEffect(() => {
    const m = map.current,
      g = layers.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const original of visible) {
      const r =
        draft && original.id === selectedId
          ? { ...original, ...draft }
          : original;
      const active = sessions.filter(
        (s) => s.open && s.closesAt > Date.now() && s.room?.id === r.id,
      );
      const chosen = r.id === selectedId;
      const color = chosen ? "#0f766e" : "#526176";
      L.circle([r.lat, r.lng], {
        radius: r.radius,
        color,
        weight: chosen ? 2 : 1,
        fillOpacity: 0.09,
      }).addTo(g);
      const marker = L.marker([r.lat, r.lng], {
        icon: pin(chosen),
        draggable: chosen && !!draft,
      });
      const tip = document.createElement("span");
      tip.textContent = r.name;
      marker.bindTooltip(tip);
      const popup = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = r.name;
      popup.append(title);
      const detail = document.createElement("p");
      detail.textContent = `${r.radius}m geofence${active.length ? " · Active session: " + active.map((s) => s.subject).join(", ") : ""}`;
      popup.append(detail);
      marker.bindPopup(popup);
      marker.on("click", () => callbacks.current.onSelect?.(r.id));
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        callbacks.current.onDraftChange?.({
          lat: Number(p.lat.toFixed(6)),
          lng: Number(p.lng.toFixed(6)),
        });
      });
      marker.addTo(g);
    }
    if (valid(location)) {
      L.circle([location.lat, location.lng], {
        radius: location.accuracy || 0,
        color: "#2563eb",
        fillOpacity: 0.08,
      }).addTo(g);
      L.circleMarker([location.lat, location.lng], {
        radius: 6,
        color: "white",
        weight: 2,
        fillColor: "#2563eb",
        fillOpacity: 1,
      })
        .bindTooltip("Your captured location")
        .addTo(g);
    }
    if (!initial.current && visible.length) {
      m.fitBounds(L.latLngBounds(visible.map((r) => [r.lat, r.lng])), {
        padding: [40, 40],
        maxZoom: 17,
      });
      initial.current = true;
      lastSelection.current = selectedId;
    } else if (selectedId !== lastSelection.current && display) {
      m.panTo([display.lat, display.lng]);
      lastSelection.current = selectedId;
    }
  }, [roomKey, sessionKey, selectedId, pointKey, draftKey, failed, retry]);
  const fit = () => {
    if (map.current && visible.length)
      map.current.fitBounds(
        L.latLngBounds(visible.map((r) => [r.lat, r.lng])),
        { padding: [40, 40], maxZoom: 17 },
      );
  };
  const zoom = () => {
    if (map.current && display)
      map.current.setView([display.lat, display.lng], 17);
  };
  const d =
    valid(location) && display ? distanceMeters(display, location) : null;
  const scale =
    Math.max(display?.radius || 75, d || 0, location?.accuracy || 0) * 1.3;
  let dx = 0,
    dy = 0;
  if (d !== null) {
    dx =
      (((location.lng - display.lng) *
        111320 *
        Math.cos((display.lat * Math.PI) / 180)) /
        scale) *
      125;
    dy = ((-(location.lat - display.lat) * 111320) / scale) * 125;
  }
  return (
    <section
      className={`map-panel ${compact ? "compact" : ""}`}
      aria-label="Classroom location map"
    >
      <div className="map-toolbar">
        <strong>{draft ? "Draft venue preview" : "Classroom locations"}</strong>
        <div>
          <button
            type="button"
            className="secondary"
            onClick={fit}
            disabled={failed || !visible.length}
          >
            Fit classrooms
          </button>
          <button
            type="button"
            className="secondary"
            onClick={zoom}
            disabled={failed || !display}
          >
            Zoom to selected room
          </button>
        </div>
      </div>
      {!visible.length ? (
        <p>No configured classroom coordinates.</p>
      ) : failed ? (
        <div className="map-fallback">
          <p role="status">
            <strong>Schematic location view — street map unavailable.</strong>
          </p>
          <svg
            viewBox="0 0 400 280"
            role="img"
            aria-label="Relative geofence and captured location diagram"
          >
            <path
              d="M0 140h400 M200 0v280"
              stroke="#dce3ec"
              strokeDasharray="5 5"
            />
            <circle
              cx="200"
              cy="140"
              r={(display.radius / scale) * 125}
              fill="#ccfbf1"
              stroke="#0f766e"
            />
            <circle cx="200" cy="140" r="6" fill="#0f766e" />
            {d !== null && (
              <>
                <circle
                  cx={200 + dx}
                  cy={140 + dy}
                  r={Math.min(125, (location.accuracy / scale) * 125)}
                  fill="#dbeafe"
                  fillOpacity=".5"
                  stroke="#2563eb"
                />
                <circle cx={200 + dx} cy={140 + dy} r="6" fill="#2563eb" />
              </>
            )}
          </svg>
          <p>
            {display.name} · {display.radius}m geofence ·{" "}
            {display.lat.toFixed(6)}, {display.lng.toFixed(6)}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setFailed(false);
              setRetry((n) => n + 1);
            }}
          >
            Retry street map
          </button>
        </div>
      ) : (
        <div ref={host} className="leaflet-host" />
      )}
      <div className="map-legend">
        <span>
          <i className="dot teal" /> Selected venue / geofence
        </span>
        <span>
          <i className="dot navy" /> Classroom
        </span>
        {location && (
          <span>
            <i className="dot blue" /> Captured location / accuracy
          </span>
        )}
      </div>
      {d !== null && (
        <p className="map-reading">
          Distance: {Math.round(d)}m · GPS accuracy: ±
          {Math.round(location.accuracy)}m. Location captured; server validation
          occurs on submission.
        </p>
      )}
      {draft && (
        <p className="caption">
          Drag the selected pin or edit coordinates. This preview is not saved
          until Save succeeds.
        </p>
      )}
    </section>
  );
}
