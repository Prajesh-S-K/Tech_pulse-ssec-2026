import { expect } from "@playwright/test";

export const PORT = 5189;
export const base = `http://127.0.0.1:${PORT}`;
export const venue = { latitude: 13.0827, longitude: 80.2707 };

export async function login(page, id) {
  await page.getByLabel("Student Roll No, Faculty ID, or Email").fill(id);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in to Portal ➔" }).click();
}

export async function studentContext(
  browser,
  geolocation = venue,
  size = { width: 390, height: 844 },
) {
  const context = await browser.newContext({
    viewport: size,
    permissions: ["geolocation"],
    geolocation,
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
  return context;
}

export async function startDemoSession(teacher, { esp32 = false } = {}) {
  await teacher
    .getByLabel("Session type", { exact: true })
    .selectOption("demo");
  await teacher
    .getByLabel("Classroom proof policy")
    .selectOption(esp32 ? "local" : "baseline");
  await teacher.getByRole("button", { name: "Start selected session" }).click();
  await expect(teacher.getByTestId("policy-badge")).toBeVisible();
  return teacher.getByLabel("Student check-in link").inputValue();
}

export async function submitEvidence(student, link, id = "student-1") {
  await student.goto(link);
  await login(student, id);
  await student
    .getByRole("button", { name: "Claim attendance attempt" })
    .click();
  await student.getByRole("button", { name: /Read my location/ }).click();
  await student.getByRole("button", { name: /Open camera/ }).click();
  await student.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  await student
    .getByRole("button", { name: "Capture photo", exact: true })
    .click();
  await student
    .getByRole("button", { name: "Submit attendance evidence" })
    .click();
}

export async function apiToken(request, id) {
  const r = await request.post(base + "/api/login", {
    data: { id, password: "test-password-123" },
  });
  return (await r.json()).token;
}

// Leaves the isolated server with no open session so each spec starts clean.
export async function closeOpenSessions(request, id = "teacher") {
  const token = await apiToken(request, id);
  const headers = { Authorization: `Bearer ${token}` };
  const state = await (
    await request.get(base + "/api/state", { headers })
  ).json();
  for (const s of state.sessions.filter((x) => x.open))
    await request.post(`${base}/api/sessions/${s.id}/stop`, {
      headers,
      data: {},
    });
}
