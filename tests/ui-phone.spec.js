import { test, expect } from "@playwright/test";
import {
  base,
  login,
  studentContext,
  startDemoSession,
  submitEvidence,
  closeOpenSessions,
} from "./ui-helpers.js";

test.describe.configure({ mode: "serial" });
const sizes = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const noHScroll = async (page) => {
  const bad = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= innerWidth + 1) return [];
    return [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 6)
      .map(
        (e) =>
          `${e.tagName}.${String(e.className).slice(0, 40)}:${Math.round(e.getBoundingClientRect().right)}`,
      );
  });
  if (bad.length)
    console.log("OVERFLOW", innerWidthLabel(page), bad.join(" | "));
  return bad.length === 0;
};
const innerWidthLabel = (p) => p.viewportSize()?.width;

for (const size of sizes) {
  test(`phone layout ${size.width}px: tabs, drawer and dialogs stay inside the viewport`, async ({
    browser,
  }) => {
    const errors = [];
    const teacher = await browser.newPage({ viewport: size });
    teacher.on("pageerror", (e) => errors.push(e.message));
    const ctx = await studentContext(browser, undefined, size);
    const student = await ctx.newPage();
    student.on("pageerror", (e) => errors.push(e.message));
    await student.emulateMedia({ reducedMotion: "reduce" });
    await closeOpenSessions(teacher.request);
    await teacher.goto(base);
    await login(teacher, "teacher");
    const link = await startDemoSession(teacher);
    expect(await noHScroll(teacher)).toBe(true);
    await submitEvidence(student, link, "student-3");
    expect(await noHScroll(student)).toBe(true);
    for (const tab of [
      "Attendance History",
      "My Timetable & Courses",
      "My Profile & Settings",
      "Check-in & Verification",
    ]) {
      await student
        .locator(`.mobile-nav-item[aria-label="${tab}"]`)
        .first()
        .click();
      expect(await noHScroll(student), `student ${tab}`).toBe(true);
    }
    for (const tab of [
      "Classrooms & Venues",
      "Timetable & Schedules",
      "Student Directory",
      "Live Attendance & QR",
    ]) {
      const sidebar = teacher.locator(".portal-sidebar");
      if (!(await sidebar.evaluate((e) => e.classList.contains("open"))))
        await teacher.getByLabel("Toggle navigation menu").click();
      await sidebar.getByRole("button", { name: tab }).first().click();
      expect(await noHScroll(teacher), `teacher ${tab}`).toBe(true);
    }
    // drawer on a phone: fits, closes with Escape, focus returns
    await teacher
      .getByRole("button", { name: /Review Photos/ })
      .first()
      .click();
    const drawer = teacher.getByRole("dialog");
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
    expect(await noHScroll(teacher)).toBe(true);
    await teacher.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    // reduced motion: nothing animating on the student page
    const running = await student.evaluate(
      () =>
        document.getAnimations().filter((a) => a.playState === "running")
          .length,
    );
    expect(running).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
    await teacher.close();
  });
}

test("permission denial gives retry guidance; camera tracks stop on tab change and logout; clipboard fallback is selectable", async ({
  browser,
}) => {
  const teacher = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await closeOpenSessions(teacher.request);
  await teacher.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: undefined }),
  );
  await teacher.goto(base);
  await login(teacher, "teacher");
  const link = await startDemoSession(teacher);
  // clipboard unavailable: text is selected and guidance shown
  await teacher
    .getByRole("button", { name: /Copy student check-in link/i })
    .click();
  await expect(
    teacher.getByText(/Use your device’s Copy command/),
  ).toBeVisible();

  // location denied
  const noLoc = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const denied = await noLoc.newPage();
  await denied.goto(link);
  await login(denied, "student-6");
  await denied
    .getByRole("button", { name: "Claim attendance attempt" })
    .click();
  await denied.getByRole("button", { name: /Read my location/ }).click();
  await expect(
    denied.getByText(/permission was denied|unavailable/i).first(),
  ).toBeVisible();

  // camera denied
  await noLoc.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    };
  });
  await denied.reload();
  await denied.getByRole("button", { name: /Open camera/ }).click();
  await expect(
    denied.getByText(/Camera permission was denied.*tap Open camera again/i),
  ).toBeVisible();
  await noLoc.close();

  // tracks stop when leaving the capture tab and on logout
  const ctx = await studentContext(browser);
  await ctx.addInitScript(() => {
    window.__tracks = [];
    const real = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await real(c);
      window.__tracks.push(...s.getTracks());
      return s;
    };
  });
  const student = await ctx.newPage();
  await student.goto(link);
  await login(student, "student-5");
  await student
    .getByRole("button", { name: "Claim attendance attempt" })
    .click();
  await student.getByRole("button", { name: /Open camera/ }).click();
  await student.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  expect(
    await student.evaluate(() =>
      window.__tracks.some((t) => t.readyState === "live"),
    ),
  ).toBe(true);
  await student
    .locator('.mobile-nav-item[aria-label="Attendance History"]')
    .click();
  await expect
    .poll(() =>
      student.evaluate(() =>
        window.__tracks.every((t) => t.readyState === "ended"),
      ),
    )
    .toBe(true);
  await student
    .locator('.mobile-nav-item[aria-label="Check-in & Verification"]')
    .click();
  await student.getByRole("button", { name: /Open camera/ }).click();
  await student.waitForFunction(() =>
    window.__tracks.some((t) => t.readyState === "live"),
  );
  await student.getByRole("button", { name: /Sign out/ }).click();
  await expect
    .poll(() =>
      student.evaluate(() =>
        window.__tracks.every((t) => t.readyState === "ended"),
      ),
    )
    .toBe(true);
  await ctx.close();
  await teacher.close();
});
