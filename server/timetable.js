export function scheduledWindow(schedule, now) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  const match = /^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/.exec(
    schedule.time || "",
  );
  const days = (schedule.days || "").split(",").map((d) => d.trim());
  if (
    !match ||
    !days.every((d) =>
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(d),
    )
  )
    throw Error("INVALID_TIMETABLE");
  const [sh, sm, eh, em] = match.slice(1).map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59 || eh * 60 + em <= sh * 60 + sm)
    throw Error("INVALID_TIMETABLE");
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  if (
    !days.includes(p.weekday) ||
    minutes < sh * 60 + sm ||
    minutes >= eh * 60 + em
  )
    throw Error("OUTSIDE_SCHEDULE");
  const elapsedMinutes = minutes - (sh * 60 + sm);
  const seconds = new Date(now).getUTCSeconds(),
    millis = new Date(now).getUTCMilliseconds();
  return {
    startsAt: now - elapsedMinutes * 60000 - seconds * 1000 - millis,
    endsAt: now + (eh * 60 + em - minutes) * 60000 - seconds * 1000 - millis,
  };
}
