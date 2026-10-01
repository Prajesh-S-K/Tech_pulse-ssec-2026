import React, { useState } from "react";
import { Modal } from "./PortalUI";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function scheduleMatchesDay(schedule, dayOfWeekIndex) {
  if (!schedule?.days) return false;
  const d = schedule.days.toLowerCase();
  if (
    d.includes("daily") ||
    d.includes("every day") ||
    d.includes("all days")
  ) {
    return true;
  }
  return d.includes(DAY_KEYS[dayOfWeekIndex]);
}

export function getWeekDays(referenceDate) {
  const curr = new Date(referenceDate);
  curr.setHours(0, 0, 0, 0);
  const day = curr.getDay(); // 0 is Sunday
  const mondayOffset = (day + 6) % 7; // 0 for Monday, 6 for Sunday
  const monday = new Date(curr);
  monday.setDate(curr.getDate() - mondayOffset);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

export function getMonthDays(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days = [];

  // Monday = 0, Sunday = 6
  const startOffset = (firstDay.getDay() + 6) % 7;
  const prevMonthLastDay = new Date(year, month, 0).getDate();

  // Leading days from previous month
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevMonthLastDay - i);
    d.setHours(0, 0, 0, 0);
    days.push({ date: d, isCurrentMonth: false, dayOfWeek: d.getDay() });
  }

  // Days of current month
  for (let i = 1; i <= lastDay.getDate(); i++) {
    const d = new Date(year, month, i);
    d.setHours(0, 0, 0, 0);
    days.push({ date: d, isCurrentMonth: true, dayOfWeek: d.getDay() });
  }

  // Trailing days to fill 35 or 42 grid cells
  const remaining = (7 - (days.length % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    const d = new Date(year, month + 1, i);
    d.setHours(0, 0, 0, 0);
    days.push({ date: d, isCurrentMonth: false, dayOfWeek: d.getDay() });
  }

  return days;
}

export default function ScheduleCalendar({
  schedules = [],
  classrooms = [],
  people = [],
  currentUser = null,
  effectiveRole = "student",
  canLaunchSession = false,
  onLaunchSession = null,
  onEditSchedule = null,
  onDeleteSchedule = null,
  onAddSchedule = null,
}) {
  const [view, setView] = useState("week"); // "day", "week", "month", "list"
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedClass, setSelectedClass] = useState(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Navigation handlers
  function navigate(direction) {
    const next = new Date(currentDate);
    if (view === "month") {
      next.setMonth(next.getMonth() + direction);
    } else if (view === "week") {
      next.setDate(next.getDate() + direction * 7);
    } else if (view === "day") {
      next.setDate(next.getDate() + direction);
    }
    setCurrentDate(next);
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  // Format title for current view
  function getTitle() {
    const year = currentDate.getFullYear();
    const month = MONTH_NAMES[currentDate.getMonth()];
    if (view === "month") {
      return `${month} ${year}`;
    }
    if (view === "week") {
      const weekDays = getWeekDays(currentDate);
      const start = weekDays[0];
      const end = weekDays[6];
      const startStr = `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()}`;
      const endStr = `${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
      return `${startStr} – ${endStr}`;
    }
    if (view === "day") {
      const dayName = DAY_LABELS[(currentDate.getDay() + 6) % 7];
      return `${dayName}, ${month} ${currentDate.getDate()}, ${year}`;
    }
    return `All Scheduled Courses (${schedules.length})`;
  }

  function getRoom(id) {
    return classrooms.find((c) => c.id === id);
  }

  function getTeacher(id) {
    return people.find((p) => p.id === id);
  }

  return (
    <div className="calendar-card">
      <div className="calendar-header">
        <div className="calendar-nav">
          <button
            type="button"
            className="secondary"
            style={{ padding: "5px 10px" }}
            onClick={() => navigate(-1)}
            title="Previous"
          >
            ◀
          </button>
          <button
            type="button"
            className="secondary"
            style={{ padding: "5px 12px" }}
            onClick={goToday}
          >
            Today
          </button>
          <button
            type="button"
            className="secondary"
            style={{ padding: "5px 10px" }}
            onClick={() => navigate(1)}
            title="Next"
          >
            ▶
          </button>
          <span className="calendar-title">{getTitle()}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="calendar-view-switcher">
            <button
              type="button"
              className={`calendar-view-btn ${view === "day" ? "active" : ""}`}
              onClick={() => setView("day")}
            >
              📆 Day
            </button>
            <button
              type="button"
              className={`calendar-view-btn ${view === "week" ? "active" : ""}`}
              onClick={() => setView("week")}
            >
              📅 Week
            </button>
            <button
              type="button"
              className={`calendar-view-btn ${view === "month" ? "active" : ""}`}
              onClick={() => setView("month")}
            >
              🗓️ Month
            </button>
            <button
              type="button"
              className={`calendar-view-btn ${view === "list" ? "active" : ""}`}
              onClick={() => setView("list")}
            >
              📋 List
            </button>
          </div>

          {onAddSchedule && (
            <button
              type="button"
              onClick={onAddSchedule}
              style={{ fontSize: 12, padding: "7px 14px" }}
            >
              ➕ Add Course
            </button>
          )}
        </div>
      </div>

      {/* Selected Class Quick Inspector Modal */}
      {selectedClass &&
        (() => {
          const canModify =
            effectiveRole === "dev" ||
            (selectedClass.teacherId &&
              selectedClass.teacherId === currentUser?.id) ||
            (!selectedClass.teacherId &&
              selectedClass.createdBy === currentUser?.id);
          return (
            <Modal
              title={selectedClass.subject}
              onClose={() => setSelectedClass(null)}
              wide={true}
            >
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <span className="pill">{selectedClass.classId}</span>
                {selectedClass.enrollmentIds?.includes(currentUser?.id) && (
                  <span className="badge verified" style={{ fontSize: 11 }}>
                    ✓ Enrolled
                  </span>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  fontSize: 13,
                  marginBottom: 14,
                }}
              >
                <div>
                  📍 <strong>Venue:</strong>{" "}
                  {getRoom(selectedClass.classroomId)?.name ||
                    selectedClass.classroomId}{" "}
                  <span style={{ color: "var(--secondary-text)" }}>
                    ({getRoom(selectedClass.classroomId)?.radius || 75}m radius)
                  </span>
                </div>
                <div>
                  ⏰ <strong>Time:</strong> {selectedClass.time}
                </div>
                <div>
                  📅 <strong>Lecture Days:</strong> {selectedClass.days}
                </div>
                <div>
                  👨‍🏫 <strong>Assigned Faculty:</strong>{" "}
                  {getTeacher(selectedClass.teacherId)?.name ||
                    selectedClass.teacherId ||
                    "Unassigned"}
                </div>
              </div>

              {/* Enrolled Roster */}
              <div
                style={{
                  margin: "14px 0",
                  borderTop: "1px solid var(--border)",
                  paddingTop: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <strong style={{ fontSize: 13 }}>
                    👥 Enrolled Students (
                    {selectedClass.enrollmentIds?.length || 0})
                  </strong>
                </div>

                {effectiveRole !== "student" ? (
                  <div
                    style={{
                      maxHeight: 140,
                      overflowY: "auto",
                      padding: "6px 10px",
                      background: "#f8fafc",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: 12,
                    }}
                  >
                    {selectedClass.enrollmentIds &&
                    selectedClass.enrollmentIds.length > 0 ? (
                      selectedClass.enrollmentIds.map((sid) => {
                        const st = people.find((p) => p.id === sid);
                        return (
                          <div
                            key={sid}
                            style={{
                              padding: "4px 0",
                              borderBottom: "1px solid #edf2f7",
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span>
                              <strong>{st?.name || sid}</strong>{" "}
                              {st?.roll ? `(${st.roll})` : ""}
                            </span>
                            <span style={{ color: "var(--secondary-text)" }}>
                              {st?.dept || "Student"}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <span style={{ color: "var(--secondary-text)" }}>
                        No students currently enrolled in this course roster.
                      </span>
                    )}
                  </div>
                ) : (
                  <p
                    style={{
                      margin: "4px 0",
                      fontSize: 13,
                      color: "var(--secondary-text)",
                    }}
                  >
                    {selectedClass.enrollmentIds?.includes(currentUser?.id)
                      ? "✓ Your student account is officially enrolled in this course. You can attend scheduled sessions."
                      : "You are not enrolled in this course."}
                  </p>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 18,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelectedClass(null)}
                >
                  Close
                </button>
                {canLaunchSession && onLaunchSession && (
                  <button
                    type="button"
                    onClick={() => {
                      onLaunchSession(selectedClass);
                      setSelectedClass(null);
                    }}
                  >
                    🚀 Launch Attendance Session
                  </button>
                )}
                {canModify && onEditSchedule && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      onEditSchedule(selectedClass);
                      setSelectedClass(null);
                    }}
                  >
                    ✏️ Edit
                  </button>
                )}
                {canModify && onDeleteSchedule && (
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => {
                      onDeleteSchedule(selectedClass.id);
                      setSelectedClass(null);
                    }}
                  >
                    🗑️ Delete
                  </button>
                )}
              </div>
            </Modal>
          );
        })()}

      {/* MONTH VIEW */}
      {view === "month" && (
        <div>
          <div className="calendar-month-grid" style={{ marginBottom: 6 }}>
            {DAY_LABELS.map((day) => (
              <div key={day} className="calendar-day-header">
                {day}
              </div>
            ))}
          </div>

          <div className="calendar-month-grid">
            {getMonthDays(
              currentDate.getFullYear(),
              currentDate.getMonth(),
            ).map((cell, idx) => {
              const isToday = cell.date.getTime() === today.getTime();
              const dayMatches = schedules.filter((s) =>
                scheduleMatchesDay(s, cell.dayOfWeek),
              );

              return (
                <div
                  key={idx}
                  className={`calendar-month-cell ${cell.isCurrentMonth ? "" : "other-month"} ${isToday ? "today" : ""}`}
                >
                  <div
                    className={`calendar-cell-date ${isToday ? "today-badge" : ""}`}
                  >
                    <span>{cell.date.getDate()}</span>
                    {isToday && (
                      <span style={{ fontSize: 9, color: "#1e5145" }}>
                        TODAY
                      </span>
                    )}
                  </div>

                  {dayMatches.map((s) => {
                    const room = getRoom(s.classroomId);
                    return (
                      <div
                        key={s.id}
                        className="calendar-event-pill"
                        onClick={() => setSelectedClass(s)}
                        title={`${s.subject} (${s.time}) at ${room?.name || s.classroomId}`}
                      >
                        <strong>
                          {s.classId} · {s.subject}
                        </strong>
                        <div style={{ opacity: 0.85, fontSize: 9 }}>
                          {s.time.split("-")[0]?.trim()} ·{" "}
                          {room?.name || "Venue"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* WEEK VIEW */}
      {view === "week" && (
        <div className="calendar-week-grid">
          {getWeekDays(currentDate).map((dayDate) => {
            const isToday = dayDate.getTime() === today.getTime();
            const dayOfWeek = dayDate.getDay();
            const dayLabel = DAY_LABELS[(dayOfWeek + 6) % 7];
            const daySchedules = schedules.filter((s) =>
              scheduleMatchesDay(s, dayOfWeek),
            );

            return (
              <div
                key={dayDate.toISOString()}
                className={`calendar-week-col ${isToday ? "today" : ""}`}
              >
                <div
                  className={`calendar-week-day-hdr ${isToday ? "today" : ""}`}
                >
                  <div className="calendar-week-day-name">{dayLabel}</div>
                  <div className="calendar-week-day-num">
                    {dayDate.getDate()}
                  </div>
                </div>

                {daySchedules.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      color: "#919f96",
                      fontSize: 11,
                      padding: "16px 0",
                    }}
                  >
                    No classes
                  </div>
                ) : (
                  daySchedules.map((s) => {
                    const room = getRoom(s.classroomId);
                    const teacher = getTeacher(s.teacherId);
                    return (
                      <div
                        key={s.id}
                        className="calendar-week-card"
                        onClick={() => setSelectedClass(s)}
                        style={{ cursor: "pointer" }}
                      >
                        <span className="calendar-week-time">⏰ {s.time}</span>
                        <h4>
                          {s.classId}: {s.subject}
                        </h4>
                        <div className="calendar-week-venue">
                          📍 {room?.name || s.classroomId}
                        </div>
                        {teacher && (
                          <div className="calendar-week-teacher">
                            👨‍🏫 {teacher.name}
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: "#7a8a7f" }}>
                          👥 {s.enrollmentIds?.length || 0} students
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* DAY VIEW */}
      {view === "day" && (
        <div className="calendar-day-timeline">
          {(() => {
            const dayOfWeek = currentDate.getDay();
            const daySchedules = schedules.filter((s) =>
              scheduleMatchesDay(s, dayOfWeek),
            );

            const hours = [
              "08:00",
              "09:00",
              "10:00",
              "11:00",
              "12:00",
              "13:00",
              "14:00",
              "15:00",
              "16:00",
              "17:00",
            ];

            return hours.map((hour) => {
              const matchingInHour = daySchedules.filter((s) => {
                const startStr = s.time.split("-")[0]?.trim() || "";
                return startStr.startsWith(hour.slice(0, 2));
              });

              return (
                <div key={hour} className="calendar-time-slot">
                  <div className="calendar-slot-time">{hour}</div>
                  <div className="calendar-slot-events">
                    {matchingInHour.length === 0 ? (
                      <div
                        style={{
                          height: 20,
                          borderLeft: "2px solid #e1e7dc",
                          paddingLeft: 8,
                          color: "#9cb0a2",
                          fontSize: 11,
                        }}
                      >
                        Available
                      </div>
                    ) : (
                      matchingInHour.map((s) => {
                        const room = getRoom(s.classroomId);
                        const teacher = getTeacher(s.teacherId);
                        return (
                          <div
                            key={s.id}
                            className="item-card"
                            style={{
                              margin: 0,
                              borderLeft: "4px solid #1e5145",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <span className="pill">{s.classId}</span>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: "#85621e",
                                }}
                              >
                                ⏰ {s.time}
                              </span>
                            </div>
                            <h3>{s.subject}</h3>
                            <p style={{ margin: "4px 0", fontSize: 12 }}>
                              📍 Venue:{" "}
                              <strong>{room?.name || s.classroomId}</strong> (
                              {room?.radius || 75}m geofence)
                            </p>
                            {teacher && (
                              <p style={{ margin: "2px 0", fontSize: 12 }}>
                                👨‍🏫 Assigned Faculty: {teacher.name}
                              </p>
                            )}
                            <div
                              style={{ display: "flex", gap: 8, marginTop: 10 }}
                            >
                              {canLaunchSession && onLaunchSession && (
                                <button
                                  type="button"
                                  onClick={() => onLaunchSession(s)}
                                >
                                  Launch Attendance Session ↗
                                </button>
                              )}
                              {onEditSchedule && (
                                <button
                                  type="button"
                                  className="secondary"
                                  style={{ padding: "4px 10px", fontSize: 11 }}
                                  onClick={() => onEditSchedule(s)}
                                >
                                  ✏️ Edit
                                </button>
                              )}
                              {onDeleteSchedule && (
                                <button
                                  type="button"
                                  className="danger-btn"
                                  style={{ padding: "4px 10px", fontSize: 11 }}
                                  onClick={() => onDeleteSchedule(s.id)}
                                >
                                  🗑️ Delete
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* LIST VIEW */}
      {view === "list" && (
        <div className="card-grid calendar-list-grid">
          {schedules.length === 0 ? (
            <div className="empty" style={{ gridColumn: "1 / -1" }}>
              <span>◎</span>
              <h3>No courses scheduled</h3>
              <p>Add a new course schedule to populate the calendar.</p>
            </div>
          ) : (
            schedules.map((s) => {
              const room = getRoom(s.classroomId);
              const teacher = getTeacher(s.teacherId);
              return (
                <div key={s.id} className="item-card">
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
                        {s.classId}
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {onEditSchedule && (
                          <button
                            type="button"
                            className="secondary"
                            style={{ padding: "3px 8px", fontSize: 11 }}
                            onClick={() => onEditSchedule(s)}
                          >
                            ✏️ Edit
                          </button>
                        )}
                        {onDeleteSchedule && (
                          <button
                            type="button"
                            className="danger-btn"
                            style={{ padding: "3px 8px", fontSize: 11 }}
                            onClick={() => onDeleteSchedule(s.id)}
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>

                    <h3>{s.subject}</h3>
                    <p style={{ margin: "6px 0", fontSize: 13 }}>
                      📍 Venue: <strong>{room?.name || s.classroomId}</strong>
                    </p>
                    <p style={{ margin: "4px 0", fontSize: 12 }}>
                      ⏰ Time: {s.time} ({s.days})
                    </p>
                    {teacher && (
                      <p style={{ margin: "4px 0", fontSize: 12 }}>
                        👨‍🏫 Faculty: <strong>{teacher.name}</strong>
                      </p>
                    )}
                    <p style={{ margin: "4px 0", fontSize: 12 }}>
                      👥 Enrolled: {s.enrollmentIds?.length || 0} students
                    </p>
                  </div>

                  {canLaunchSession && onLaunchSession && (
                    <button
                      type="button"
                      style={{ marginTop: 14 }}
                      onClick={() => onLaunchSession(s)}
                    >
                      Launch Attendance for this Course ↗
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
