import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { getLocation } from "./providers/browser";
import { distanceMeters } from "./domain/trust";
import ScheduleCalendar from "./components/ScheduleCalendar";
import ClassroomMap from "./components/ClassroomMap";
import {
  Icon,
  Modal,
  EmptyState,
  Skeleton,
  StatusBadge,
  OperationsPanel,
  CopyField,
} from "./components/PortalUI";
import "./style.css";
// The Firebase SDK is optional: it is only fetched in connected mode.
const fb = () => import("./firebaseAuth");

function friendlyAuthError(e) {
  const code = e?.code || "";
  if (/email-already-in-use/.test(code))
    return "That email already has an account. Use Sign in instead.";
  if (/weak-password/.test(code))
    return "Choose a password of at least 6 characters.";
  if (/invalid-email/.test(code)) return "Enter a valid email address.";
  if (/invalid-credential|wrong-password|user-not-found/.test(code))
    return "Email or password is incorrect.";
  if (/too-many-requests/.test(code))
    return "Too many attempts. Wait a few minutes and try again.";
  if (/network/.test(code)) return "Network problem. Check your connection.";
  return e?.message || "Sign-in failed.";
}

const readUi = (k) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeUi = (k, v) => {
  try {
    if (v) sessionStorage.setItem(k, v);
    else sessionStorage.removeItem(k);
  } catch {}
};

// Camera with actionable errors; tracks are stopped by stopCamera().
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia)
    throw Error(
      "The camera needs a secure browser context (HTTPS or localhost). Open the portal at the HTTPS address shown by the operator.",
    );
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
  } catch (e) {
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError")
      throw Error(
        "Camera permission was denied. Allow camera access for this site in your browser settings, then tap Open camera again.",
      );
    if (e?.name === "NotFoundError" || e?.name === "OverconstrainedError")
      throw Error("No camera was found on this device.");
    throw Error(
      "The camera could not be started. Close other apps using it and try again.",
    );
  }
}

// Plain-language outcome of an attempt. Similarity is advisory and never shown as a verdict.
function outcomeText(a) {
  if (!a) return "Your result appears here";
  if (a.decision === "VERIFIED") return "Attendance recorded.";
  if (a.decision === "REJECTED") return "Not recorded — rejected";
  if (a.decision === "SUSPICIOUS") return "Not recorded — check failed";
  if (a.phase === "RETRY") return "Try that step again";
  if (["PENDING_REVIEW", "AWAITING_REVIEW"].includes(a.phase))
    return "Submitted — awaiting teacher review.";
  return "Your result appears here";
}

const REASON_TEXT = {
  LOCAL_PROOF_INVALID: "Classroom ESP32 proof was invalid or altered",
  OUTSIDE_GEOFENCE: "Location was outside the classroom geofence",
  TEACHER_IDENTITY_REJECTED: "Teacher rejected the identity check",
  GPS_UNCERTAIN: "GPS accuracy too low to decide — student can retry",
  GEOFENCE_BOUNDARY_UNCERTAIN:
    "Position uncertain near the geofence edge — student can retry",
  LOCATION_REQUIRED:
    "Location was not shared (permission denied or unavailable)",
  PHOTO_REQUIRED: "Photo was missing",
  LOCAL_PROOF_UNAVAILABLE:
    "Classroom ESP32 proof not provided (board may be off or out of reach)",
  REVIEW_PHOTO_EXPIRED_RECAPTURE:
    "Evidence expired before review — student must recapture",
  REVIEW_EVIDENCE_LOST_RECAPTURE:
    "Evidence lost after a restart — student must recapture",
  COMPLETION_WINDOW_ELAPSED: "Completion window ended before submission",
};
const reasonText = (r) => REASON_TEXT[r] || pretty(r);

const pretty = (s) => s?.replaceAll("_", " ").toLowerCase();

function App() {
  const [auth, setAuth] = useState(() =>
    JSON.parse(sessionStorage.getItem("tp-auth") || "null"),
  );
  const [appConfig, setAppConfig] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [zoomPhoto, setZoomPhoto] = useState(null);
  const loggingOut = useRef(false);
  const renewing = useRef(null);
  const authRef = useRef(auth);
  authRef.current = auth;
  const [viewRole, setViewRole] = useState(null); // Allows dev to preview Teacher or Student screens
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [state, setState] = useState({
    sessions: [],
    attempts: [],
    classrooms: [],
    schedules: [],
    attendance: [],
    logs: [],
    stats: null,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const [activeTab, setActiveTab] = useState(() => {
    const saved = JSON.parse(sessionStorage.getItem("tp-auth") || "null");
    if (saved?.user?.role === "dev") return "dev-logs";
    return saved?.user?.role === "admin" ? "attendance" : "checkin";
  });
  const [loginMode, setLoginMode] = useState("signin");
  const [loginInput, setLoginInput] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [sessionType, setSessionType] = useState("scheduled");

  // Registration Form State
  const [regForm, setRegForm] = useState({
    name: "",
    email: "",
    role: "student",
    password: "",
    roll: "",
    dept: "ECE",
    referencePhoto: "",
  });

  // Profile Editor State (for all roles)
  const [profileForm, setProfileForm] = useState({
    name: "",
    email: "",
    dept: "",
    roll: "",
    referencePhoto: "",
  });
  const [profileSuccess, setProfileSuccess] = useState("");
  const fileInputRef = useRef(null);

  // Student Attendance State
  const [challenge, setChallenge] = useState(
    () => new URLSearchParams(location.search).get("challenge") || "",
  );
  const [attempt, setAttempt] = useState(null);
  const [evidence, setEvidence] = useState({});
  const [presenceMode, setPresenceMode] = useState("baseline");
  const [presenceStatus, setPresenceStatus] = useState(null);
  const [proofRequest, setProofRequest] = useState(null);
  const [proofCode, setProofCode] = useState("");
  const [photo, setPhoto] = useState("");
  const [camera, setCamera] = useState(false);

  // Teacher Room & Session Configuration
  const [room, setRoom] = useState({
    name: "ECE Lab 1",
    lat: 13.0827,
    lng: 80.2707,
    radius: 75,
    maxAccuracy: 100,
  });
  const [selectedScheduleId, setSelectedScheduleId] = useState("sched-1");
  const [roomSource, setRoomSource] = useState("default");
  const [locStatus, setLocStatus] = useState("");
  const [qr, setQr] = useState("");

  // Relocation Drawer State
  const [showRelocate, setShowRelocate] = useState(false);
  const [relocateVenue, setRelocateVenue] = useState({
    name: "",
    lat: 13.0827,
    lng: 80.2707,
    radius: 75,
    maxAccuracy: 100,
  });

  // Schedule Editor State
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [showNewSchedule, setShowNewSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    subject: "",
    classId: "",
    classroomId: "room-1",
    teacherId: "",
    time: "09:00 - 10:30",
    days: "Mon, Wed, Fri",
    enrollmentIds: [],
  });

  // Classroom Editor State
  const [editingClassroom, setEditingClassroom] = useState(null);
  const [showNewClassroom, setShowNewClassroom] = useState(false);
  const [selectedClassroomId, setSelectedClassroomId] = useState(null);
  const [reviewingAttemptId, setReviewingAttemptId] = useState(null);
  const [classroomForm, setClassroomForm] = useState({
    name: "",
    capacity: 40,
    lat: 13.0827,
    lng: 80.2707,
    radius: 75,
    maxAccuracy: 100,
  });

  // Dev Console State
  const [logFilter, setLogFilter] = useState("all");
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [simRoomId, setSimRoomId] = useState("");
  const [simGeoCalc, setSimGeoCalc] = useState(null);
  // Only opaque ids are kept in sessionStorage (never evidence or proofs).
  const [selectedSessionId, setSelectedSessionIdRaw] = useState(() =>
    readUi("tp-session"),
  );
  const setSelectedSessionId = (id) => {
    writeUi("tp-session", id);
    setSelectedSessionIdRaw(id);
  };
  const [savedAttemptId] = useState(() => readUi("tp-attempt"));

  const video = useRef(null);
  const stream = useRef(null);

  const effectiveRole = viewRole || auth?.user?.role || "student";

  const currentAttempt =
    state.attempts.find((a) => a.id === attempt?.id) ||
    state.attempts.find((a) => a.id === savedAttemptId) ||
    attempt ||
    state.attempts.filter((a) => a.uid === auth?.user.id).at(-1);

  const reviewingAttempt =
    state.attempts.find((a) => a.id === reviewingAttemptId) || null;

  const manageableSessions = state.sessions.filter(
    (s) => auth?.user?.role === "dev" || s.teacherId === auth?.user?.id,
  );
  const session =
    effectiveRole === "student" && currentAttempt
      ? state.sessions.find((s) => s.id === currentAttempt.sessionId)
      : effectiveRole === "student"
        ? state.sessions.at(-1)
        : manageableSessions.find((s) => s.id === selectedSessionId) ||
          manageableSessions.findLast((s) => s.open) ||
          manageableSessions.at(-1);

  const offset = useRef(0);
  const now = tick + offset.current;

  // The only writer of tp-auth. Never stores photos, evidence or proof codes.
  function remember(data) {
    const { token, expiresAt, user } = data;
    const safeUser = {
      id: user.id,
      name: user.name,
      role: user.role,
      email: user.email,
      roll: user.roll,
      dept: user.dept,
    };
    try {
      sessionStorage.setItem(
        "tp-auth",
        JSON.stringify({ token, expiresAt, user: safeUser }),
      );
    } catch {}
    const live = { token, expiresAt, user };
    authRef.current = live;
    setAuth(live);
  }
  async function renewSession() {
    if (appConfig?.mode !== "firebase" || loggingOut.current) return null;
    if (!renewing.current)
      renewing.current = (async () => {
        const idToken = await (await fb()).freshIdToken();
        if (!idToken || loggingOut.current) return null;
        const r = await fetch("/api/session/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        if (!r.ok || loggingOut.current) return null;
        const data = await r.json();
        remember(data);
        return data;
      })().finally(() => {
        renewing.current = null;
      });
    return renewing.current;
  }
  async function api(path, body, method = undefined, retry = true) {
    const isBody = body !== undefined;
    const r = await fetch(`/api${path}`, {
      method: method || (isBody ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        ...(authRef.current
          ? { Authorization: `Bearer ${authRef.current.token}` }
          : {}),
      },
      body: isBody ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) {
      if (r.status === 401 && retry && authRef.current && !loggingOut.current) {
        if (await renewSession()) return api(path, body, method, false);
      }
      if (r.status === 401) {
        sessionStorage.removeItem("tp-auth");
        authRef.current = null;
        setAuth(null);
      }
      throw new Error(pretty(data.error) || "Request failed");
    }
    return data;
  }

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Accessible replacement for window.confirm(): resolves true/false.
  function ask({ title, body, confirmLabel = "Confirm", danger = false }) {
    return new Promise((resolve) =>
      setDialog({ title, body, confirmLabel, danger, resolve }),
    );
  }
  function closeDialog(answer) {
    dialog?.resolve(answer);
    setDialog(null);
  }

  function stopCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
  }

  useEffect(() => {
    fetch("/api/config")
      .then(async (r) => {
        if (!r.ok) throw Error("Server configuration unavailable.");
        const config = await r.json();
        if (config.mode === "firebase")
          await (
            await fb()
          ).configureFirebase(
            config.firebase.web,
            config.firebase.authEmulatorUrl,
          );
        setAppConfig(config);
      })
      .catch((e) => setError(e.message));
    fetch("/api/demo-accounts")
      .then((r) => r.json())
      .then(setAccounts)
      .catch(() => setError("The local server is unavailable."));
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      clearInterval(t);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!auth || !appConfig) return;
    let active = true;
    const controller = new AbortController();
    async function connect() {
      while (active) {
        try {
          const r = await fetch("/api/events", {
            headers: { Authorization: `Bearer ${auth.token}` },
            signal: controller.signal,
          });
          if (!r.ok) {
            if (r.status === 401) {
              if (await renewSession()) return;
              sessionStorage.removeItem("tp-auth");
              authRef.current = null;
              setAuth(null);
              return;
            }
            throw Error();
          }
          setOnline(true);
          const reader = r.body.getReader(),
            decoder = new TextDecoder();
          let buffer = "";
          while (active) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let split;
            while ((split = buffer.indexOf("\n\n")) >= 0) {
              const frame = buffer.slice(0, split);
              buffer = buffer.slice(split + 2);
              if (frame.startsWith("data: ")) {
                const data = JSON.parse(frame.slice(6));
                offset.current = data.serverTime - Date.now();
                setState(data);
                if (data.people) {
                  const updatedMe = data.people.find(
                    (p) => p.id === auth.user.id,
                  );
                  if (updatedMe) {
                    setAuth((prev) =>
                      prev ? { ...prev, user: updatedMe } : prev,
                    );
                  }
                }
              }
            }
          }
        } catch {}
        if (active) {
          setOnline(false);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    connect();
    return () => {
      active = false;
      controller.abort();
      setOnline(false);
    };
  }, [auth?.token, appConfig]);

  useEffect(() => {
    if (session?.challenge) {
      QRCode.toDataURL(
        `${location.origin}/?challenge=${session.challenge.id}`,
        { width: 240, margin: 2, color: { dark: "#123d35", light: "#ffffff" } },
      ).then(setQr);
    } else setQr("");
  }, [session?.challenge?.id]);

  useEffect(() => {
    if (camera && video.current) video.current.srcObject = stream.current;
  }, [camera]);
  useEffect(() => {
    if (activeTab !== "checkin" && camera) stopCamera();
  }, [activeTab]);
  useEffect(() => {
    if (auth?.user?.role === "student" && currentAttempt?.id)
      writeUi("tp-attempt", currentAttempt.id);
  }, [currentAttempt?.id]);

  async function login(id) {
    loggingOut.current = false;
    const data =
      appConfig?.mode === "firebase"
        ? await api("/session/exchange", {
            idToken: await (async () => {
              try {
                return await (await fb()).firebaseLogin(id, loginPassword);
              } catch (e) {
                throw new Error(friendlyAuthError(e));
              }
            })(),
          })
        : await api("/login", { id, password: loginPassword });
    remember(data);
    setLoginPassword("");
    setViewRole(null);
    setAttempt(null);
    setEvidence({});
    setPhoto("");
    setActiveTab(
      data.user.role === "dev"
        ? "dev-logs"
        : data.user.role === "admin"
          ? "attendance"
          : "checkin",
    );
  }

  async function registerAccount() {
    loggingOut.current = false;
    let data;
    if (appConfig?.mode === "firebase") {
      let idToken;
      try {
        idToken = await (
          await fb()
        ).firebaseLogin(regForm.email, regForm.password, true);
      } catch (e) {
        throw new Error(friendlyAuthError(e));
      }
      try {
        data = await api("/session/exchange", { idToken, name: regForm.name });
      } catch (e) {
        throw new Error(
          `Your Firebase account was created, but the portal could not start your session (${e.message}). Use Sign in with the same email and password to continue.`,
        );
      }
      remember(data);
      try {
        await api(
          "/profile",
          { name: regForm.name, roll: regForm.roll, dept: regForm.dept },
          "PUT",
        );
        if (regForm.referencePhoto)
          await api("/profile/photo", { photo: regForm.referencePhoto });
      } catch (e) {
        setError(
          `Account created and signed in, but profile details were not saved (${e.message}). Open Profile to enter them again.`,
        );
      }
    } else {
      data = await api("/register", regForm);
      remember(data);
    }
    setRegForm((prev) => ({ ...prev, password: "", referencePhoto: "" }));
    setViewRole(null);
    setAttempt(null);
    setEvidence({});
    setPhoto("");
    setActiveTab(
      data.user.role === "dev"
        ? "dev-logs"
        : data.user.role === "admin"
          ? "attendance"
          : "checkin",
    );
  }

  // Guard: students can never access directory
  useEffect(() => {
    if (effectiveRole === "student" && activeTab === "directory") {
      setActiveTab("timetable");
    }
  }, [effectiveRole, activeTab]);

  async function logout() {
    loggingOut.current = true;
    try {
      await api("/logout", {});
    } catch {}
    try {
      await (await fb()).firebaseLogout();
    } catch {}
    authRef.current = null;
    setLoginPassword("");
    stopCamera();
    sessionStorage.removeItem("tp-auth");
    writeUi("tp-session", null);
    writeUi("tp-attempt", null);
    setAuth(null);
    setViewRole(null);
    setState({
      sessions: [],
      attempts: [],
      classrooms: [],
      schedules: [],
      attendance: [],
      logs: [],
      stats: null,
    });
    setAttempt(null);
    setEvidence({});
    setPhoto("");
  }

  async function claim() {
    let code = challenge.trim();
    try {
      code = new URL(code).searchParams.get("challenge") || code;
    } catch {}
    const a = await api("/claim", {
      challengeId: code,
    });
    setAttempt(a);
    setProofRequest(null);
    setProofCode("");
  }

  async function submit() {
    let e = { ...evidence };
    if (photo) e.photo = photo;
    e.capturedAt = Date.now();
    e.presenceProof = proofCode.trim();
    const updated = await api(`/attempts/${currentAttempt.id}/submit`, e);
    if (updated) setAttempt(updated);
  }

  async function saveProfilePhoto(dataUrl) {
    const res = await api("/profile/photo", { photo: dataUrl });
    setAuth((prev) => ({
      ...prev,
      user: { ...prev.user, referencePhoto: dataUrl },
    }));
    setProfileForm((prev) => ({ ...prev, referencePhoto: dataUrl }));
    return res;
  }

  useEffect(() => {
    if (auth?.user) {
      setProfileForm({
        name: auth.user.name || "",
        email: auth.user.email || "",
        dept: auth.user.dept || "",
        roll: auth.user.roll || "",
        referencePhoto: auth.user.referencePhoto || "",
      });
    }
  }, [
    auth?.user?.id,
    auth?.user?.name,
    auth?.user?.email,
    auth?.user?.dept,
    auth?.user?.roll,
    auth?.user?.referencePhoto,
  ]);

  async function handleSaveProfile(e) {
    if (e) e.preventDefault();
    const updated = await api("/profile", profileForm, "PUT");
    remember({ ...authRef.current, user: updated });
    setProfileSuccess("Profile updated successfully!");
    setTimeout(() => setProfileSuccess(""), 4000);
  }

  function handleProfilePhotoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDim = 320;
        let w = img.width;
        let h = img.height;
        if (w > h) {
          if (w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          }
        } else {
          if (h > maxDim) {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        setProfileForm((prev) => ({ ...prev, referencePhoto: dataUrl }));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  const teachers =
    (state.people && state.people.filter((p) => p.role === "admin").length > 0
      ? state.people.filter((p) => p.role === "admin")
      : accounts.filter((a) => a.role === "admin")) || [];

  // Session Venue Relocation
  async function relocateActiveSession() {
    if (!session) return;
    await api(`/sessions/${session.id}/venue`, relocateVenue);
    setShowRelocate(false);
  }

  // Schedule CRUD
  async function handleSaveSchedule(e) {
    e.preventDefault();
    const isStudent = auth?.user?.role === "student";
    const { enrollmentIds, ...courseFields } = scheduleForm;
    if (editingSchedule) {
      await api(
        `/schedules/${editingSchedule.id}`,
        isStudent ? courseFields : scheduleForm,
        "PUT",
      );
      setEditingSchedule(null);
    } else {
      await api(
        "/schedules",
        isStudent
          ? { ...courseFields, enrollmentIds: [auth.user.id] }
          : scheduleForm,
        "POST",
      );
      setShowNewSchedule(false);
    }
  }

  async function handleDeleteSchedule(id) {
    if (
      !(await ask({
        title: "Delete this schedule?",
        body: "The course and its roster are removed. Past attendance records stay.",
        confirmLabel: "Delete schedule",
        danger: true,
      }))
    )
      return;
    await api(`/schedules/${id}`, undefined, "DELETE");
  }

  // Classroom CRUD
  async function handleSaveClassroom(e) {
    e.preventDefault();
    if (editingClassroom) {
      await api(`/classrooms/${editingClassroom.id}`, classroomForm, "PUT");
      setEditingClassroom(null);
    } else {
      await api("/classrooms", classroomForm, "POST");
      setShowNewClassroom(false);
    }
  }

  async function handleDeleteClassroom(id) {
    if (
      !(await ask({
        title: "Delete this venue?",
        body: "Courses using this venue will need another venue.",
        confirmLabel: "Delete venue",
        danger: true,
      }))
    )
      return;
    await api(`/classrooms/${id}`, undefined, "DELETE");
  }

  const verified = state.attempts.filter(
    (a) => a.sessionId === session?.id && a.decision === "VERIFIED",
  ).length;

  const filteredLogs = (state.logs || []).filter((l) => {
    if (logFilter === "all") return true;
    if (logFilter === "attempts") return l.category === "attempt";
    if (logFilter === "sessions")
      return l.category === "session" || l.category === "venue";
    if (logFilter === "geofences") return l.category === "geofence";
    if (logFilter === "schedules") return l.category === "schedule";
    if (logFilter === "auth") return l.category === "auth";
    return true;
  });

  return (
    <>
      <header className="portal-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {auth && (
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation menu"
            >
              <Icon name={mobileMenuOpen ? "close" : "menu"} />
            </button>
          )}
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              if (auth) {
                setActiveTab(
                  effectiveRole === "student" ? "checkin" : "attendance",
                );
              }
            }}
          >
            <div className="brand-icon">
              <Icon name="grid" />
            </div>
            <div className="brand-text">
              <span>TECH PULSE</span>
              <small>Smart Campus</small>
            </div>
          </a>
        </div>

        {auth && (
          <div className="header-center">
            <span className="page-title-badge">
              {activeTab === "attendance"
                ? "Attendance Workspace"
                : activeTab === "schedules" ||
                    activeTab === "timetable" ||
                    activeTab === "courses"
                  ? "Weekly Timetable & Courses"
                  : activeTab === "classrooms"
                    ? "Classrooms & Geofences"
                    : activeTab === "directory"
                      ? "Student Directory"
                      : activeTab === "checkin"
                        ? "Student Verification"
                        : activeTab === "history"
                          ? "Attendance History"
                          : activeTab === "profile"
                            ? "Profile & Settings"
                            : activeTab === "dev-logs"
                              ? "Developer Console"
                              : "Campus Portal"}
            </span>
          </div>
        )}

        <div className="header-right">
          {auth?.user?.role === "dev" && (
            <div className="dev-switcher">
              <span>ROLE PREVIEW:</span>
              <button
                type="button"
                className={
                  !viewRole || viewRole === "dev" ? "active-role" : "role-btn"
                }
                onClick={() => {
                  setViewRole("dev");
                  setActiveTab("dev-logs");
                }}
              >
                Dev
              </button>
              <button
                type="button"
                className={viewRole === "admin" ? "active-role" : "role-btn"}
                onClick={() => {
                  setViewRole("admin");
                  setActiveTab("attendance");
                }}
              >
                Teacher
              </button>
              <button
                type="button"
                className={viewRole === "student" ? "active-role" : "role-btn"}
                onClick={() => {
                  setViewRole("student");
                  setActiveTab("checkin");
                }}
              >
                Student
              </button>
            </div>
          )}

          <span className={`conn-indicator ${online ? "online" : "offline"}`}>
            <i className="conn-dot" /> {online ? "Connected" : "Reconnecting"}
          </span>

          <span className="role-pill">
            {auth
              ? auth.user.role === "dev"
                ? "System Developer"
                : auth.user.role === "admin"
                  ? "Teacher / Faculty"
                  : "Student"
              : "Campus Portal"}
          </span>

          {auth && (
            <button type="button" className="btn-signout" onClick={logout}>
              Sign out ({auth.user.name})
            </button>
          )}
        </div>
      </header>
      {zoomPhoto && (
        <Modal title="Photo" onClose={() => setZoomPhoto(null)} wide>
          <img
            src={zoomPhoto.src}
            alt={zoomPhoto.alt}
            style={{
              maxWidth: "100%",
              maxHeight: "70vh",
              display: "block",
              margin: "0 auto",
            }}
          />
        </Modal>
      )}
      {dialog && (
        <Modal title={dialog.title} onClose={() => closeDialog(false)}>
          <p>{dialog.body}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => closeDialog(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={dialog.danger ? "danger-btn" : ""}
              onClick={() => closeDialog(true)}
            >
              {dialog.confirmLabel}
            </button>
          </div>
        </Modal>
      )}

      <main>
        <div className="notice">
          Live Attendance & Campus Schedule Platform · Real Geolocation, Dynamic
          Venues & Dev Audit Logging
        </div>

        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}

        {!auth ? (
          <section className="login-layout">
            <div>
              <p className="eyebrow">PRESENCE & SPACE INTELLIGENCE</p>
              <h1>
                Smart Attendance
                <br />& Campus Timetable.
              </h1>
              <p className="lead">
                Geofenced check-in, QR challenge, teacher-reviewed photo
                evidence, optional ESP32 classroom proof and an estimated room
                occupancy view.
              </p>
              <div className="steps">
                <span>01 · Setup Accounts</span>
                <span>02 · Timetable & Classrooms</span>
                <span>03 · Live Verification</span>
              </div>
            </div>

            <div className="card">
              <div className="tabs" style={{ marginBottom: 18 }}>
                <button
                  className={loginMode === "signin" ? "active" : ""}
                  onClick={() => setLoginMode("signin")}
                >
                  🔑 Direct Sign In
                </button>
                <button
                  className={loginMode === "register" ? "active" : ""}
                  onClick={() => setLoginMode("register")}
                >
                  ➕ Register Account
                </button>
              </div>

              {loginMode === "signin" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!loginInput.trim()) {
                      setError(
                        "Please enter your Student Roll Number, Faculty ID, or Email.",
                      );
                      return;
                    }
                    run(() => login(loginInput.trim()));
                  }}
                  className="signin-form"
                >
                  <p className="eyebrow">CAMPUS ACCESS</p>
                  <h2>Sign in to Campus Portal</h2>
                  <p>
                    Enter your Student Roll Number (e.g. <code>ECE001</code>) or
                    faculty/staff ID/email.
                  </p>

                  <label style={{ marginTop: 14 }}>
                    {appConfig?.mode === "firebase"
                      ? "Email"
                      : "Student Roll No, Faculty ID, or Email"}
                    <input
                      type="text"
                      value={loginInput}
                      onChange={(e) => setLoginInput(e.target.value)}
                      placeholder="e.g. ECE001, teacher@ssec.edu, or student ID"
                      autoFocus
                    />
                  </label>

                  <label>
                    Password
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !appConfig || !loginInput.trim()}
                    style={{ marginTop: 14 }}
                  >
                    {busy ? "Signing in..." : "Sign in to Portal ➔"}
                  </button>
                </form>
              ) : (
                <div className="register-form">
                  <label>
                    Password (at least 10 characters)
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={10}
                      required
                      value={regForm.password}
                      onChange={(e) =>
                        setRegForm({ ...regForm, password: e.target.value })
                      }
                    />
                  </label>
                  <p className="eyebrow">ACCOUNT REGISTRATION</p>
                  <h2>Create Campus Account</h2>
                  <p>
                    Register a student profile. Faculty and developer accounts
                    are managed by the administrator.
                  </p>

                  <label>
                    Account Role
                    <select
                      value={regForm.role}
                      onChange={(e) =>
                        setRegForm({ ...regForm, role: e.target.value })
                      }
                    >
                      <option value="student">Student</option>
                    </select>
                  </label>

                  <label>
                    Full Name
                    <input
                      placeholder="e.g. Prajesh Siva"
                      value={regForm.name}
                      onChange={(e) =>
                        setRegForm({ ...regForm, name: e.target.value })
                      }
                    />
                  </label>

                  <div className="fields">
                    <label>
                      {regForm.role === "student"
                        ? "Roll Number"
                        : "Faculty / Dev ID"}
                      <input
                        placeholder={
                          regForm.role === "student"
                            ? "e.g. ECE042"
                            : "e.g. FAC101"
                        }
                        value={regForm.roll}
                        onChange={(e) =>
                          setRegForm({ ...regForm, roll: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Department
                      <input
                        placeholder="e.g. ECE / CSE / Platform"
                        value={regForm.dept}
                        onChange={(e) =>
                          setRegForm({ ...regForm, dept: e.target.value })
                        }
                      />
                    </label>
                  </div>

                  <label>
                    Email Address
                    <input
                      type="email"
                      placeholder="e.g. user@ssec.edu"
                      value={regForm.email}
                      onChange={(e) =>
                        setRegForm({ ...regForm, email: e.target.value })
                      }
                    />
                  </label>

                  {regForm.role === "student" && (
                    <div
                      style={{
                        margin: "14px 0",
                        padding: 12,
                        background: "#f5f7f2",
                        borderRadius: 8,
                      }}
                    >
                      <p
                        style={{
                          margin: "0 0 8px",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        📷 Reference Face Registration (Optional now, can be
                        added later)
                      </p>
                      {regForm.referencePhoto ? (
                        <div style={{ textAlign: "center" }}>
                          <img
                            src={regForm.referencePhoto}
                            alt="Reference Face"
                            style={{
                              width: 120,
                              height: 120,
                              borderRadius: "50%",
                              objectFit: "cover",
                            }}
                          />
                          <div
                            style={{
                              fontSize: 11,
                              color: "#2c653e",
                              marginTop: 4,
                            }}
                          >
                            ✓ Profile Face Ready
                          </div>
                          <button
                            type="button"
                            className="secondary"
                            style={{ marginTop: 6 }}
                            onClick={() =>
                              setRegForm({ ...regForm, referencePhoto: "" })
                            }
                          >
                            Retake
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            run(async () => {
                              stopCamera();
                              stream.current = await openCamera();
                              setCamera(true);
                            })
                          }
                        >
                          📷 Capture Face Profile Photo
                        </button>
                      )}

                      {camera && (
                        <div style={{ marginTop: 8 }}>
                          <video
                            ref={video}
                            autoPlay
                            playsInline
                            muted
                            style={{ maxHeight: 200 }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const v = video.current;
                              if (!v) return;
                              const c = document.createElement("canvas");
                              c.width = v.videoWidth || 640;
                              c.height = v.videoHeight || 480;
                              c.getContext("2d").drawImage(
                                v,
                                0,
                                0,
                                c.width,
                                c.height,
                              );
                              const url = c.toDataURL("image/jpeg", 0.7);
                              setRegForm({ ...regForm, referencePhoto: url });
                              stopCamera();
                            }}
                          >
                            Snap Photo
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    disabled={
                      busy ||
                      !appConfig ||
                      !regForm.name ||
                      (appConfig.mode === "firebase" && !regForm.email)
                    }
                    onClick={() => run(registerAccount)}
                  >
                    {busy ? "Registering…" : "Create Account & Sign In"}
                  </button>
                </div>
              )}
            </div>
          </section>
        ) : (
          <div className="portal-layout">
            {/* Sidebar Navigation */}
            <nav
              className={`portal-sidebar ${mobileMenuOpen ? "open" : ""}`}
              aria-label="Portal Navigation"
            >
              {effectiveRole === "dev" ? (
                <>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "dev-logs" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("dev-logs");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Dev Console & Audit Logs"
                  >
                    <Icon name="code" />
                    <span>Dev Console</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "classrooms" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("classrooms");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Classrooms & Venues"
                  >
                    <Icon name="map" />
                    <span>Classrooms</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "schedules" || activeTab === "timetable" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("timetable");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Timetable & Schedules"
                  >
                    <Icon name="calendar" />
                    <span>Courses</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "attendance" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("attendance");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Live Attendance & QR"
                  >
                    <Icon name="check" />
                    <span>Live Attendance</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "directory" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("directory");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Student Directory"
                  >
                    <Icon name="users" />
                    <span>Student Directory</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "profile" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("profile");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="My Profile & Settings"
                  >
                    <Icon name="user" />
                    <span>My Profile & Settings</span>
                  </button>
                </>
              ) : effectiveRole === "admin" ? (
                <>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "attendance" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("attendance");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Live Attendance & QR"
                  >
                    <Icon name="check" />
                    <span>Live Attendance</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "schedules" || activeTab === "timetable" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("timetable");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Timetable & Schedules"
                  >
                    <Icon name="calendar" />
                    <span>Timetable & Courses</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "classrooms" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("classrooms");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Classrooms & Venues"
                  >
                    <Icon name="map" />
                    <span>Classrooms</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "directory" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("directory");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Student Directory"
                  >
                    <Icon name="users" />
                    <span>Student Directory</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "profile" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("profile");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="My Profile & Settings"
                  >
                    <Icon name="user" />
                    <span>My Profile & Settings</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "checkin" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("checkin");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Check-in & Verification"
                  >
                    <Icon name="check" />
                    <span>Check-in</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "timetable" || activeTab === "courses" || activeTab === "schedules" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("timetable");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="My Timetable & Courses"
                  >
                    <Icon name="calendar" />
                    <span>My Timetable & Courses</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "history" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("history");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="Attendance History"
                  >
                    <Icon name="history" />
                    <span>Attendance History</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${activeTab === "profile" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("profile");
                      setMobileMenuOpen(false);
                    }}
                    aria-label="My Profile & Settings"
                  >
                    <Icon name="user" />
                    <span>My Profile & Settings</span>
                  </button>
                </>
              )}
            </nav>

            {mobileMenuOpen && (
              <div
                className="sidebar-backdrop"
                onClick={() => setMobileMenuOpen(false)}
              />
            )}

            <div className="portal-content">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">
                    {effectiveRole === "dev"
                      ? `DEVELOPER CONSOLE · INFRASTRUCTURE AUDIT (${auth.user.dept || "Platform"})`
                      : effectiveRole === "admin"
                        ? `CLASSROOM OVERVIEW · FACULTY PORTAL (${auth.user.dept || "ECE"})`
                        : `STUDENT CHECK-IN · PORTAL (${auth.user.roll || "STUDENT"})`}
                  </p>
                  <h1>{auth.user.name}</h1>
                  <p>
                    {effectiveRole === "dev"
                      ? "Monitor full audit trails, telemetry stats, manage dynamic geo-locations, and reset or export state."
                      : effectiveRole === "admin"
                        ? "Manage course schedules, relocate session geofences on the fly, and review live verification attempts."
                        : `Enrolled Department: ${auth.user.dept || "ECE"} · Registered Email: ${auth.user.email || ""}`}
                  </p>
                </div>
              </div>

              {/* DEVELOPER CONSOLE TAB */}
              {effectiveRole === "dev" && activeTab === "dev-logs" && (
                <>
                  <div className="metrics">
                    <Metric
                      title="Active Sessions"
                      value={state.stats?.activeSessions ?? 0}
                      foot={`Total created: ${state.stats?.totalSessions ?? state.sessions.length}`}
                    />
                    <Metric
                      title="Total Student Attempts"
                      value={
                        state.stats?.totalAttempts ?? state.attempts.length
                      }
                      foot={`Verified: ${state.stats?.verifiedCount ?? 0} · Suspicious: ${state.stats?.suspiciousCount ?? 0}`}
                    />
                    <Metric
                      title="Verification Pass Rate"
                      value={`${state.stats?.passRate ?? 0}%`}
                      foot="Autonomous trust evaluation"
                    />
                    <Metric
                      title="Total Campus Venues"
                      value={state.classrooms?.length || 0}
                      foot={`${state.schedules?.length || 0} course timetables`}
                    />
                  </div>

                  {/* Operations Setup Panel from PortalUI */}
                  <OperationsPanel online={online} api={api} run={run} />

                  <section className="card" style={{ marginTop: 20 }}>
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">AUDIT TRAILS & SECURITY LOGS</p>
                        <h2>System Telemetry & Audit Feed</h2>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="secondary"
                          onClick={() => run(() => api("/dev/logs/clear", {}))}
                        >
                          🗑️ Clear Logs
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            run(async () => {
                              const data = await api("/dev/export");
                              const blob = new Blob(
                                [JSON.stringify(data, null, 2)],
                                { type: "application/json" },
                              );
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `tech-pulse-export-${Date.now()}.json`;
                              a.click();
                            })
                          }
                        >
                          📥 Export JSON
                        </button>
                        <button
                          className="danger-btn"
                          onClick={async () => {
                            if (
                              await ask({
                                title: "Reset all data?",
                                body: "Resets this installation to factory defaults. Schedules, sessions and attendance are removed. This cannot be undone.",
                                confirmLabel: "Reset database",
                                danger: true,
                              })
                            ) {
                              run(() => api("/dev/reset", {}));
                            }
                          }}
                        >
                          ⚠️ Reset Database
                        </button>
                      </div>
                    </div>

                    <div className="filter-pills">
                      {[
                        { key: "all", label: "All Logs" },
                        { key: "attempts", label: "🎯 Student Check-ins" },
                        { key: "sessions", label: "📡 Sessions & Venues" },
                        { key: "geofences", label: "📍 Geofences" },
                        { key: "schedules", label: "📅 Schedules" },
                        { key: "auth", label: "👤 Auth" },
                      ].map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          className={`filter-pill ${logFilter === f.key ? "active" : ""}`}
                          onClick={() => setLogFilter(f.key)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    <div className="table-wrap" style={{ marginTop: 12 }}>
                      {filteredLogs.length === 0 ? (
                        <div className="empty">
                          <span>◎</span>
                          <h3>No logs recorded in this category</h3>
                          <p>
                            Actions taken by professors or students will appear
                            here in real time.
                          </p>
                        </div>
                      ) : (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Time</th>
                                <th>Category</th>
                                <th>Level</th>
                                <th>Actor</th>
                                <th>Event Message</th>
                                <th>Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredLogs.map((l) => (
                                <React.Fragment key={l.id}>
                                  <tr>
                                    <td>
                                      <small style={{ color: "#546458" }}>
                                        {new Date(
                                          l.timestamp,
                                        ).toLocaleTimeString()}
                                      </small>
                                    </td>
                                    <td>
                                      <span className={`log-cat ${l.category}`}>
                                        {l.category}
                                      </span>
                                    </td>
                                    <td>
                                      <span className={`log-level ${l.level}`}>
                                        {l.level}
                                      </span>
                                    </td>
                                    <td>
                                      <strong>
                                        {l.actor?.name || "System"}
                                      </strong>
                                      <small>
                                        ({l.actor?.role || "system"})
                                      </small>
                                    </td>
                                    <td>{l.message}</td>
                                    <td>
                                      {Object.keys(l.details || {}).length >
                                        0 && (
                                        <button
                                          className="secondary"
                                          style={{
                                            padding: "4px 8px",
                                            fontSize: 11,
                                          }}
                                          onClick={() =>
                                            setExpandedLogId(
                                              expandedLogId === l.id
                                                ? null
                                                : l.id,
                                            )
                                          }
                                        >
                                          {expandedLogId === l.id
                                            ? "Hide"
                                            : "Inspect JSON"}
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                  {expandedLogId === l.id && (
                                    <tr>
                                      <td
                                        colSpan={6}
                                        style={{
                                          background: "#f7f9f3",
                                          padding: 12,
                                        }}
                                      >
                                        <pre
                                          style={{
                                            margin: 0,
                                            fontSize: 11,
                                            fontFamily: "monospace",
                                            overflowX: "auto",
                                            color: "#234a3e",
                                          }}
                                        >
                                          {JSON.stringify(l.details, null, 2)}
                                        </pre>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}

              {/* TEACHER / FACULTY / DEV VIEWS */}
              {(effectiveRole === "admin" || effectiveRole === "dev") && (
                <>
                  {/* 1. Live Attendance Tab */}
                  {activeTab === "attendance" && (
                    <>
                      {(() => {
                        const verifiedCount = verified;
                        const sessionAttempts = session
                          ? state.attempts.filter(
                              (a) => a.sessionId === session.id,
                            )
                          : [];
                        const toReviewCount = sessionAttempts.filter(
                          (a) => a.phase === "AWAITING_REVIEW",
                        ).length;
                        const retryCount = sessionAttempts.filter(
                          (a) =>
                            a.phase === "RETRY" || a.phase === "PENDING_REVIEW",
                        ).length;
                        const suspiciousCount = sessionAttempts.filter(
                          (a) => a.decision === "SUSPICIOUS",
                        ).length;
                        const rejectedCount = sessionAttempts.filter(
                          (a) => a.decision === "REJECTED",
                        ).length;
                        const scheduledCourse = session?.scheduleId
                          ? state.schedules?.find(
                              (s) => s.id === session.scheduleId,
                            )
                          : null;
                        const enrolledCount =
                          scheduledCourse?.enrollmentIds?.length || 0;

                        return (
                          <>
                            {manageableSessions.length > 0 && (
                              <label
                                style={{ display: "block", marginBottom: 14 }}
                              >
                                Session shown
                                <select
                                  value={session?.id || ""}
                                  onChange={(e) =>
                                    setSelectedSessionId(e.target.value)
                                  }
                                >
                                  {[...manageableSessions]
                                    .reverse()
                                    .slice(0, 40)
                                    .map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.subject} · {s.classId} ·{" "}
                                        {new Date(s.opensAt).toLocaleString()} ·{" "}
                                        {s.open && now < s.closesAt
                                          ? "open"
                                          : "closed"}
                                      </option>
                                    ))}
                                </select>
                              </label>
                            )}

                            <div className="metrics">
                              <Metric
                                title="Recorded"
                                value={verifiedCount
                                  .toString()
                                  .padStart(2, "0")}
                                foot={session?.room?.name || "No session"}
                              />
                              <Metric
                                title="To review"
                                value={toReviewCount}
                                foot="Awaiting teacher identity review"
                              />
                              <Metric
                                title="Need action"
                                value={retryCount}
                                foot="Student can retry or recapture"
                              />
                              <Metric
                                title="Enrolled"
                                value={enrolledCount}
                                foot={
                                  scheduledCourse
                                    ? scheduledCourse.subject
                                    : "Demo session"
                                }
                              />
                            </div>

                            <section
                              className="card"
                              data-testid="occupancy-panel"
                            >
                              <p className="eyebrow">
                                ESTIMATED ROOM OCCUPANCY
                              </p>
                              <h2>Estimated room occupancy</h2>
                              <p className="caption">
                                Based on approved check-ins, reported check-outs
                                and expiry. People may leave without checking
                                out. Scheduled sessions expire at the class end;
                                demo sessions 60 minutes after they start.
                              </p>
                              {(state.occupancy || []).length === 0 ? (
                                <p>No active check-ins right now.</p>
                              ) : (
                                <ul className="plain-list">
                                  {state.occupancy.map((o) => (
                                    <li key={o.roomId}>
                                      <strong>{o.roomName}:</strong> about{" "}
                                      <span data-testid="occupancy-count">
                                        {o.estimated}
                                      </span>{" "}
                                      {o.scope === "your-sessions"
                                        ? "student(s) from your sessions only — not the whole room's headcount"
                                        : "student(s) across all sessions"}
                                      {o.configuredSeats != null && (
                                        <span className="caption">
                                          {" "}
                                          · configured seats (informational):{" "}
                                          {o.configuredSeats}
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>

                            <section
                              className="card"
                              data-testid="anomaly-panel"
                            >
                              <p className="eyebrow">CHECKS AND ANOMALIES</p>
                              <h2>Checks and anomalies</h2>
                              <p className="caption">
                                Reasons reported by the server for this session.
                                Weak GPS, denied permissions or an unreachable
                                board are not treated as cheating.
                              </p>
                              {(() => {
                                const groups = [
                                  [
                                    "Suspicious evidence",
                                    sessionAttempts.filter(
                                      (a) => a.decision === "SUSPICIOUS",
                                    ),
                                  ],
                                  [
                                    "Rejected checks",
                                    sessionAttempts.filter(
                                      (a) => a.decision === "REJECTED",
                                    ),
                                  ],
                                  [
                                    "Needs action",
                                    sessionAttempts.filter(
                                      (a) =>
                                        !a.decision &&
                                        (a.phase === "RETRY" ||
                                          a.phase === "PENDING_REVIEW"),
                                    ),
                                  ],
                                ];
                                if (groups.every(([, list]) => !list.length))
                                  return <p>Nothing to flag.</p>;
                                return groups.map(
                                  ([label, list]) =>
                                    list.length > 0 && (
                                      <div key={label}>
                                        <h3>
                                          {label} ({list.length})
                                        </h3>
                                        <ul className="plain-list">
                                          {list.map((a) => (
                                            <li key={a.id}>
                                              {state.people?.find(
                                                (x) => x.id === a.uid,
                                              )?.name || a.uid}
                                              :{" "}
                                              {(a.reasons || [])
                                                .map(reasonText)
                                                .join("; ") ||
                                                "No reason recorded"}
                                              {Number.isFinite(a.distance) &&
                                                ` · ${Math.round(a.distance)} m from venue`}
                                              {Number.isFinite(a.accuracy) &&
                                                ` (GPS ±${Math.round(a.accuracy)} m)`}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ),
                                );
                              })()}
                            </section>
                          </>
                        );
                      })()}

                      <div className="admin-grid">
                        <section className="card">
                          <p className="eyebrow">SESSION CONTROL</p>
                          <h2>
                            {session?.open
                              ? session.subject
                              : "Start Attendance Session"}
                          </h2>
                          <p>
                            {session?.open
                              ? `${session.classId} · ${session.room.name}`
                              : "Launch an attendance session or customize room venue parameters."}
                          </p>

                          {session?.open && now < session.closesAt ? (
                            <>
                              <div
                                className="session-status"
                                data-testid="policy-badge"
                              >
                                {session.presenceMode === "local"
                                  ? "Proof: GPS + ESP32 classroom proof + teacher review"
                                  : "Proof: GPS + teacher review (no ESP32)"}
                              </div>
                              <div className="session-status">
                                {session.sessionType === "demo"
                                  ? "DEMO · TIMETABLE OVERRIDE · Attendance open"
                                  : "Scheduled class · Attendance open"}{" "}
                                <strong>
                                  {Math.max(
                                    0,
                                    Math.ceil((session.closesAt - now) / 1000),
                                  )}
                                  s
                                </strong>
                              </div>
                              {qr && (
                                <img
                                  className="qr"
                                  src={qr}
                                  alt="Classroom attendance QR challenge"
                                />
                              )}
                              <p className="caption">
                                QR accepts new claims for{" "}
                                {Math.max(
                                  0,
                                  Math.ceil(
                                    (session.challenge.expiresAt - now) / 1000,
                                  ),
                                )}
                                s. Existing claims keep their deadline.
                              </p>
                              <div className="actions">
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    run(() =>
                                      api(`/sessions/${session.id}/rotate`, {}),
                                    )
                                  }
                                >
                                  Refresh QR
                                </button>
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    run(() =>
                                      api(`/sessions/${session.id}/stop`, {}),
                                    )
                                  }
                                >
                                  Close session
                                </button>
                                {session.presenceMode === "local" && (
                                  <button
                                    className="secondary"
                                    disabled={busy}
                                    onClick={async () => {
                                      if (
                                        await ask({
                                          title:
                                            "Start replacement session without ESP32?",
                                          body: "New claims on this session close and a new GPS + teacher review session starts. Attempts already made keep their original rules and deadlines. Baseline mode gives weaker proof that students are in the room. Students will need to scan the new QR code.",
                                          confirmLabel:
                                            "Start replacement session",
                                        })
                                      )
                                        run(() =>
                                          api(
                                            `/sessions/${session.id}/replace-without-esp32`,
                                            {},
                                          ),
                                        );
                                    }}
                                  >
                                    Start replacement session without ESP32
                                  </button>
                                )}
                              </div>
                              <CopyField
                                label="Student check-in link"
                                value={`${location.origin}/?challenge=${session.challenge.id}`}
                              />

                              <div
                                style={{
                                  marginTop: 12,
                                  padding: "10px 14px",
                                  background: "#f2f5ed",
                                  borderRadius: 8,
                                  fontSize: 11,
                                  border: "1px solid #dbe2d5",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                  }}
                                >
                                  <strong style={{ color: "#1e5145" }}>
                                    📍 Active Venue: {session.room.name}
                                  </strong>
                                  <button
                                    className="secondary"
                                    style={{ padding: "4px 8px", fontSize: 11 }}
                                    onClick={() => {
                                      setRelocateVenue({ ...session.room });
                                      setShowRelocate(!showRelocate);
                                    }}
                                  >
                                    📍 Relocate Venue / Change Geo Point
                                  </button>
                                </div>
                                <div style={{ marginTop: 4 }}>
                                  Center: {session.room.lat.toFixed(5)},{" "}
                                  {session.room.lng.toFixed(5)} · Radius:{" "}
                                  <strong>{session.room.radius}m</strong> · GPS
                                  Error Tolerance: ±
                                  <strong>
                                    {session.room.maxAccuracy || 100}m
                                  </strong>
                                </div>
                                {session.room.radius > 100 && (
                                  <div
                                    style={{
                                      marginTop: 6,
                                      color: "#8a5800",
                                      fontWeight: 500,
                                      fontSize: 11,
                                      background: "#fef9e7",
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      border: "1px solid #fae5b6",
                                    }}
                                  >
                                    ⚠️ Large Geofence (&gt;100m): a broad
                                    perimeter gives weaker proof of presence.
                                    Consider the ESP32 classroom proof for this
                                    venue.
                                  </div>
                                )}
                              </div>

                              <div style={{ marginTop: 12 }}>
                                <ClassroomMap
                                  rooms={state.classrooms || []}
                                  selectedId={
                                    showRelocate
                                      ? relocateVenue.id
                                      : session.room.id
                                  }
                                  sessions={[session]}
                                  compact={true}
                                  draft={
                                    showRelocate
                                      ? {
                                          lat: relocateVenue.lat,
                                          lng: relocateVenue.lng,
                                          radius: relocateVenue.radius,
                                          name:
                                            relocateVenue.name ||
                                            "Relocated Venue",
                                        }
                                      : null
                                  }
                                  onDraftChange={(coords) =>
                                    setRelocateVenue((prev) => ({
                                      ...prev,
                                      lat: coords.lat,
                                      lng: coords.lng,
                                    }))
                                  }
                                />
                              </div>

                              {/* RELOCATE VENUE ON-THE-FLY DRAWER */}
                              {showRelocate && (
                                <div className="relocate-card">
                                  <h4
                                    style={{
                                      margin: "0 0 8px",
                                      color: "#6b541e",
                                    }}
                                  >
                                    📍 Relocate Session to New Geo Point
                                  </h4>
                                  <p
                                    style={{ fontSize: 12, margin: "0 0 10px" }}
                                  >
                                    If moving class or changing venue, update
                                    the session geofence right now. All student
                                    devices will be updated via realtime SSE.
                                  </p>

                                  <label>
                                    Choose Venue from Campus Classrooms
                                    <select
                                      onChange={(e) => {
                                        const found = state.classrooms?.find(
                                          (c) => c.id === e.target.value,
                                        );
                                        if (found)
                                          setRelocateVenue({ ...found });
                                      }}
                                    >
                                      <option value="">
                                        -- Select Campus Classroom --
                                      </option>
                                      {state.classrooms?.map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name} ({c.lat.toFixed(4)},{" "}
                                          {c.lng.toFixed(4)})
                                        </option>
                                      ))}
                                    </select>
                                  </label>

                                  <div className="fields">
                                    <label>
                                      Venue Name
                                      <input
                                        value={relocateVenue.name}
                                        onChange={(e) =>
                                          setRelocateVenue({
                                            ...relocateVenue,
                                            name: e.target.value,
                                          })
                                        }
                                        placeholder="e.g. New Seminar Hall"
                                      />
                                    </label>
                                    <label>
                                      Geofence Radius
                                      <select
                                        value={relocateVenue.radius}
                                        onChange={(e) =>
                                          setRelocateVenue({
                                            ...relocateVenue,
                                            radius: Number(e.target.value),
                                          })
                                        }
                                      >
                                        {[
                                          25, 50, 75, 100, 150, 200, 300, 500,
                                        ].map((r) => (
                                          <option key={r} value={r}>
                                            {r} meters
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>

                                  <div className="fields">
                                    <label>
                                      Latitude
                                      <input
                                        type="number"
                                        step="any"
                                        value={relocateVenue.lat}
                                        onChange={(e) =>
                                          setRelocateVenue({
                                            ...relocateVenue,
                                            lat: Number(e.target.value),
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      Longitude
                                      <input
                                        type="number"
                                        step="any"
                                        value={relocateVenue.lng}
                                        onChange={(e) =>
                                          setRelocateVenue({
                                            ...relocateVenue,
                                            lng: Number(e.target.value),
                                          })
                                        }
                                      />
                                    </label>
                                  </div>

                                  <button
                                    type="button"
                                    className="secondary"
                                    style={{ marginBottom: 10 }}
                                    onClick={() =>
                                      run(async () => {
                                        const l = await getLocation();
                                        setRelocateVenue((prev) => ({
                                          ...prev,
                                          name: "Professor's Current Location",
                                          lat: l.lat,
                                          lng: l.lng,
                                        }));
                                      })
                                    }
                                  >
                                    📍 Pin to My Current GPS Position
                                  </button>

                                  <div style={{ display: "flex", gap: 8 }}>
                                    <button
                                      onClick={() => run(relocateActiveSession)}
                                    >
                                      Update Active Geofence
                                    </button>
                                    <button
                                      className="secondary"
                                      onClick={() => setShowRelocate(false)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <label>
                                Choose Scheduled Course
                                <select
                                  value={selectedScheduleId}
                                  onChange={(e) => {
                                    const sid = e.target.value;
                                    setSelectedScheduleId(sid);
                                    const sched = state.schedules?.find(
                                      (s) => s.id === sid,
                                    );
                                    if (sched) {
                                      const rm = state.classrooms?.find(
                                        (c) => c.id === sched.classroomId,
                                      );
                                      if (rm) setRoom({ ...rm });
                                    }
                                  }}
                                >
                                  {state.schedules?.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.subject} ({s.classId}) · {s.time}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label>
                                Classroom / Venue Location
                                <select
                                  onChange={(e) => {
                                    const found = state.classrooms?.find(
                                      (c) => c.id === e.target.value,
                                    );
                                    if (found) {
                                      setRoom({ ...found });
                                      setRoomSource("classroom");
                                    }
                                  }}
                                >
                                  <option value="">
                                    -- Default Scheduled Venue --
                                  </option>
                                  {state.classrooms?.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name} (Radius {c.radius}m)
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <div
                                style={{
                                  margin: "10px 0",
                                  padding: "10px 12px",
                                  background:
                                    roomSource === "device"
                                      ? "#e4eddc"
                                      : "#fdf6e2",
                                  borderRadius: 8,
                                  fontSize: 12,
                                  border:
                                    "1px solid " +
                                    (roomSource === "device"
                                      ? "#c8dbc0"
                                      : "#eed8a1"),
                                }}
                              >
                                {roomSource === "device" ? (
                                  <span>
                                    ✓ <strong>Classroom Location:</strong>{" "}
                                    Synced to your device ({room.lat.toFixed(5)}
                                    , {room.lng.toFixed(5)})
                                  </span>
                                ) : (
                                  <span>
                                    ⚠️ <strong>Venue Center:</strong>{" "}
                                    {room.name} ({room.lat.toFixed(4)},{" "}
                                    {room.lng.toFixed(4)}
                                    ). If class is at your current spot, click{" "}
                                    <strong>"Use my current location"</strong>.
                                  </span>
                                )}
                              </div>

                              <div className="fields">
                                <label>
                                  Latitude
                                  <input
                                    type="number"
                                    step="any"
                                    value={room.lat}
                                    onChange={(e) =>
                                      setRoom({
                                        ...room,
                                        lat: Number(e.target.value),
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  Longitude
                                  <input
                                    type="number"
                                    step="any"
                                    value={room.lng}
                                    onChange={(e) =>
                                      setRoom({
                                        ...room,
                                        lng: Number(e.target.value),
                                      })
                                    }
                                  />
                                </label>
                              </div>

                              <label>
                                Geofence radius
                                <select
                                  value={room.radius}
                                  onChange={(e) =>
                                    setRoom({
                                      ...room,
                                      radius: Number(e.target.value),
                                    })
                                  }
                                >
                                  {[25, 50, 75, 100, 150, 200, 300, 500].map(
                                    (r) => (
                                      <option key={r} value={r}>
                                        {r} meters
                                      </option>
                                    ),
                                  )}
                                </select>
                              </label>

                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    const l = await getLocation();
                                    setRoom((prev) => ({
                                      ...prev,
                                      lat: l.lat,
                                      lng: l.lng,
                                      radius: Math.max(100, prev.radius || 75),
                                      maxAccuracy: Math.max(
                                        150,
                                        Math.ceil((l.accuracy || 50) * 1.5),
                                      ),
                                      name: "Professor Device Location",
                                    }));
                                    setRoomSource("device");
                                    setLocStatus(
                                      `Captured device coordinates (±${Math.round(l.accuracy)}m)`,
                                    );
                                  })
                                }
                              >
                                📍 Use my current location
                              </button>
                              {locStatus && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "#2c653e",
                                    marginBottom: 6,
                                    textAlign: "center",
                                  }}
                                >
                                  ✓ {locStatus}
                                </div>
                              )}

                              <label>
                                Classroom proof policy
                                <select
                                  value={presenceMode}
                                  onChange={(e) =>
                                    setPresenceMode(e.target.value)
                                  }
                                >
                                  <option value="baseline">
                                    GPS + teacher review — no ESP32 needed
                                  </option>
                                  <option value="local">
                                    GPS + ESP32 classroom proof + teacher review
                                  </option>
                                </select>
                              </label>
                              <p className="caption" data-testid="policy-help">
                                {presenceMode === "baseline"
                                  ? "Students share their location once, take a photo and wait for your review. No device or Wi-Fi switching is needed. Proximity assurance is weaker than with the ESP32 classroom proof."
                                  : "Students must also fetch a signed response from the classroom ESP32 over its Wi-Fi. A missing or offline board means no attendance can be recorded for this session."}
                              </p>
                              {presenceMode === "local" && (
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    run(async () =>
                                      setPresenceStatus(
                                        await api("/presence/status"),
                                      ),
                                    )
                                  }
                                >
                                  Check companion configuration
                                </button>
                              )}
                              {presenceMode === "local" && presenceStatus && (
                                <p className="caption">
                                  {presenceStatus.configured
                                    ? `Configured device: ${presenceStatus.deviceId}, room: ${presenceStatus.roomId}. This does not confirm the device is powered on.`
                                    : "Run npm run esp32:prepare first, then restart the server."}
                                </p>
                              )}
                              <label>
                                Session type
                                <select
                                  aria-label="Session type"
                                  value={sessionType}
                                  onChange={(e) =>
                                    setSessionType(e.target.value)
                                  }
                                >
                                  <option value="scheduled">
                                    Scheduled class (Asia/Kolkata timetable)
                                  </option>
                                  <option value="demo">
                                    Demo session (timetable override)
                                  </option>
                                </select>
                              </label>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(() =>
                                    api("/sessions", {
                                      scheduleId: selectedScheduleId,
                                      room,
                                      presenceMode,
                                      sessionType,
                                    }),
                                  )
                                }
                              >
                                Start selected session
                              </button>
                            </>
                          )}
                        </section>

                        <section className="card activity">
                          <div className="section-heading">
                            <div>
                              <p className="eyebrow">LIVE ACTIVITY</p>
                              <h2>Student attempts</h2>
                            </div>
                            <span className="pill">
                              {session?.sessionType === "demo"
                                ? "DEMO · TIMETABLE OVERRIDE"
                                : "SCHEDULED CLASS"}
                            </span>
                          </div>
                          <p className="caption">
                            Real-time check-in stream with distance, GPS
                            accuracy and review status.
                          </p>
                          {state.attempts.length === 0 ? (
                            <div className="empty">
                              <span>◎</span>
                              <h3>Ready for the first check-in</h3>
                              <p>
                                Start a session, then students can scan the QR
                                code to attend.
                              </p>
                            </div>
                          ) : (
                            <div className="table-wrap">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Student</th>
                                    <th>Outcome</th>
                                    <th>Evidence / Reason</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(() => {
                                    const displayAttempts = session
                                      ? state.attempts.filter(
                                          (a) => a.sessionId === session.id,
                                        )
                                      : state.attempts.slice(-10);
                                    return [...displayAttempts]
                                      .reverse()
                                      .map((a) => {
                                        const studentUser = state.people?.find(
                                          (p) => p.id === a.uid,
                                        );
                                        return (
                                          <tr key={a.id}>
                                            <td>
                                              <div
                                                style={{
                                                  display: "flex",
                                                  alignItems: "center",
                                                  gap: 8,
                                                }}
                                              >
                                                {studentUser?.referencePhoto && (
                                                  <img
                                                    src={
                                                      studentUser.referencePhoto
                                                    }
                                                    alt="Enrolled"
                                                    title="Enrolled Reference Face"
                                                    style={{
                                                      width: 28,
                                                      height: 28,
                                                      borderRadius: "50%",
                                                      objectFit: "cover",
                                                      border:
                                                        "1px solid #c0d0c0",
                                                    }}
                                                  />
                                                )}
                                                {a.photo && (
                                                  <img
                                                    src={a.photo}
                                                    alt="Captured"
                                                    title="Live Check-in Photo"
                                                    style={{
                                                      width: 28,
                                                      height: 28,
                                                      borderRadius: "50%",
                                                      objectFit: "cover",
                                                      border:
                                                        "1px solid #b7cc69",
                                                    }}
                                                  />
                                                )}
                                                <div>
                                                  <strong>
                                                    {studentUser?.name || a.uid}
                                                  </strong>
                                                  <small>
                                                    {studentUser?.roll || a.uid}
                                                  </small>
                                                </div>
                                              </div>
                                            </td>
                                            <td>
                                              <Badge attempt={a} />
                                              {a.phase ===
                                                "AWAITING_REVIEW" && (
                                                <div>
                                                  <p>
                                                    Teacher identity review
                                                    required. Similarity is
                                                    advisory.
                                                  </p>
                                                  <button
                                                    disabled={busy}
                                                    onClick={() =>
                                                      run(() =>
                                                        api(
                                                          `/attempts/${a.id}/review`,
                                                          {
                                                            decision: "approve",
                                                          },
                                                        ),
                                                      )
                                                    }
                                                  >
                                                    Approve identity
                                                  </button>
                                                  <button
                                                    disabled={busy}
                                                    onClick={() =>
                                                      run(() =>
                                                        api(
                                                          `/attempts/${a.id}/review`,
                                                          {
                                                            decision: "reject",
                                                          },
                                                        ),
                                                      )
                                                    }
                                                  >
                                                    Reject identity
                                                  </button>
                                                </div>
                                              )}
                                              {Number.isFinite(
                                                a.advisorySimilarity,
                                              ) && (
                                                <div
                                                  style={{
                                                    fontSize: 10,
                                                    color:
                                                      "var(--secondary-text)",
                                                    marginTop: 2,
                                                  }}
                                                >
                                                  Advisory similarity{" "}
                                                  {Math.round(
                                                    a.advisorySimilarity,
                                                  )}
                                                  %
                                                </div>
                                              )}
                                              <button
                                                type="button"
                                                className="secondary"
                                                style={{
                                                  padding: "3px 8px",
                                                  fontSize: 11,
                                                  marginTop: 4,
                                                  display: "block",
                                                }}
                                                onClick={() =>
                                                  setReviewingAttemptId(a.id)
                                                }
                                              >
                                                🔍 Review Photos
                                              </button>
                                            </td>
                                            <td>
                                              {a.simulated && (
                                                <small className="sim-label">
                                                  SIMULATED
                                                </small>
                                              )}
                                              <div>
                                                {pretty(
                                                  a.reasons.join(" · "),
                                                ) || "Collecting evidence"}
                                              </div>
                                              {Number.isFinite(a.distance) && (
                                                <small
                                                  style={{
                                                    color: "#4f6354",
                                                    display: "block",
                                                    marginTop: 2,
                                                  }}
                                                >
                                                  Dist: {Math.round(a.distance)}
                                                  m{" "}
                                                  {a.accuracy
                                                    ? `(±${Math.round(a.accuracy)}m)`
                                                    : ""}
                                                </small>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      });
                                  })()}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </section>
                      </div>

                      {reviewingAttempt && (
                        <Modal
                          open={!!reviewingAttempt}
                          onClose={() => setReviewingAttemptId(null)}
                          title="Student identity review"
                        >
                          {(() => {
                            const studentUser =
                              state.people?.find(
                                (p) => p.id === reviewingAttempt.uid,
                              ) ||
                              accounts?.find(
                                (u) => u.id === reviewingAttempt.uid,
                              );
                            const studentName =
                              studentUser?.name || reviewingAttempt.uid;
                            const studentRoll =
                              studentUser?.roll || reviewingAttempt.uid;
                            const studentDept = studentUser?.dept || "ECE";
                            return (
                              <div>
                                <div
                                  style={{
                                    padding: "10px 14px",
                                    background: "#f1f5f9",
                                    borderRadius: "var(--radius-control)",
                                    marginBottom: 16,
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                  }}
                                >
                                  <div>
                                    <strong>{studentName}</strong> (
                                    {studentRoll})
                                    <div
                                      style={{
                                        fontSize: 12,
                                        color: "var(--secondary-text)",
                                      }}
                                    >
                                      Department: {studentDept} · Attempt ID:{" "}
                                      <code>{reviewingAttempt.id}</code>
                                    </div>
                                  </div>
                                  <StatusBadge attempt={reviewingAttempt} />
                                </div>

                                <div className="review-photo-comparison">
                                  <div className="review-photo-card">
                                    <strong
                                      style={{
                                        marginBottom: 8,
                                        fontSize: 13,
                                      }}
                                    >
                                      Enrolled Reference Face
                                    </strong>
                                    {studentUser?.referencePhoto ? (
                                      <button
                                        type="button"
                                        className="photo-zoom"
                                        aria-label="Enlarge photo"
                                        onClick={() =>
                                          setZoomPhoto({
                                            src: studentUser.referencePhoto,
                                            alt: `Enrolled Reference for ${studentName}`,
                                          })
                                        }
                                      >
                                        <img
                                          src={studentUser.referencePhoto}
                                          alt={`Enrolled Reference for ${studentName}`}
                                        />
                                      </button>
                                    ) : (
                                      <div className="photo-placeholder">
                                        No reference face enrolled
                                      </div>
                                    )}
                                    <small
                                      style={{
                                        color: "var(--secondary-text)",
                                      }}
                                    >
                                      Official Campus Profile Face
                                    </small>
                                  </div>

                                  <div className="review-photo-card">
                                    <strong
                                      style={{
                                        marginBottom: 8,
                                        fontSize: 13,
                                      }}
                                    >
                                      Live Check-in Evidence Photo
                                    </strong>
                                    {reviewingAttempt.photo ? (
                                      <button
                                        type="button"
                                        className="photo-zoom"
                                        aria-label="Enlarge photo"
                                        onClick={() =>
                                          setZoomPhoto({
                                            src: reviewingAttempt.photo,
                                            alt: `Captured Live Check-in for ${studentName}`,
                                          })
                                        }
                                      >
                                        <img
                                          src={reviewingAttempt.photo}
                                          alt={`Captured Live Check-in for ${studentName}`}
                                        />
                                      </button>
                                    ) : (
                                      <div className="photo-placeholder">
                                        {reviewingAttempt.phase === "COMPLETED"
                                          ? "Review completed; evidence discarded"
                                          : "Evidence expired; student must recapture"}
                                      </div>
                                    )}
                                    <small
                                      style={{
                                        color: "var(--secondary-text)",
                                      }}
                                    >
                                      Temporary In-Memory Device Capture
                                    </small>
                                  </div>
                                </div>

                                <div className="review-metrics-box">
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      marginBottom: 6,
                                    }}
                                  >
                                    <strong>Advisory image similarity:</strong>
                                    <span style={{ fontWeight: 700 }}>
                                      {Number.isFinite(
                                        reviewingAttempt.advisorySimilarity,
                                      )
                                        ? `${Math.round(reviewingAttempt.advisorySimilarity)}%`
                                        : "Not available (no reference photo)"}
                                    </span>
                                  </div>
                                  <p
                                    style={{
                                      margin: "4px 0",
                                      fontSize: 12,
                                      color: "var(--secondary-text)",
                                    }}
                                  >
                                    Multi-metric visual feature comparison (edge
                                    gradients, luminance histogram, spatial
                                    blocks). Similarity score is advisory;
                                    teacher identity review is authoritative.
                                  </p>
                                  {Number.isFinite(
                                    reviewingAttempt.distance,
                                  ) && (
                                    <div style={{ marginTop: 8, fontSize: 12 }}>
                                      📍 <strong>Distance from venue:</strong>{" "}
                                      {Math.round(reviewingAttempt.distance)}m
                                      {reviewingAttempt.accuracy
                                        ? ` (GPS accuracy ±${Math.round(reviewingAttempt.accuracy)}m)`
                                        : ""}
                                    </div>
                                  )}
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    gap: 10,
                                    justifyContent: "flex-end",
                                    marginTop: 18,
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => setReviewingAttemptId(null)}
                                  >
                                    Close
                                  </button>
                                  {reviewingAttempt.phase === "COMPLETED" && (
                                    <span
                                      style={{
                                        alignSelf: "center",
                                        fontSize: 13,
                                      }}
                                    >
                                      Review completed
                                    </span>
                                  )}
                                  {reviewingAttempt.phase === "RETRY" && (
                                    <span
                                      style={{
                                        alignSelf: "center",
                                        fontSize: 13,
                                      }}
                                    >
                                      Student must recapture
                                    </span>
                                  )}
                                  {reviewingAttempt.phase ===
                                    "AWAITING_REVIEW" && (
                                    <>
                                      <button
                                        type="button"
                                        className="danger-btn"
                                        disabled={
                                          busy || !reviewingAttempt.photo
                                        }
                                        onClick={() =>
                                          run(async () => {
                                            await api(
                                              `/attempts/${reviewingAttempt.id}/review`,
                                              { decision: "reject" },
                                            );
                                          })
                                        }
                                      >
                                        Reject Identity
                                      </button>
                                      <button
                                        type="button"
                                        disabled={
                                          busy || !reviewingAttempt.photo
                                        }
                                        onClick={() =>
                                          run(async () => {
                                            await api(
                                              `/attempts/${reviewingAttempt.id}/review`,
                                              { decision: "approve" },
                                            );
                                          })
                                        }
                                      >
                                        Approve Identity
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </Modal>
                      )}
                    </>
                  )}

                  {/* 2. Timetable & Schedules Tab (Calendar with Day, Week, Month, List) */}
                  {(activeTab === "schedules" || activeTab === "timetable") && (
                    <section className="card">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">
                            {effectiveRole === "dev"
                              ? "CAMPUS MASTER TIMETABLE"
                              : "FACULTY TIMETABLE"}
                          </p>
                          <h2>
                            {effectiveRole === "dev"
                              ? "Master Campus Schedules & Timetables"
                              : "My Teaching Timetables & Schedules"}
                          </h2>
                        </div>
                        <button
                          onClick={() => {
                            setEditingSchedule(null);
                            const allStudentIds = (state.people || [])
                              .filter((p) => p.role === "student")
                              .map((s) => s.id);
                            setScheduleForm({
                              subject: "",
                              classId: "",
                              classroomId: state.classrooms[0]?.id || "room-1",
                              teacherId: auth.user.id,
                              time: "09:00 - 10:30",
                              days: "Mon, Wed, Fri",
                              enrollmentIds: allStudentIds,
                            });
                            setShowNewSchedule(true);
                          }}
                        >
                          ➕ Add New Course Schedule
                        </button>
                      </div>

                      <ScheduleCalendar
                        schedules={state.schedules}
                        classrooms={state.classrooms}
                        people={state.people}
                        currentUser={auth.user}
                        effectiveRole={effectiveRole}
                        canLaunchSession={true}
                        onLaunchSession={(s) => {
                          setSelectedScheduleId(s.id);
                          const rm = state.classrooms?.find(
                            (c) => c.id === s.classroomId,
                          );
                          if (rm) setRoom({ ...rm });
                          setActiveTab("attendance");
                        }}
                        onEditSchedule={(s) => {
                          setEditingSchedule(s);
                          setScheduleForm({
                            subject: s.subject,
                            classId: s.classId,
                            classroomId: s.classroomId,
                            teacherId: s.teacherId || auth.user.id,
                            time: s.time,
                            days: s.days,
                            enrollmentIds: Array.isArray(s.enrollmentIds)
                              ? [...s.enrollmentIds]
                              : [],
                          });
                          setShowNewSchedule(true);
                        }}
                        onDeleteSchedule={(id) =>
                          run(() => handleDeleteSchedule(id))
                        }
                        onAddSchedule={() => {
                          setEditingSchedule(null);
                          const allStudentIds = (state.people || [])
                            .filter((p) => p.role === "student")
                            .map((s) => s.id);
                          setScheduleForm({
                            subject: "",
                            classId: "",
                            classroomId: state.classrooms[0]?.id || "room-1",
                            teacherId: auth.user.id,
                            time: "09:00 - 10:30",
                            days: "Mon, Wed, Fri",
                            enrollmentIds: allStudentIds,
                          });
                          setShowNewSchedule(true);
                        }}
                      />
                    </section>
                  )}

                  {/* 3. Classrooms & Geo Locations Tab (with Interactive Map, Create, Edit & Draggable Pin) */}
                  {activeTab === "classrooms" && (
                    <section className="card">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">CAMPUS SPATIAL MANAGEMENT</p>
                          <h2>Geo Locations & Geofence Boundaries</h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingClassroom(null);
                            setClassroomForm({
                              name: "",
                              capacity: 40,
                              lat: 13.0827,
                              lng: 80.2707,
                              radius: 75,
                              maxAccuracy: 100,
                            });
                            setShowNewClassroom(true);
                          }}
                        >
                          ➕ Create New Geo Location
                        </button>
                      </div>

                      <div className="classroom-workspace-layout">
                        <div className="classroom-list-pane">
                          {showNewClassroom && (
                            <div
                              style={{
                                background: "#f8fafc",
                                border: "1px solid var(--border)",
                                borderRadius: "var(--radius-card)",
                                padding: 18,
                                marginBottom: 16,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  marginBottom: 8,
                                }}
                              >
                                <h3 style={{ margin: 0, fontSize: 16 }}>
                                  {editingClassroom
                                    ? `Edit: ${editingClassroom.name}`
                                    : "Create New Campus Geo Location"}
                                </h3>
                                <span className="pill" style={{ margin: 0 }}>
                                  Interactive Map Pin
                                </span>
                              </div>
                              <p
                                className="caption"
                                style={{ marginBottom: 14 }}
                              >
                                Drag the highlighted pin on the map to set exact
                                coordinates, or enter latitude/longitude below.
                              </p>
                              <form onSubmit={handleSaveClassroom}>
                                <div className="fields">
                                  <label>
                                    Venue / Room Name
                                    <input
                                      required
                                      value={classroomForm.name}
                                      onChange={(e) =>
                                        setClassroomForm({
                                          ...classroomForm,
                                          name: e.target.value,
                                        })
                                      }
                                      placeholder="e.g. Main Auditorium"
                                    />
                                  </label>
                                  <label>
                                    Configured seats (informational only)
                                    <input
                                      type="number"
                                      required
                                      value={classroomForm.capacity}
                                      onChange={(e) =>
                                        setClassroomForm({
                                          ...classroomForm,
                                          capacity: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                </div>

                                <div className="fields">
                                  <label>
                                    Latitude
                                    <input
                                      type="number"
                                      step="any"
                                      required
                                      value={classroomForm.lat}
                                      onChange={(e) =>
                                        setClassroomForm({
                                          ...classroomForm,
                                          lat: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Longitude
                                    <input
                                      type="number"
                                      step="any"
                                      required
                                      value={classroomForm.lng}
                                      onChange={(e) =>
                                        setClassroomForm({
                                          ...classroomForm,
                                          lng: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                </div>

                                <button
                                  type="button"
                                  className="secondary"
                                  style={{ marginBottom: 12 }}
                                  onClick={() =>
                                    run(async () => {
                                      const l = await getLocation();
                                      setClassroomForm((prev) => ({
                                        ...prev,
                                        lat: l.lat,
                                        lng: l.lng,
                                      }));
                                    })
                                  }
                                >
                                  📍 Capture My Current GPS Coordinates
                                </button>

                                <div className="fields">
                                  <label>
                                    Geofence Radius
                                    <select
                                      value={classroomForm.radius}
                                      onChange={(e) =>
                                        setClassroomForm({
                                          ...classroomForm,
                                          radius: Number(e.target.value),
                                        })
                                      }
                                    >
                                      {[
                                        25, 50, 75, 100, 150, 200, 300, 500,
                                      ].map((r) => (
                                        <option key={r} value={r}>
                                          {r} meters
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label>
                                    Max Accuracy Policy
                                    <select
                                      value={classroomForm.maxAccuracy}
                                      onChange={(e) =>
                                        setClassroomForm({
                                          ...classroomForm,
                                          maxAccuracy: Number(e.target.value),
                                        })
                                      }
                                    >
                                      {[50, 80, 100, 150, 200].map((a) => (
                                        <option key={a} value={a}>
                                          ±{a} meters
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>

                                {classroomForm.radius > 100 && (
                                  <div
                                    style={{
                                      color: "#8a5800",
                                      fontSize: 11,
                                      marginBottom: 8,
                                      padding: "6px 10px",
                                      background: "#fdf8e2",
                                      borderRadius: 6,
                                      border: "1px solid #fae5b6",
                                    }}
                                  >
                                    ⚠️ Large Geofence (&gt;100m): a broad
                                    perimeter gives weaker proof of presence.
                                    Consider the ESP32 classroom proof for this
                                    venue.
                                  </div>
                                )}

                                <div
                                  style={{
                                    display: "flex",
                                    gap: 8,
                                    marginTop: 12,
                                  }}
                                >
                                  <button type="submit" disabled={busy}>
                                    Save Geo Location
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => {
                                      setShowNewClassroom(false);
                                      setEditingClassroom(null);
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </form>
                            </div>
                          )}

                          <div className="card-grid">
                            {state.classrooms?.map((c) => {
                              const isSelected =
                                (selectedClassroomId ||
                                  state.classrooms?.[0]?.id) === c.id;
                              return (
                                <div
                                  key={c.id}
                                  className={`item-card ${isSelected ? "selected-card" : ""}`}
                                  onClick={() => setSelectedClassroomId(c.id)}
                                >
                                  <div>
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        marginBottom: 8,
                                      }}
                                    >
                                      <span
                                        className="pill"
                                        style={{ fontSize: 10, margin: 0 }}
                                      >
                                        GEOFENCE: {c.radius} M
                                      </span>
                                      <div style={{ display: "flex", gap: 6 }}>
                                        <button
                                          type="button"
                                          className="secondary"
                                          style={{
                                            padding: "3px 8px",
                                            fontSize: 11,
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedClassroomId(c.id);
                                            setEditingClassroom(c);
                                            setClassroomForm({ ...c });
                                            setShowNewClassroom(true);
                                          }}
                                        >
                                          ✏️ Edit
                                        </button>
                                        <button
                                          type="button"
                                          className="danger-btn"
                                          style={{
                                            padding: "3px 8px",
                                            fontSize: 11,
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            run(() =>
                                              handleDeleteClassroom(c.id),
                                            );
                                          }}
                                        >
                                          🗑️
                                        </button>
                                      </div>
                                    </div>

                                    <h3>{c.name}</h3>
                                    <p
                                      style={{ margin: "6px 0", fontSize: 12 }}
                                    >
                                      Center: {c.lat.toFixed(5)},{" "}
                                      {c.lng.toFixed(5)}
                                    </p>
                                    <p
                                      style={{ margin: "4px 0", fontSize: 12 }}
                                    >
                                      Geofence Radius:{" "}
                                      <strong>{c.radius} meters</strong>
                                    </p>
                                    <p
                                      style={{ margin: "4px 0", fontSize: 12 }}
                                    >
                                      Accuracy Policy: ±{c.maxAccuracy} meters
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    className="secondary"
                                    style={{ marginTop: 14 }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRoom({ ...c });
                                      setActiveTab("attendance");
                                    }}
                                  >
                                    Use Geofence for Active Session
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="classroom-map-pane">
                          <ClassroomMap
                            rooms={state.classrooms || []}
                            selectedId={
                              selectedClassroomId || state.classrooms?.[0]?.id
                            }
                            onSelect={(id) => {
                              setSelectedClassroomId(id);
                              const found = state.classrooms?.find(
                                (c) => c.id === id,
                              );
                              if (found && editingClassroom) {
                                setEditingClassroom(found);
                                setClassroomForm({ ...found });
                              }
                            }}
                            sessions={state.sessions || []}
                            draft={
                              showNewClassroom
                                ? {
                                    lat: classroomForm.lat,
                                    lng: classroomForm.lng,
                                    radius: classroomForm.radius,
                                    name: classroomForm.name || "Draft Venue",
                                  }
                                : null
                            }
                            onDraftChange={(coords) =>
                              setClassroomForm((prev) => ({
                                ...prev,
                                lat: coords.lat,
                                lng: coords.lng,
                              }))
                            }
                          />
                        </div>
                      </div>
                    </section>
                  )}

                  {/* 4. Student & Faculty Directory */}
                  {activeTab === "directory" && (
                    <section className="card">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">CAMPUS ROSTER</p>
                          <h2>Student & Faculty Directory</h2>
                        </div>
                      </div>
                      <div className="table-wrap" style={{ marginTop: 16 }}>
                        <table>
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Role & ID</th>
                              <th>Email</th>
                              <th>Reference photo</th>
                              {auth?.user?.role === "dev" && (
                                <th>Role control</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {state.people?.map((p) => (
                              <tr key={p.id}>
                                <td>
                                  <strong>{p.name}</strong>
                                  <small>{p.dept || "ECE"}</small>
                                </td>
                                <td>
                                  <span
                                    className={`badge ${
                                      p.role === "admin"
                                        ? "verified"
                                        : p.role === "dev"
                                          ? "simulated"
                                          : ""
                                    }`}
                                  >
                                    {p.role === "admin"
                                      ? "Teacher"
                                      : p.role === "dev"
                                        ? "Dev"
                                        : p.roll || "Student"}
                                  </span>
                                </td>
                                <td>{p.email}</td>
                                <td>
                                  {p.referencePhoto ? (
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                      }}
                                    >
                                      <img
                                        src={p.referencePhoto}
                                        alt={p.name}
                                        style={{
                                          width: 28,
                                          height: 28,
                                          borderRadius: "50%",
                                          objectFit: "cover",
                                        }}
                                      />
                                      <span className="badge registered">
                                        ✓ Registered
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="badge pending">
                                      ⚠️ Not Registered
                                    </span>
                                  )}
                                </td>
                                {auth?.user?.role === "dev" && (
                                  <td>
                                    {p.role === "dev" ? (
                                      <span className="caption">Fixed</span>
                                    ) : (
                                      <select
                                        aria-label={`Role for ${p.name}`}
                                        value={p.role}
                                        disabled={busy}
                                        onChange={(e) =>
                                          run(() =>
                                            api(`/people/${p.id}/role`, {
                                              role: e.target.value,
                                            }),
                                          )
                                        }
                                      >
                                        <option value="student">Student</option>
                                        <option value="admin">Teacher</option>
                                      </select>
                                    )}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}

              {/* STUDENT VIEWS */}
              {effectiveRole === "student" && (
                <>
                  {/* 1. Student Check-in Tab */}
                  {activeTab === "checkin" && (
                    <>
                      {/* Today's Schedule Widget */}
                      {(() => {
                        const todayDate = new Date();
                        const dayOfWeek = todayDate.getDay();
                        const todayClasses = (state.schedules || []).filter(
                          (s) => {
                            if (!s.days) return false;
                            const d = s.days.toLowerCase();
                            const dayKeys = [
                              "sun",
                              "mon",
                              "tue",
                              "wed",
                              "thu",
                              "fri",
                              "sat",
                            ];
                            return (
                              d.includes(dayKeys[dayOfWeek]) ||
                              d.includes("daily") ||
                              d.includes("every day")
                            );
                          },
                        );
                        const dayNames = [
                          "Sunday",
                          "Monday",
                          "Tuesday",
                          "Wednesday",
                          "Thursday",
                          "Friday",
                          "Saturday",
                        ];
                        const monthNames = [
                          "Jan",
                          "Feb",
                          "Mar",
                          "Apr",
                          "May",
                          "Jun",
                          "Jul",
                          "Aug",
                          "Sep",
                          "Oct",
                          "Nov",
                          "Dec",
                        ];
                        const dateTitle = `${dayNames[dayOfWeek]}, ${monthNames[todayDate.getMonth()]} ${todayDate.getDate()}`;

                        return (
                          <section
                            className="card"
                            style={{ marginBottom: 16 }}
                          >
                            <div className="section-heading">
                              <div>
                                <p className="eyebrow">
                                  TODAY'S TIMETABLE · {dateTitle.toUpperCase()}
                                </p>
                                <h2>
                                  Today's Scheduled Classes (
                                  {todayClasses.length})
                                </h2>
                              </div>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setActiveTab("timetable")}
                              >
                                🗓️ View Full Interactive Calendar
                              </button>
                            </div>

                            {todayClasses.length === 0 ? (
                              <p
                                style={{
                                  color: "#7a8a7f",
                                  fontSize: 13,
                                  margin: "10px 0 4px",
                                }}
                              >
                                No scheduled classes for today (
                                {dayNames[dayOfWeek]}). Click above to inspect
                                your complete weekly and monthly timetable.
                              </p>
                            ) : (
                              <div
                                className="accounts"
                                style={{ marginTop: 12 }}
                              >
                                {todayClasses.map((cls) => {
                                  const room = state.classrooms?.find(
                                    (c) => c.id === cls.classroomId,
                                  );
                                  const teacher = teachers.find(
                                    (t) => t.id === cls.teacherId,
                                  );
                                  const activeSession = state.sessions?.find(
                                    (sess) =>
                                      sess.open && sess.scheduleId === cls.id,
                                  );

                                  return (
                                    <div
                                      key={cls.id}
                                      style={{
                                        border: activeSession
                                          ? "2px solid #1e5145"
                                          : "1px solid #dbe3dc",
                                        background: activeSession
                                          ? "#f4faf6"
                                          : "#ffffff",
                                        padding: "12px 16px",
                                        borderRadius: 10,
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        gap: 12,
                                      }}
                                    >
                                      <div>
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            marginBottom: 4,
                                          }}
                                        >
                                          <span className="pill">
                                            {cls.classId}
                                          </span>
                                          <strong>{cls.subject}</strong>
                                          {activeSession && (
                                            <span className="badge verified">
                                              ● Attendance Open Now
                                            </span>
                                          )}
                                        </div>
                                        <div
                                          style={{
                                            fontSize: 12,
                                            color: "#4f6354",
                                          }}
                                        >
                                          ⏰ {cls.time} · 📍{" "}
                                          {room?.name || cls.classroomId} · 👨‍🏫{" "}
                                          {teacher?.name || "Assigned Faculty"}
                                        </div>
                                      </div>

                                      {activeSession && (
                                        <button
                                          type="button"
                                          style={{
                                            fontSize: 12,
                                            padding: "6px 14px",
                                            whiteSpace: "nowrap",
                                          }}
                                          onClick={() => {
                                            if (
                                              activeSession.challenge?.token
                                            ) {
                                              setChallenge(
                                                `${window.location.origin}?challenge=${activeSession.challenge.token}`,
                                              );
                                            }
                                          }}
                                        >
                                          ⚡ Check-In Now
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        );
                      })()}

                      {/* Student Privacy Guarantee (Phase 9) */}
                      <div
                        className="privacy-banner"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 16px",
                          background: "#e8f4ec",
                          border: "1px solid #c3decb",
                          borderRadius: 10,
                          marginBottom: 16,
                          fontSize: 12,
                          color: "#1d473b",
                        }}
                      >
                        <span style={{ fontSize: 22 }}>🛡️</span>
                        <div>
                          <strong>
                            Privacy Guarantee: VERIFY PRESENCE — DO NOT TRACK
                            STUDENTS
                          </strong>
                          <div style={{ color: "#3a6356", marginTop: 2 }}>
                            Location data is verified strictly on-demand during
                            attendance check-in. The platform never continuously
                            tracks movement, monitors background GPS, or stores
                            tracking history.
                          </div>
                        </div>
                      </div>

                      {/* Stepped Verification Pipeline UX Tracker (Phase 10) */}
                      <div
                        className="stepped-tracker"
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(130px, 1fr))",
                          gap: 8,
                          marginBottom: 20,
                        }}
                      >
                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: 8,
                            background: "#ffffff",
                            border: "1px solid #dce3d6",
                            textAlign: "center",
                            fontSize: 11,
                          }}
                        >
                          <div style={{ color: "#2c653e", fontWeight: "bold" }}>
                            ✓ 1. Authenticated
                          </div>
                          <small style={{ color: "#5a6b5c" }}>
                            {auth.user.name} ({auth.user.roll || "Student"})
                          </small>
                        </div>

                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: 8,
                            background: currentAttempt ? "#eaf2e6" : "#ffffff",
                            border: currentAttempt
                              ? "1px solid #2c653e"
                              : "1px solid #dce3d6",
                            textAlign: "center",
                            fontSize: 11,
                          }}
                        >
                          <div
                            style={{
                              color: currentAttempt ? "#2c653e" : "#5a6b5c",
                              fontWeight: "bold",
                            }}
                          >
                            {currentAttempt
                              ? "✓ 2. Joined Session"
                              : "2. Claim Challenge"}
                          </div>
                          <small style={{ color: "#5a6b5c" }}>
                            {currentAttempt
                              ? `${Math.max(0, Math.ceil((currentAttempt.deadline - now) / 1000))}s window`
                              : "Scan QR Link"}
                          </small>
                        </div>

                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: 8,
                            background:
                              evidence.location ||
                              currentAttempt?.distance !== undefined
                                ? "#eaf2e6"
                                : "#ffffff",
                            border:
                              evidence.location ||
                              currentAttempt?.distance !== undefined
                                ? "1px solid #2c653e"
                                : "1px solid #dce3d6",
                            textAlign: "center",
                            fontSize: 11,
                          }}
                        >
                          <div
                            style={{
                              color:
                                evidence.location ||
                                currentAttempt?.distance !== undefined
                                  ? "#2c653e"
                                  : "#5a6b5c",
                              fontWeight: "bold",
                            }}
                          >
                            {evidence.location ||
                            currentAttempt?.distance !== undefined
                              ? "✓ 3. Location Checked"
                              : "3. Location Check"}
                          </div>
                          <small style={{ color: "#5a6b5c" }}>
                            {evidence.location
                              ? "GPS Acquired"
                              : "Read Location"}
                          </small>
                        </div>

                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: 8,
                            background:
                              photo || evidence.photo ? "#eaf2e6" : "#ffffff",
                            border:
                              photo || evidence.photo
                                ? "1px solid #2c653e"
                                : "1px solid #dce3d6",
                            textAlign: "center",
                            fontSize: 11,
                          }}
                        >
                          <div
                            style={{
                              color:
                                photo || evidence.photo ? "#2c653e" : "#5a6b5c",
                              fontWeight: "bold",
                            }}
                          >
                            {photo || evidence.photo
                              ? "✓ 4. Face Captured"
                              : "4. Photo evidence"}
                          </div>
                          <small style={{ color: "#5a6b5c" }}>
                            Photo evidence for teacher review
                          </small>
                        </div>

                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: 8,
                            background:
                              currentAttempt?.decision === "VERIFIED"
                                ? "#d9ead3"
                                : currentAttempt?.decision === "REJECTED"
                                  ? "#fae9de"
                                  : currentAttempt?.decision === "SUSPICIOUS"
                                    ? "#fdf2d5"
                                    : "#ffffff",
                            border: currentAttempt?.decision
                              ? "1px solid #999"
                              : "1px solid #dce3d6",
                            textAlign: "center",
                            fontSize: 11,
                          }}
                        >
                          <div
                            style={{
                              color:
                                currentAttempt?.decision === "VERIFIED"
                                  ? "#2c653e"
                                  : currentAttempt?.decision === "REJECTED"
                                    ? "#964928"
                                    : currentAttempt?.decision === "SUSPICIOUS"
                                      ? "#8a5800"
                                      : "#5a6b5c",
                              fontWeight: "bold",
                            }}
                          >
                            {currentAttempt?.decision || currentAttempt?.phase
                              ? `5. ${outcomeText(currentAttempt)}`
                              : "5. Final Result"}
                          </div>
                          <small style={{ color: "#5a6b5c" }}>
                            {currentAttempt?.decision
                              ? "Teacher review completed"
                              : "Awaiting submit"}
                          </small>
                        </div>
                      </div>

                      <div className="student-grid">
                        <section className="card">
                          <p className="eyebrow">01 / CLASSROOM CHALLENGE</p>
                          <h2>Join Attendance Session</h2>
                          <p>
                            Scan your teacher’s active QR challenge or enter the
                            classroom link.
                          </p>
                          <label>
                            QR link or challenge code
                            <input
                              value={challenge}
                              onChange={(e) => setChallenge(e.target.value)}
                              placeholder="Paste the classroom link"
                            />
                          </label>
                          <button
                            disabled={busy || !challenge}
                            onClick={() => run(claim)}
                          >
                            Claim attendance attempt
                          </button>

                          {currentAttempt && (
                            <div className="claim-note">
                              Attempt claimed ·{" "}
                              {Math.max(
                                0,
                                Math.ceil(
                                  (currentAttempt.deadline - now) / 1000,
                                ),
                              )}
                              s remaining. Refreshing the QR does not cancel it.
                            </div>
                          )}

                          <div className="divider" />

                          {currentAttempt &&
                            state.sessions.find(
                              (s) => s.id === currentAttempt.sessionId,
                            )?.presenceMode === "local" && (
                              <section className="explanation">
                                <h3>ESP32 classroom proof required</h3>
                                <p>
                                  Collect location and photo first. Then
                                  generate a request, join the classroom Wi-Fi,
                                  and open its portal in Safari or Chrome. After
                                  copying the response, rejoin the laptop’s
                                  shared Wi-Fi and return to this tab.
                                </p>
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    run(async () =>
                                      setProofRequest(
                                        await api(
                                          `/attempts/${currentAttempt.id}/presence-request`,
                                          {},
                                        ),
                                      ),
                                    )
                                  }
                                >
                                  Generate companion request
                                </button>
                                {proofRequest && (
                                  <>
                                    <p>
                                      Wi-Fi: {proofRequest.ssid} · Portal:{" "}
                                      {proofRequest.portalUrl}
                                    </p>
                                    <label>
                                      Companion request code
                                      <textarea
                                        readOnly
                                        value={proofRequest.requestCode}
                                        onFocus={(e) => e.target.select()}
                                        style={{ width: "100%", minHeight: 90 }}
                                      />
                                    </label>
                                  </>
                                )}
                                <label>
                                  Companion response code
                                  <textarea
                                    value={proofCode}
                                    onChange={(e) =>
                                      setProofCode(e.target.value)
                                    }
                                    style={{ width: "100%", minHeight: 90 }}
                                  />
                                </label>
                                <p className="caption">
                                  Proof is tied to your attempt. Missing
                                  hardware asks for retry; fallback requires a
                                  teacher-created baseline session. Simulation
                                  cannot bypass a required signature.
                                </p>
                              </section>
                            )}
                          <p className="eyebrow">02 / VERIFICATION EVIDENCE</p>
                          <div>
                            <p className="caption">
                              Live device location and camera check. Location is
                              verified once.
                            </p>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  const l = await getLocation();
                                  setEvidence((prev) => ({
                                    ...prev,
                                    location: l,
                                  }));
                                })
                              }
                            >
                              {evidence.location
                                ? "✓ Location captured · re-read"
                                : "📍 Read my location"}
                            </button>
                            {evidence.location && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "#2c653e",
                                  marginTop: 4,
                                  marginBottom: 8,
                                }}
                              >
                                ✓ Lat: {evidence.location.lat.toFixed(5)}, Lng:{" "}
                                {evidence.location.lng.toFixed(5)} (±
                                {Math.round(evidence.location.accuracy)}m
                                accuracy)
                                {(() => {
                                  const currentSessionRoom =
                                    state.sessions?.find(
                                      (s) => s.id === currentAttempt?.sessionId,
                                    )?.room ||
                                    session?.room ||
                                    room;
                                  if (!currentSessionRoom) return null;
                                  const d = distanceMeters(
                                    currentSessionRoom,
                                    evidence.location,
                                  );
                                  const within =
                                    d <= (currentSessionRoom.radius || 75);
                                  return (
                                    <>
                                      <div
                                        style={{
                                          marginTop: 4,
                                          fontWeight: 600,
                                          color: within ? "#1b4339" : "#a83232",
                                        }}
                                      >
                                        {within ? (
                                          <span>
                                            ✓ Inside Geofence ({Math.round(d)}m
                                            from {currentSessionRoom.name})
                                          </span>
                                        ) : (
                                          <span>
                                            ⚠️ {Math.round(d)}m from{" "}
                                            {currentSessionRoom.name} · Outside{" "}
                                            {currentSessionRoom.radius}m
                                            boundary!
                                          </span>
                                        )}
                                      </div>
                                      <div style={{ marginTop: 10 }}>
                                        <ClassroomMap
                                          rooms={[currentSessionRoom]}
                                          selectedId={currentSessionRoom.id}
                                          location={evidence.location}
                                          compact={true}
                                        />
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            )}

                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  stopCamera();
                                  stream.current = await openCamera();
                                  setCamera(true);
                                })
                              }
                            >
                              {camera
                                ? "Camera open"
                                : photo
                                  ? "✓ Retake photo"
                                  : "📷 Open camera"}
                            </button>

                            {camera && (
                              <div style={{ marginTop: 8 }}>
                                <video ref={video} autoPlay playsInline muted />
                                <button
                                  onClick={() => {
                                    const v = video.current;
                                    if (!v) return;
                                    const w = v.videoWidth || 640;
                                    const h = v.videoHeight || 480;
                                    const c = document.createElement("canvas");
                                    c.width = w;
                                    c.height = h;
                                    c.getContext("2d").drawImage(v, 0, 0, w, h);
                                    const dataUrl = c.toDataURL(
                                      "image/jpeg",
                                      0.6,
                                    );
                                    setPhoto(dataUrl);
                                    setEvidence((prev) => ({
                                      ...prev,
                                      photo: dataUrl,
                                    }));
                                    stopCamera();
                                  }}
                                >
                                  Capture photo
                                </button>
                              </div>
                            )}

                            {photo && !camera && (
                              <div style={{ marginTop: 8 }}>
                                {auth.user.referencePhoto ? (
                                  <div className="face-comparison">
                                    <div className="face-card">
                                      <img
                                        src={auth.user.referencePhoto}
                                        alt="Registered Profile"
                                      />
                                      <small>Registered Face Profile</small>
                                    </div>
                                    <div className="face-card">
                                      <img src={photo} alt="Live Check-in" />
                                      <small>Live Captured Check-in</small>
                                    </div>
                                  </div>
                                ) : (
                                  <img
                                    className="photo"
                                    src={photo}
                                    alt="Live Captured Check-in"
                                  />
                                )}
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "#2c653e",
                                    textAlign: "center",
                                    marginTop: 4,
                                  }}
                                >
                                  ✓ Live photo ready{" "}
                                  {auth.user.referencePhoto
                                    ? "· Teacher review required"
                                    : ""}
                                </div>
                              </div>
                            )}
                          </div>

                          <button
                            disabled={
                              busy ||
                              !currentAttempt ||
                              currentAttempt.decision === "VERIFIED"
                            }
                            onClick={() => run(submit)}
                          >
                            {busy
                              ? "Working…"
                              : currentAttempt?.decision === "VERIFIED"
                                ? "✓ Attendance recorded"
                                : currentAttempt?.decision === "REJECTED"
                                  ? "Re-submit updated evidence"
                                  : "Submit attendance evidence"}
                          </button>
                        </section>

                        <aside>
                          <section className="card result">
                            <p className="eyebrow">03 / ATTENDANCE RESULT</p>
                            <div className="result-icon">
                              {currentAttempt?.decision === "VERIFIED"
                                ? "✓"
                                : "◎"}
                            </div>
                            <h2 data-testid="outcome">
                              {outcomeText(currentAttempt)}
                            </h2>
                            <p aria-live="polite">
                              {currentAttempt?.reasons.length
                                ? pretty(currentAttempt.reasons.join(" · "))
                                : "Claim a classroom challenge and submit your evidence."}
                            </p>
                            {currentAttempt?.simulated && (
                              <span className="pill">SIMULATED EVIDENCE</span>
                            )}
                            {session && (
                              <p
                                className="caption"
                                data-testid="student-policy"
                              >
                                {session.presenceMode === "local"
                                  ? "This session needs GPS, the classroom ESP32 proof and teacher review."
                                  : "This session needs GPS and teacher review. No ESP32 is needed."}
                              </p>
                            )}
                            {(state.myPresence || [])
                              .filter((r) => r.active)
                              .map((r) => (
                                <div
                                  key={r.id}
                                  className="explanation"
                                  data-testid="my-presence"
                                >
                                  <strong>
                                    You are marked as in the room.
                                  </strong>
                                  <p className="caption">
                                    Leaving early? Check out so the estimate
                                    stays useful. Your attendance record stays.
                                  </p>
                                  <button
                                    className="secondary"
                                    disabled={busy}
                                    onClick={() =>
                                      run(() =>
                                        api(`/presence/${r.id}/checkout`, {}),
                                      )
                                    }
                                  >
                                    Check out of room
                                  </button>
                                </div>
                              ))}

                            {currentAttempt &&
                              (Number.isFinite(currentAttempt.distance) ||
                                evidence.location) && (
                                <div
                                  style={{
                                    marginTop: 16,
                                    padding: "10px 14px",
                                    background: "#f3f5ee",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    textAlign: "left",
                                    border: "1px solid #dbe2d5",
                                  }}
                                >
                                  <strong style={{ color: "#1e5145" }}>
                                    Verification Diagnostics:
                                  </strong>
                                  <div
                                    style={{
                                      display: "grid",
                                      gap: 4,
                                      marginTop: 6,
                                      color: "#4d5b4f",
                                    }}
                                  >
                                    {Number.isFinite(
                                      currentAttempt.distance,
                                    ) && (
                                      <div>
                                        •{" "}
                                        <strong>
                                          Distance from classroom:
                                        </strong>{" "}
                                        {Math.round(currentAttempt.distance)}{" "}
                                        meters
                                      </div>
                                    )}
                                    {session?.room?.radius && (
                                      <div>
                                        •{" "}
                                        <strong>
                                          Allowed classroom radius:
                                        </strong>{" "}
                                        {session.room.radius} meters
                                      </div>
                                    )}
                                    {evidence.location?.accuracy && (
                                      <div>
                                        • <strong>Your GPS accuracy:</strong> ±
                                        {Math.round(evidence.location.accuracy)}{" "}
                                        meters
                                      </div>
                                    )}
                                    {currentAttempt?.facialStatus ===
                                      "NO_REFERENCE_ENROLLED" && (
                                      <div>
                                        • <strong>Photo:</strong> Captured for
                                        teacher review (enroll a profile photo
                                        so the teacher has a reference)
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                          </section>
                        </aside>
                      </div>
                    </>
                  )}

                  {/* 2. My Courses & Timetable Tab (Interactive Calendar) */}
                  {(activeTab === "courses" ||
                    activeTab === "timetable" ||
                    activeTab === "schedules") && (
                    <section className="card">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">
                            STUDENT TIMETABLE & CALENDAR
                          </p>
                          <h2>My Timetable & Course Schedule</h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSchedule(null);
                            const defaultTeacher = teachers[0]?.id || "teacher";
                            setScheduleForm({
                              subject: "",
                              classId: "",
                              classroomId: state.classrooms[0]?.id || "room-1",
                              teacherId: defaultTeacher,
                              time: "09:00 - 10:30",
                              days: "Mon, Wed, Fri",
                              enrollmentIds: [auth.user.id],
                            });
                            setShowNewSchedule(true);
                          }}
                        >
                          ➕ Propose / Add New Course
                        </button>
                      </div>

                      <ScheduleCalendar
                        schedules={state.schedules}
                        classrooms={state.classrooms}
                        people={state.people}
                        currentUser={auth.user}
                        effectiveRole="student"
                        canLaunchSession={false}
                        onEditSchedule={(s) => {
                          setEditingSchedule(s);
                          setScheduleForm({
                            subject: s.subject,
                            classId: s.classId,
                            classroomId: s.classroomId,
                            teacherId: s.teacherId || "",
                            time: s.time,
                            days: s.days,
                            enrollmentIds: Array.isArray(s.enrollmentIds)
                              ? [...s.enrollmentIds]
                              : [auth.user.id],
                          });
                          setShowNewSchedule(true);
                        }}
                        onDeleteSchedule={(id) =>
                          run(() => handleDeleteSchedule(id))
                        }
                        onAddSchedule={() => {
                          setEditingSchedule(null);
                          const defaultTeacher = teachers[0]?.id || "teacher";
                          setScheduleForm({
                            subject: "",
                            classId: "",
                            classroomId: state.classrooms[0]?.id || "room-1",
                            teacherId: defaultTeacher,
                            time: "09:00 - 10:30",
                            days: "Mon, Wed, Fri",
                            enrollmentIds: [auth.user.id],
                          });
                          setShowNewSchedule(true);
                        }}
                      />
                    </section>
                  )}
                </>
              )}

              {/* ATTENDANCE HISTORY TAB */}
              {activeTab === "history" && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 20 }}
                >
                  <section className="card">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">VERIFIED COURSE ATTENDANCE</p>
                        <h2>Official Attendance Records</h2>
                      </div>
                    </div>
                    {state.attendance && state.attendance.length > 0 ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Course / Subject</th>
                              <th>Classroom Venue</th>
                              <th>Status</th>
                              <th>Date & Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {state.attendance.map((rec, i) => (
                              <tr key={i}>
                                <td>
                                  <strong>
                                    {rec.subject || rec.classId || "Class"}
                                  </strong>
                                </td>
                                <td>
                                  {rec.roomName || rec.classroomId || "—"}
                                </td>
                                <td>
                                  <StatusBadge
                                    attempt={{ decision: "VERIFIED" }}
                                  />
                                </td>
                                <td>
                                  {rec.finalizedAt
                                    ? new Date(rec.finalizedAt).toLocaleString(
                                        "en-IN",
                                        { timeZone: "Asia/Kolkata" },
                                      )
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState title="No verified attendance records yet">
                        Official attendance records will appear here once
                        verified by geofencing and approved by your course
                        instructor.
                      </EmptyState>
                    )}
                  </section>

                  <section className="card">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">VERIFICATION ATTEMPTS LOG</p>
                        <h2>My Attendance Check-in Attempts</h2>
                      </div>
                    </div>
                    {state.attempts && state.attempts.length > 0 ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Attempt ID</th>
                              <th>Status</th>
                              <th>Evidence / Result Reason</th>
                              <th>Distance & GPS</th>
                              <th>Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...state.attempts].reverse().map((a) => (
                              <tr key={a.id}>
                                <td>
                                  <code>{a.id.slice(0, 14)}...</code>
                                </td>
                                <td>
                                  <StatusBadge attempt={a} />
                                </td>
                                <td>
                                  <div>
                                    {pretty(a.reasons?.join(" · ")) ||
                                      "Verification submitted"}
                                  </div>
                                </td>
                                <td>
                                  {Number.isFinite(a.distance) ? (
                                    <small
                                      style={{ color: "var(--secondary-text)" }}
                                    >
                                      {Math.round(a.distance)}m away{" "}
                                      {a.accuracy
                                        ? `(±${Math.round(a.accuracy)}m)`
                                        : ""}
                                    </small>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td>
                                  {a.claimedAt
                                    ? new Date(a.claimedAt).toLocaleTimeString()
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState title="No check-in attempts recorded">
                        When you participate in an attendance session, your
                        claim and verification attempts will be logged here for
                        transparency.
                      </EmptyState>
                    )}
                  </section>
                </div>
              )}

              {/* UNIFIED PROFILE & ACCOUNT SETTINGS (ALL ROLES) */}
              {activeTab === "profile" && (
                <section className="card">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">
                        {effectiveRole === "dev"
                          ? "DEVELOPER PROFILE"
                          : effectiveRole === "admin"
                            ? "FACULTY PROFILE & ACCOUNT SETTINGS"
                            : "STUDENT PROFILE & REFERENCE PHOTO"}
                      </p>
                      <h2>My Profile & Account Settings</h2>
                    </div>
                    <span className="pill">
                      {effectiveRole === "dev"
                        ? "🛠️ DEVELOPER"
                        : effectiveRole === "admin"
                          ? "👨‍🏫 FACULTY ADMIN"
                          : "🎓 STUDENT"}
                    </span>
                  </div>

                  {profileSuccess && (
                    <div className="success-banner">✓ {profileSuccess}</div>
                  )}

                  <p style={{ maxWidth: 640 }}>
                    Inspect and update your personal information, department
                    details, email, and reference face photo. Changes persist
                    across future logins and are used to verify attendance
                    check-ins.
                  </p>

                  <div className="profile-grid">
                    <div>
                      <h3>Account Credentials & Identity</h3>
                      <form onSubmit={(e) => run(() => handleSaveProfile(e))}>
                        <label>
                          Full Name
                          <input
                            required
                            value={profileForm.name}
                            onChange={(e) =>
                              setProfileForm({
                                ...profileForm,
                                name: e.target.value,
                              })
                            }
                            placeholder="Your full name"
                          />
                        </label>

                        <div className="fields">
                          <label>
                            {effectiveRole === "student"
                              ? "Roll Number"
                              : effectiveRole === "admin"
                                ? "Faculty ID"
                                : "Developer ID"}
                            <input
                              value={profileForm.roll}
                              onChange={(e) =>
                                setProfileForm({
                                  ...profileForm,
                                  roll: e.target.value,
                                })
                              }
                              placeholder="e.g. ECE042 / FAC101"
                            />
                          </label>
                          <label>
                            Department
                            <input
                              value={profileForm.dept}
                              onChange={(e) =>
                                setProfileForm({
                                  ...profileForm,
                                  dept: e.target.value,
                                })
                              }
                              placeholder="e.g. ECE / Platform"
                            />
                          </label>
                        </div>

                        <label>
                          Email Address
                          <input
                            type="email"
                            value={profileForm.email}
                            onChange={(e) =>
                              setProfileForm({
                                ...profileForm,
                                email: e.target.value,
                              })
                            }
                            placeholder="e.g. user@ssec.edu"
                          />
                        </label>

                        <button
                          type="submit"
                          disabled={busy || !profileForm.name}
                          style={{ marginTop: 14 }}
                        >
                          {busy ? "Saving…" : "💾 Save Profile Changes"}
                        </button>
                      </form>
                    </div>

                    <div className="profile-photo-box">
                      <h3>Reference photo</h3>
                      <p
                        style={{
                          fontSize: 12,
                          color: "#617466",
                          margin: "4px 0 14px",
                        }}
                      >
                        Optional reference photo shown to your teacher beside
                        your check-in photo. Nothing is matched automatically.
                      </p>

                      {profileForm.referencePhoto ? (
                        <div>
                          <img
                            src={profileForm.referencePhoto}
                            alt="Reference Profile Face"
                            className="profile-avatar"
                          />
                          <div style={{ marginBottom: 12 }}>
                            <span className="badge verified">
                              ✓ Face Profile Active
                            </span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              justifyContent: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              type="button"
                              className="secondary"
                              style={{ fontSize: 11 }}
                              onClick={() =>
                                run(async () => {
                                  stopCamera();
                                  stream.current = await openCamera();
                                  setCamera(true);
                                })
                              }
                            >
                              📷 Retake via Camera
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              style={{ fontSize: 11 }}
                              onClick={() => fileInputRef.current?.click()}
                            >
                              📁 Choose File
                            </button>
                            <button
                              type="button"
                              className="danger-btn"
                              style={{ fontSize: 11 }}
                              onClick={() =>
                                setProfileForm((prev) => ({
                                  ...prev,
                                  referencePhoto: "",
                                }))
                              }
                            >
                              🗑️ Remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="profile-avatar-placeholder">👤</div>
                          <div style={{ marginBottom: 14 }}>
                            <span className="badge pending">
                              ⚠️ No Face Profile Registered
                            </span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              justifyContent: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                run(async () => {
                                  stopCamera();
                                  stream.current = await openCamera();
                                  setCamera(true);
                                })
                              }
                            >
                              📷 Capture Face Photo
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => fileInputRef.current?.click()}
                            >
                              📁 Upload Photo
                            </button>
                          </div>
                        </div>
                      )}

                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={handleProfilePhotoUpload}
                      />

                      {camera && (
                        <div
                          style={{
                            marginTop: 14,
                            background: "#fff",
                            padding: 12,
                            borderRadius: 8,
                          }}
                        >
                          <video
                            ref={video}
                            autoPlay
                            playsInline
                            muted
                            style={{
                              maxHeight: 220,
                              borderRadius: 8,
                              width: "100%",
                            }}
                          />
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              marginTop: 8,
                              justifyContent: "center",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                const v = video.current;
                                if (!v) return;
                                const c = document.createElement("canvas");
                                c.width = v.videoWidth || 640;
                                c.height = v.videoHeight || 480;
                                c.getContext("2d").drawImage(
                                  v,
                                  0,
                                  0,
                                  c.width,
                                  c.height,
                                );
                                const url = c.toDataURL("image/jpeg", 0.75);
                                setProfileForm((prev) => ({
                                  ...prev,
                                  referencePhoto: url,
                                }));
                                stopCamera();
                              }}
                            >
                              Snap & Select Photo
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={stopCamera}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* SHARED MODAL: ADD / EDIT COURSE SCHEDULE */}
              {showNewSchedule && (
                <Modal
                  title={
                    editingSchedule
                      ? "Edit Course Schedule"
                      : "Create New Course Schedule"
                  }
                  onClose={() => {
                    setShowNewSchedule(false);
                    setEditingSchedule(null);
                  }}
                  wide={true}
                >
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--secondary-text)",
                      margin: "0 0 16px",
                    }}
                  >
                    {effectiveRole === "student"
                      ? "Propose a course timetable. Assign a faculty member who will supervise and grant permissions for this course."
                      : "Define subject name, class identifier code, assigned classroom venue, timetable slots, and student enrollment roster."}
                  </p>

                  <form onSubmit={(e) => run(() => handleSaveSchedule(e))}>
                    <div className="fields">
                      <label>
                        Subject Name
                        <input
                          required
                          value={scheduleForm.subject}
                          onChange={(e) =>
                            setScheduleForm({
                              ...scheduleForm,
                              subject: e.target.value,
                            })
                          }
                          placeholder="e.g. Embedded Systems"
                        />
                      </label>
                      <label>
                        Class Code
                        <input
                          required
                          value={scheduleForm.classId}
                          onChange={(e) =>
                            setScheduleForm({
                              ...scheduleForm,
                              classId: e.target.value,
                            })
                          }
                          placeholder="e.g. ECE-DEMO"
                        />
                      </label>
                    </div>

                    <div className="fields">
                      <label>
                        Assigned Faculty / Teacher
                        <select
                          value={scheduleForm.teacherId}
                          onChange={(e) =>
                            setScheduleForm({
                              ...scheduleForm,
                              teacherId: e.target.value,
                            })
                          }
                        >
                          <option value="">
                            -- No Assigned Teacher / Self-Managed --
                          </option>
                          {teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                              👨‍🏫 {t.name} ({t.dept || "ECE"})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Assigned Classroom Venue
                        <select
                          value={scheduleForm.classroomId}
                          onChange={(e) =>
                            setScheduleForm({
                              ...scheduleForm,
                              classroomId: e.target.value,
                            })
                          }
                        >
                          {state.classrooms?.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.radius}m radius)
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="fields">
                      <label>
                        Time Slot
                        <input
                          value={scheduleForm.time}
                          onChange={(e) =>
                            setScheduleForm({
                              ...scheduleForm,
                              time: e.target.value,
                            })
                          }
                          placeholder="e.g. 09:00 - 10:30"
                        />
                      </label>
                      <label>
                        Lecture Days
                        <input
                          value={scheduleForm.days}
                          onChange={(e) =>
                            setScheduleForm({
                              ...scheduleForm,
                              days: e.target.value,
                            })
                          }
                          placeholder="e.g. Mon, Wed, Fri"
                        />
                      </label>
                    </div>

                    {/* ENROLLMENT ROSTER SECTION */}
                    {effectiveRole !== "student" ? (
                      <div
                        className="roster-management-box"
                        style={{
                          marginTop: 14,
                          padding: 12,
                          background: "#f8fafc",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-card)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 8,
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 13 }}>
                            👥 Enrolled Student Roster (
                            {(scheduleForm.enrollmentIds || []).length}{" "}
                            selected)
                          </span>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: "2px 8px", fontSize: 11 }}
                              onClick={() => {
                                const allStudentIds = (state.people || [])
                                  .filter((p) => p.role === "student")
                                  .map((s) => s.id);
                                setScheduleForm((prev) => ({
                                  ...prev,
                                  enrollmentIds: allStudentIds,
                                }));
                              }}
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: "2px 8px", fontSize: 11 }}
                              onClick={() => {
                                setScheduleForm((prev) => ({
                                  ...prev,
                                  enrollmentIds: [],
                                }));
                              }}
                            >
                              Deselect All
                            </button>
                          </div>
                        </div>

                        <div
                          className="roster-checklist"
                          style={{
                            maxHeight: 150,
                            overflowY: "auto",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-sm)",
                            padding: "4px 8px",
                            background: "#ffffff",
                          }}
                        >
                          {(state.people || []).filter(
                            (p) => p.role === "student",
                          ).length === 0 ? (
                            <p
                              style={{
                                margin: 0,
                                fontSize: 12,
                                color: "var(--secondary-text)",
                              }}
                            >
                              No registered student records found.
                            </p>
                          ) : (
                            (state.people || [])
                              .filter((p) => p.role === "student")
                              .map((stu) => {
                                const isChecked = (
                                  scheduleForm.enrollmentIds || []
                                ).includes(stu.id);
                                return (
                                  <label
                                    key={stu.id}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 10,
                                      padding: "5px 4px",
                                      borderBottom: "1px solid #f1f5f9",
                                      cursor: "pointer",
                                      fontSize: 13,
                                      margin: 0,
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      style={{ width: "auto", margin: 0 }}
                                      onChange={(e) => {
                                        const currentIds =
                                          scheduleForm.enrollmentIds || [];
                                        const nextIds = e.target.checked
                                          ? [...currentIds, stu.id]
                                          : currentIds.filter(
                                              (id) => id !== stu.id,
                                            );
                                        setScheduleForm((prev) => ({
                                          ...prev,
                                          enrollmentIds: nextIds,
                                        }));
                                      }}
                                    />
                                    <div
                                      style={{
                                        flex: 1,
                                        display: "flex",
                                        justifyContent: "space-between",
                                      }}
                                    >
                                      <span>
                                        <strong>{stu.name}</strong> (
                                        {stu.roll || stu.id})
                                      </span>
                                      <span
                                        style={{
                                          color: "var(--secondary-text)",
                                          fontSize: 11,
                                        }}
                                      >
                                        {stu.dept || "Engineering"}
                                      </span>
                                    </div>
                                  </label>
                                );
                              })
                          )}
                        </div>
                        <small
                          style={{
                            color: "var(--secondary-text)",
                            display: "block",
                            marginTop: 6,
                            fontSize: 11,
                          }}
                        >
                          Only enrolled students can claim attendance challenge
                          QR codes for this course session.
                        </small>
                      </div>
                    ) : (
                      <div
                        style={{
                          marginTop: 14,
                          padding: "10px 12px",
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          borderRadius: "var(--radius-sm)",
                          fontSize: 12,
                          color: "#166534",
                        }}
                      >
                        ✓ <strong>Proposer Pre-Enrollment:</strong> You (
                        {auth.user.name}) will be automatically enrolled in this
                        course schedule upon creation.
                      </div>
                    )}

                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        marginTop: 18,
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setShowNewSchedule(false);
                          setEditingSchedule(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button type="submit" disabled={busy}>
                        {editingSchedule ? "Save Changes" : "Save Schedule"}
                      </button>
                    </div>
                  </form>
                </Modal>
              )}
            </div>

            {/* Student Mobile Bottom Navigation */}
            {effectiveRole === "student" && (
              <nav
                className="mobile-bottom-nav"
                aria-label="Student Mobile Navigation"
              >
                <button
                  type="button"
                  className={`mobile-nav-item ${activeTab === "checkin" ? "active" : ""}`}
                  onClick={() => setActiveTab("checkin")}
                  aria-label="Check-in & Verification"
                >
                  <Icon name="check" />
                  <span>Check-in</span>
                </button>
                <button
                  type="button"
                  className={`mobile-nav-item ${activeTab === "timetable" || activeTab === "courses" || activeTab === "schedules" ? "active" : ""}`}
                  onClick={() => setActiveTab("timetable")}
                  aria-label="My Timetable & Courses"
                >
                  <Icon name="calendar" />
                  <span>Courses</span>
                </button>
                <button
                  type="button"
                  className={`mobile-nav-item ${activeTab === "history" ? "active" : ""}`}
                  onClick={() => setActiveTab("history")}
                  aria-label="Attendance History"
                >
                  <Icon name="history" />
                  <span>History</span>
                </button>
                <button
                  type="button"
                  className={`mobile-nav-item ${activeTab === "profile" ? "active" : ""}`}
                  onClick={() => setActiveTab("profile")}
                  aria-label="My Profile & Settings"
                >
                  <Icon name="user" />
                  <span>Profile</span>
                </button>
              </nav>
            )}
          </div>
        )}
      </main>

      <footer>
        TECH PULSE / 2026{" "}
        <span>Smart Campus Attendance & Space Management</span>
      </footer>
    </>
  );
}

function Metric({ title, value, foot }) {
  return (
    <div className="metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{foot}</small>
    </div>
  );
}

function Badge({ attempt: a }) {
  return (
    <span className={`badge ${(a.decision || a.phase).toLowerCase()}`}>
      {pretty(a.decision || a.phase)}
    </span>
  );
}

createRoot(document.getElementById("root")).render(<App />);
