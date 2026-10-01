import React, { useEffect, useRef, useState } from "react";
export function Icon({ name = "grid" }) {
  const paths = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    map: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15",
    calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16",
    users:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    user: "M20 21v-2a7 7 0 0 0-14 0v2 M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    check: "m5 12 4 4L19 6",
    history: "M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2",
    code: "m8 7-5 5 5 5 m8-10 5 5-5 5 M14 4l-4 16",
    menu: "M3 6h18 M3 12h18 M3 18h18",
    close: "m6 6 12 12 M6 18 18 6",
    arrow: "M5 12h14 m-5-5 5 5-5 5",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.grid} />
    </svg>
  );
}
export function Modal({ title, onClose, children, wide = false }) {
  const dialog = useRef(null),
    callback = useRef(onClose);
  callback.current = onClose;
  useEffect(() => {
    const before = document.activeElement;
    dialog.current.showModal();
    return () => {
      dialog.current?.close();
      before?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`portal-dialog ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        callback.current();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button secondary"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <Icon />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Skeleton() {
  return (
    <div aria-label="Loading portal" aria-busy="true" className="skeleton-grid">
      {[1, 2, 3].map((i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  return false;
}
export function CopyField({ label, value }) {
  const [message, setMessage] = useState(""),
    input = useRef(null);
  return (
    <div className="copy-field">
      <label>
        {label}
        <textarea
          ref={input}
          readOnly
          value={value || ""}
          onFocus={(e) => e.target.select()}
          rows={3}
        />
      </label>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          const copied = await copyText(value);
          if (!copied) {
            input.current.focus();
            input.current.select();
          }
          setMessage(
            copied
              ? "Copied."
              : "Text selected. Use your device’s Copy command.",
          );
        }}
      >
        Copy {label.toLowerCase()}
      </button>
      <small role="status">{message}</small>
    </div>
  );
}
export const statusText = (a) =>
  a?.decision === "VERIFIED"
    ? "Attendance recorded"
    : a?.decision === "REJECTED"
      ? "Attendance rejected"
      : a?.decision === "SUSPICIOUS"
        ? "Classroom proof could not be verified"
        : a?.reasons?.some((r) => r.endsWith("RECAPTURE"))
          ? "Recapture photo for review"
          : a?.phase === "AWAITING_REVIEW"
            ? "Submitted — awaiting teacher review"
            : a?.phase === "PENDING_REVIEW"
              ? "Submission window ended"
              : a?.phase === "RETRY"
                ? "Action needed"
                : "Complete your check-in";
export function StatusBadge({ attempt }) {
  return (
    <span
      className={`badge ${(attempt?.decision || attempt?.phase || "collecting").toLowerCase()}`}
    >
      {statusText(attempt)}
    </span>
  );
}
export function OperationsPanel({ online, api, run }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let active = true;
    api("/presence/status")
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <details className="card operations">
      <summary>Setup and demonstration help</summary>
      <dl>
        <dt>Attendance server</dt>
        <dd>{online ? "Connected" : "Reconnecting / unavailable"}</dd>
        <dt>Companion configuration</dt>
        <dd>
          {status ? (status.configured ? "Loaded" : "Missing") : "Not checked"}
        </dd>
        {status?.configured && (
          <>
            <dt>Device / room</dt>
            <dd>
              {status.deviceId} / {status.roomId}
            </dd>
          </>
        )}
        <dt>Physical ESP32 and phone tests</dt>
        <dd>Pending — see operator test record</dd>
        <dt>Identity mode</dt>
        <dd>Teacher review</dd>
        <dt>Submitted photo retention</dt>
        <dd>Up to 15 minutes or until review</dd>
      </dl>
      <button
        className="secondary"
        onClick={() =>
          run(async () => setStatus(await api("/presence/status")))
        }
      >
        Check companion configuration
      </button>
      <p>
        Configuration does not confirm that the board is powered on. Camera and
        location require trusted HTTPS on phones. The classroom map contacts
        OpenStreetMap when online.
      </p>
      <ol>
        <li>Use the shared laptop Wi-Fi to open the HTTPS app.</li>
        <li>Capture location and photo, then copy the companion request.</li>
        <li>
          Join the configured ESP32 Wi-Fi; open http://192.168.4.1 in Safari or
          Chrome.
        </li>
        <li>
          Copy the response, rejoin the original laptop Wi-Fi, and submit in the
          same tab.
        </li>
      </ol>
      <p>
        Initial operator passwords are in the private local account file.
        Students must be enrolled in their course. Submitted photos are
        temporary; enrolled references remain private local data.
      </p>
    </details>
  );
}
