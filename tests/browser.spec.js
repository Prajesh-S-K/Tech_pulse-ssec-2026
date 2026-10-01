import { test, expect } from "@playwright/test";
const base = "http://127.0.0.1:5188";
async function login(page, id) {
  await page.getByLabel("Student Roll No, Faculty ID, or Email").fill(id);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in to Portal ➔" }).click();
}
test("password sign-in, device photo, teacher review, logout and phone layout", async ({
  browser,
}) => {
  const teacher = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: 13.0827, longitude: 80.2707 },
  });
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#1e5145";
      ctx.fillRect(0, 0, 320, 240);
      return canvas.captureStream(30);
    };
  });
  const student = await context.newPage();
  const errors = [];
  teacher.on("pageerror", (e) => errors.push(e.message));
  student.on("pageerror", (e) => errors.push(e.message));
  await teacher.goto(base);
  await expect(teacher.getByText("Quick Demo Login")).toHaveCount(0);
  await login(teacher, "teacher");
  await expect(teacher.getByText("CLASSROOM OVERVIEW")).toBeVisible();
  await teacher
    .getByLabel("Session type", { exact: true })
    .selectOption("demo");
  await teacher.getByRole("button", { name: "Start selected session" }).click();
  const link = await teacher.getByLabel("Student check-in link").inputValue();
  await student.goto(link);
  await login(student, "student-1");
  await expect(student.getByText("Demo Simulation")).toHaveCount(0);
  await student
    .getByRole("button", { name: "Claim attendance attempt" })
    .click();
  await student.getByRole("button", { name: /Read my location/ }).click();
  await student.getByRole("button", { name: /Open camera/ }).click();
  await expect(student.locator("video")).toBeVisible();
  await student.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  await student
    .getByRole("button", { name: "Capture photo", exact: true })
    .click();
  await student
    .getByRole("button", { name: "Submit attendance evidence" })
    .click();
  await expect(
    teacher.getByRole("button", { name: "Approve identity" }),
  ).toBeVisible();
  await teacher.getByRole("button", { name: "Approve identity" }).click();
  await expect(
    student.getByRole("heading", { name: "Attendance recorded." }),
  ).toBeVisible();
  const otherAuth = await (
    await teacher.request.post(base + "/api/login", {
      data: { id: "teacher-2", password: "test-password-123" },
    })
  ).json();
  const otherSession = await teacher.request.post(base + "/api/sessions", {
    headers: { Authorization: `Bearer ${otherAuth.token}` },
    data: {
      scheduleId: "sched-3",
      sessionType: "demo",
      presenceMode: "baseline",
    },
  });
  expect(otherSession.ok()).toBe(true);
  await student.reload();
  await expect(
    student.getByRole("heading", { name: "Attendance recorded." }),
  ).toBeVisible();
  expect(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await student.getByRole("button", { name: "Sign out" }).click();
  await expect(student.getByLabel("Password", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await teacher.close();
  await context.close();
});
