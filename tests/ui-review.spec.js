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

test("review drawer: neutral similarity, missing reference, enlarge, single approval, completed state", async ({
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
  const link = await startDemoSession(teacher);
  await submitEvidence(student, link, "student-1");
  await expect(student.getByTestId("outcome")).toHaveText(
    "Submitted — awaiting teacher review.",
  );
  await expect(student.getByTestId("student-policy")).toContainText(
    "No ESP32 is needed",
  );
  await expect(student.getByText(/ESP32 classroom proof required/)).toHaveCount(
    0,
  );

  await teacher
    .getByRole("button", { name: /Review Photos/ })
    .first()
    .click();
  const drawer = teacher.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("No reference face enrolled")).toBeVisible();
  await expect(drawer.getByText("Advisory image similarity")).toBeVisible();
  const text = await drawer.innerText();
  expect(text).not.toMatch(/MATCH|MISMATCH|Biometric|null%/i);
  await expect(
    drawer.getByRole("button", { name: "Approve Identity" }),
  ).toBeEnabled();
  // enlarge opens and closes a second dialog
  await drawer.getByRole("button", { name: "Enlarge photo" }).first().click();
  await expect(
    teacher.getByRole("dialog").last().getByRole("img"),
  ).toBeVisible();
  await teacher.keyboard.press("Escape");
  // repeated clicks create exactly one record
  const approve = drawer.getByRole("button", { name: "Approve Identity" });
  await approve.dblclick();
  await expect(drawer.getByText("Review completed").first()).toBeVisible();
  const token = await apiToken(teacher.request, "teacher");
  const state = await (
    await teacher.request.get(base + "/api/state", {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  expect(state.attendance.filter((a) => a.uid === "student-1")).toHaveLength(1);
  await expect(student.getByTestId("outcome")).toHaveText(
    "Attendance recorded.",
  );
  // nothing sensitive in browser storage
  const stored = await student.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(stored).not.toMatch(
    /data:image|referencePhoto|presenceProof|requestCode|"lat"|"lng"/,
  );
  expect(errors).toEqual([]);
  await ctx.close();
  await teacher.close();
});

test("expired evidence disables approval and asks for recapture", async ({
  browser,
}) => {
  const teacher = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const ctx = await studentContext(browser);
  const student = await ctx.newPage();
  await closeOpenSessions(teacher.request);
  await teacher.goto(base);
  await login(teacher, "teacher");
  const link = await startDemoSession(teacher);
  await submitEvidence(student, link, "student-2");
  await teacher
    .getByRole("button", { name: /Review Photos/ })
    .first()
    .click();
  const drawer = teacher.getByRole("dialog");
  await expect(
    drawer.getByRole("button", { name: "Approve Identity" }),
  ).toBeEnabled();
  // evidence lifetime is 6 s on this server; the next push refreshes the drawer
  await expect(
    drawer.getByText("Student must recapture", { exact: true }),
  ).toBeVisible({
    timeout: 30000,
  });
  await expect(
    drawer.getByRole("button", { name: "Approve Identity" }),
  ).toHaveCount(0);
  await expect(
    drawer.getByText("Evidence expired; student must recapture"),
  ).toBeVisible();
  const token = await apiToken(teacher.request, "teacher");
  const attempts = (
    await (
      await teacher.request.get(base + "/api/state", {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()
  ).attempts;
  const mine = attempts.find((a) => a.uid === "student-2");
  const review = await teacher.request.post(
    `${base}/api/attempts/${mine.id}/review`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { decision: "approve" },
    },
  );
  expect(review.status()).toBe(400);
  await ctx.close();
  await teacher.close();
});
