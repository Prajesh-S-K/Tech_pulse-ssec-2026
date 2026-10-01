import { test, expect } from "@playwright/test";
import {
  base,
  login,
  studentContext,
  startDemoSession,
  submitEvidence,
  apiToken,
  closeOpenSessions,
} from "./ui-helpers.js";

test.describe.configure({ mode: "serial" });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

test("hardware-optional policy: baseline default, ESP32 guidance, confirmed replacement", async ({
  browser,
}) => {
  const errors = [];
  const teacher = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  teacher.on("pageerror", (e) => errors.push(e.message));
  const ctx = await studentContext(browser);
  const student = await ctx.newPage();
  student.on("pageerror", (e) => errors.push(e.message));
  await closeOpenSessions(teacher.request);
  await teacher.goto(base);
  await login(teacher, "teacher");

  const policy = teacher.getByLabel("Classroom proof policy");
  await expect(policy).toHaveValue("baseline");
  await expect(policy.locator("option")).toHaveText([
    "GPS + teacher review — no ESP32 needed",
    "GPS + ESP32 classroom proof + teacher review",
  ]);
  await expect(teacher.getByTestId("policy-help")).toContainText(
    "No device or Wi-Fi switching",
  );
  await expect(
    teacher.getByRole("button", { name: "Check companion configuration" }),
  ).toHaveCount(0);

  const link = await startDemoSession(teacher, { esp32: true });
  await expect(teacher.getByTestId("policy-badge")).toContainText(
    "ESP32 classroom proof",
  );
  await student.goto(link);
  await login(student, "student-4");
  await student
    .getByRole("button", { name: "Claim attendance attempt" })
    .click();
  await expect(
    student.getByText("ESP32 classroom proof required"),
  ).toBeVisible();
  await expect(student.getByTestId("student-policy")).toContainText(
    "ESP32 proof",
  );

  // replacement needs confirmation and explains the weaker assurance
  await teacher
    .getByRole("button", { name: "Start replacement session without ESP32" })
    .click();
  const confirm = teacher.getByRole("dialog");
  await expect(confirm).toContainText("weaker proof");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(teacher.getByTestId("policy-badge")).toContainText(
    "ESP32 classroom proof",
  );
  await teacher
    .getByRole("button", { name: "Start replacement session without ESP32" })
    .click();
  await teacher
    .getByRole("dialog")
    .getByRole("button", { name: "Start replacement session" })
    .click();
  await expect(teacher.getByTestId("policy-badge")).toContainText("no ESP32");
  await expect(
    teacher.getByRole("button", {
      name: "Start replacement session without ESP32",
    }),
  ).toHaveCount(0);

  // students can never change policy
  const sToken = await apiToken(student.request, "student-4");
  const denied = await student.request.post(`${base}/api/sessions`, {
    headers: auth(sToken),
    data: {
      scheduleId: "sched-1",
      sessionType: "demo",
      presenceMode: "baseline",
    },
  });
  expect(denied.status()).toBe(403);
  expect(errors).toEqual([]);
  await ctx.close();
  await teacher.close();
});

test("estimated occupancy: approval, checkout and anomalies without cheating language", async ({
  browser,
}) => {
  const teacher = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const ctx = await studentContext(browser);
  const far = await studentContext(browser, {
    latitude: 13.2,
    longitude: 80.4,
  });
  const student = await ctx.newPage();
  const stranger = await far.newPage();
  await closeOpenSessions(teacher.request);
  await teacher.goto(base);
  await login(teacher, "teacher");
  const link = await startDemoSession(teacher);

  await submitEvidence(student, link, "student-5");
  await expect(teacher.getByTestId("occupancy-panel")).toContainText(
    "People may leave without checking out",
  );
  await expect(teacher.getByTestId("occupancy-panel")).toContainText(
    "No active check-ins",
  );
  await teacher
    .getByRole("button", { name: "Approve identity" })
    .first()
    .click();
  await expect(teacher.getByTestId("occupancy-count")).toHaveText("1");
  await expect(teacher.getByTestId("occupancy-panel")).toContainText(
    "from your sessions only",
  );
  await expect(teacher.getByTestId("occupancy-panel")).toContainText(
    "informational",
  );

  // student sees only their own presence and can check out
  await expect(student.getByTestId("outcome")).toHaveText(
    "Attendance recorded.",
  );
  await expect(student.getByTestId("my-presence")).toContainText(
    "Leaving early?",
  );
  await student.getByRole("button", { name: "Check out of room" }).click();
  await expect(student.getByTestId("my-presence")).toHaveCount(0);
  await expect(teacher.getByTestId("occupancy-panel")).toContainText(
    "No active check-ins",
  );
  const token = await apiToken(teacher.request, "teacher");
  const state = await (
    await teacher.request.get(`${base}/api/state`, { headers: auth(token) })
  ).json();
  expect(state.attendance.filter((a) => a.uid === "student-5")).toHaveLength(1);

  // an outside-geofence attempt appears under Rejected with a neutral explanation
  await submitEvidence(stranger, link, "student-4");
  await expect(teacher.getByTestId("anomaly-panel")).toContainText(
    "Rejected checks (1)",
    { timeout: 20000 },
  );
  await expect(teacher.getByTestId("anomaly-panel")).toContainText(
    "outside the classroom geofence",
  );
  const panel = await teacher.getByTestId("anomaly-panel").innerText();
  expect(panel).not.toMatch(/spoof|fraud|impersonat/i);

  // a student cannot read occupancy
  const sToken = await apiToken(student.request, "student-5");
  const sState = await (
    await student.request.get(`${base}/api/state`, { headers: auth(sToken) })
  ).json();
  expect(sState.occupancy).toBeUndefined();
  await ctx.close();
  await far.close();
  await teacher.close();
});
