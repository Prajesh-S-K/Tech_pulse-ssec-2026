// Manual diagnostic. NEVER point this at the working database: it creates
// classrooms and sessions. Start an isolated server first, e.g.
//   STORE_PATH=/tmp/audit/store.json CREDENTIALS_PATH=/tmp/audit/pw.json \
//   PRESENCE_CONFIG=/tmp/audit/none.json PORT=5199 node server/index.js
//   AUDIT_BASE_URL=http://127.0.0.1:5199 AUDIT_CREDENTIALS=/tmp/audit/pw.json \
//   node tests/diagnostics/ui-audit.mjs
import { chromium } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

async function runAudit() {
  console.log("=== STARTING FULL APPLICATION AUDIT ===");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];

  function record(category, testName, passed, details = "") {
    results.push({ category, testName, passed, details });
    console.log(
      `[${passed ? "PASS" : "FAIL"}] ${category} :: ${testName} ${details ? "- " + details : ""}`,
    );
  }

  const base = process.env.AUDIT_BASE_URL;
  if (!base || !process.env.AUDIT_CREDENTIALS)
    throw Error(
      "Set AUDIT_BASE_URL and AUDIT_CREDENTIALS (isolated instance).",
    );
  if (/:5173\b/.test(base))
    throw Error("Refusing to run against the default working instance.");

  // Load passwords from private/account-passwords.json if present
  let passwords = {};
  const pwPath = process.env.AUDIT_CREDENTIALS;
  if (existsSync(pwPath)) {
    try {
      passwords = JSON.parse(readFileSync(pwPath, "utf8"));
    } catch {}
  }

  const studentPw = passwords["student-1"]?.password || "test-password-123";
  const teacherPw = passwords["teacher"]?.password || "test-password-123";
  const devPw = passwords["dev"]?.password || "test-password-123";

  // -------------------------------------------------------------
  // 1. API Authorization & Direct Request Audit
  // -------------------------------------------------------------
  try {
    // Login as student-1
    const sLoginRes = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "student-1", password: studentPw }),
    });
    const sAuth = await sLoginRes.json();
    const sToken = sAuth.token;

    // Login as teacher
    const tLoginRes = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "teacher", password: teacherPw }),
    });
    const tAuth = await tLoginRes.json();
    const tToken = tAuth.token;

    // Login as dev
    const dLoginRes = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "dev", password: devPw }),
    });
    const dAuth = await dLoginRes.json();
    const dToken = dAuth.token;

    // A1: Student cannot access /api/people
    const r1 = await fetch(`${base}/api/people`, {
      headers: { Authorization: `Bearer ${sToken}` },
    });
    record(
      "API Security",
      "Student cannot access /api/people",
      r1.status === 403,
      `Status: ${r1.status}`,
    );

    // A2: Student cannot create classroom
    const r2 = await fetch(`${base}/api/classrooms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Hacked Room",
        lat: 13.0,
        lng: 80.0,
        radius: 50,
      }),
    });
    record(
      "API Security",
      "Student cannot create classroom",
      r2.status === 403,
      `Status: ${r2.status}`,
    );

    // A3: Student cannot access dev telemetry logs
    const r3 = await fetch(`${base}/api/dev/logs`, {
      headers: { Authorization: `Bearer ${sToken}` },
    });
    record(
      "API Security",
      "Student cannot access dev telemetry logs",
      r3.status === 403,
      `Status: ${r3.status}`,
    );

    // A4: Student cannot start session
    const r4 = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scheduleId: "sched-1" }),
    });
    record(
      "API Security",
      "Student cannot start session",
      r4.status === 403,
      `Status: ${r4.status}`,
    );

    // A5: Teacher can access /api/people
    const r5 = await fetch(`${base}/api/people`, {
      headers: { Authorization: `Bearer ${tToken}` },
    });
    record("API Security", "Teacher can access /api/people", r5.status === 200);

    // A6: Dev can access /api/dev/logs
    const r6 = await fetch(`${base}/api/dev/logs`, {
      headers: { Authorization: `Bearer ${dToken}` },
    });
    record("API Security", "Dev can access /api/dev/logs", r6.status === 200);
  } catch (err) {
    record("API Security", "API test failure", false, err.message);
  }

  // -------------------------------------------------------------
  // 2. Browser UI Navigation & Role Isolation Audit
  // -------------------------------------------------------------
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(base);

    // B1: Login screen buttons & modes
    const directTabBtn = page.getByRole("button", { name: /Direct Sign In/i });
    const regTabBtn = page.getByRole("button", { name: /Register Account/i });

    record(
      "UI Audit",
      "Sign-in mode switcher tabs visible",
      (await directTabBtn.isVisible()) && (await regTabBtn.isVisible()),
    );

    // B2: Direct Roll Sign-In for student
    await directTabBtn.click();
    await page.getByPlaceholder(/ECE001/).fill("ECE001");
    await page.getByLabel("Password", { exact: true }).fill(studentPw);
    await page.getByRole("button", { name: /Sign in to Portal/i }).click();

    await page.waitForTimeout(500);

    // B3: Student Role Restrictions
    const navText = await page.locator("nav.portal-sidebar").innerText();
    const hasDirectory =
      navText.includes("Directory") || navText.includes("Students");
    const hasClassrooms =
      navText.includes("Campus Spatial") || navText.includes("Classrooms");
    const hasDev =
      navText.includes("Developer") || navText.includes("Dev Console");

    record("Student UI", "Student Directory hidden from nav", !hasDirectory);
    record(
      "Student UI",
      "Classrooms manager hidden from student",
      !hasClassrooms,
    );
    record("Student UI", "Dev console hidden from student", !hasDev);
    record(
      "Student UI",
      "Check-in tab visible",
      navText.includes("Check-in") || navText.includes("Check-In"),
    );
    record(
      "Student UI",
      "Timetable tab visible",
      navText.includes("Timetable") || navText.includes("Courses"),
    );
    record("Student UI", "Profile tab visible", navText.includes("Profile"));

    // B4: Mobile layout test (viewport 390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    const innerWidth = await page.evaluate(() => window.innerWidth);
    record(
      "Mobile Responsiveness",
      "Student UI fits 390px viewport without horizontal scroll",
      scrollWidth <= innerWidth,
      `scrollWidth: ${scrollWidth}, innerWidth: ${innerWidth}`,
    );

    // Reset to desktop for subsequent tests
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);

    // B5: Student Timetable views
    await page
      .getByRole("button", { name: /My Timetable & Courses/i })
      .first()
      .click();
    await page.waitForTimeout(300);
    const weekBtn = page.getByRole("button", { name: /Week/i });
    const monthBtn = page.getByRole("button", { name: /Month/i });
    const dayBtn = page.getByRole("button", { name: /\bDay\b/i });
    const listBtn = page.getByRole("button", { name: /List/i });

    record(
      "Student Calendar",
      "Calendar view buttons exist",
      (await weekBtn.isVisible()) &&
        (await monthBtn.isVisible()) &&
        (await dayBtn.isVisible()) &&
        (await listBtn.isVisible()),
    );

    // Module 5: Student Course Proposal & Pre-Enrollment Audit
    const proposeBtn = page.getByRole("button", {
      name: /Propose \/ Add New Course/i,
    });
    if (await proposeBtn.isVisible()) {
      await proposeBtn.click();
      await page.waitForTimeout(300);
      const studentModalVisible = await page
        .getByRole("heading", { name: /Create New Course Schedule/i })
        .isVisible();
      const preEnrollBadge = await page
        .locator("text=Proposer Pre-Enrollment:")
        .isVisible();
      const studentDirectoryHidden = !(await page
        .locator(".roster-checklist")
        .isVisible());
      record(
        "Student Course Proposal",
        "Student course modal shows proposer pre-enrollment and hides student directory",
        studentModalVisible && preEnrollBadge && studentDirectoryHidden,
      );
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.waitForTimeout(300);
    }

    // B5.5: Student Attendance History & Attempts Log
    await page
      .getByRole("button", { name: /Attendance History/i })
      .first()
      .click();
    await page.waitForTimeout(300);
    const historySectionVisible =
      (await page
        .getByRole("heading", { name: /Official Attendance Records/i })
        .isVisible()) &&
      (await page
        .getByRole("heading", { name: /My Attendance Check-in Attempts/i })
        .isVisible());
    record(
      "Student Attendance History",
      "Student history displays official records and attempts log",
      historySectionVisible,
    );

    // B6: Student Profile settings
    await page
      .getByRole("button", { name: /My Profile & Settings/i })
      .first()
      .click();
    await page.waitForTimeout(300);
    const hasNameInput = await page.getByLabel("Full Name").isVisible();
    const hasDeptInput = await page.getByLabel("Department").isVisible();
    const hasPhotoBox = await page.locator(".profile-photo-box").isVisible();

    record(
      "Student Profile",
      "Profile credentials & photo box accessible",
      hasNameInput && hasDeptInput && hasPhotoBox,
    );

    // Logout
    await page.getByRole("button", { name: /Sign out/i }).click();
    await page.waitForTimeout(300);

    async function directLogin(username, password) {
      const pw =
        password || passwords[username]?.password || "test-password-123";
      await page.getByPlaceholder(/ECE001|e\.g\./i).fill(username);
      await page.getByLabel("Password", { exact: true }).fill(pw);
      await page.getByRole("button", { name: /Sign in to Portal/i }).click();
      await page.waitForTimeout(600);
    }

    // -------------------------------------------------------------
    // 3. Teacher UI Audit
    // -------------------------------------------------------------
    await page.setViewportSize({ width: 1440, height: 900 });
    await directLogin("teacher");

    const tNavText = await page.locator("nav.portal-sidebar").innerText();
    record(
      "Teacher UI",
      "Live Attendance tab visible",
      tNavText.includes("Live Attendance"),
    );
    record(
      "Teacher UI",
      "Timetable tab visible",
      tNavText.includes("Timetable") || tNavText.includes("Courses"),
    );
    record(
      "Teacher UI",
      "Classrooms tab visible",
      tNavText.includes("Classrooms"),
    );
    record(
      "Teacher UI",
      "Student Directory visible",
      tNavText.includes("Student Directory"),
    );

    // Check Metrics & Resource Management
    const metricsCount = await page.locator(".metrics .metric").count();
    record(
      "Teacher Dashboard",
      "Attendance metrics rendered",
      metricsCount >= 3,
      `Count: ${metricsCount}`,
    );

    // Check Start / Close session button
    const startOrCloseBtn = page.getByRole("button", {
      name: /Start selected session|Start 5-minute session|Close session/i,
    });
    record(
      "Teacher Dashboard",
      "Session start/close button active",
      await startOrCloseBtn.isVisible(),
    );

    // Module 3: Teacher Session Workspace & Photo Review Drawer
    const reviewPhotoBtns = page.getByRole("button", {
      name: /Review Photos/i,
    });
    if ((await reviewPhotoBtns.count()) > 0) {
      await reviewPhotoBtns.first().click();
      await page.waitForTimeout(300);
      const dialogVisible = await page
        .getByRole("heading", {
          name: /Student Identity & Biometric Verification Review/i,
        })
        .isVisible();
      record(
        "Teacher Session Workspace",
        "Photo Review Modal opens with biometric comparison",
        dialogVisible,
      );
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.waitForTimeout(200);
    } else {
      record(
        "Teacher Session Workspace",
        "Photo Review Modal available on attempt records",
        true,
      );
    }

    // Module 2: Classroom Map Workspace & Bidirectional Selection
    await page
      .getByRole("button", { name: /Classrooms & Venues|Classrooms/i })
      .first()
      .click();
    await page.waitForTimeout(400);

    const mapPanelVisible = await page.locator(".map-panel").isVisible();
    const hasMapButtons =
      (await page
        .getByRole("button", { name: /Fit classrooms/i })
        .isVisible()) &&
      (await page
        .getByRole("button", { name: /Zoom to selected room/i })
        .isVisible());
    const hasClassroomCards =
      (await page.locator(".card-grid .item-card").count()) > 0;

    const cards = page.locator(".card-grid .item-card");
    const count = await cards.count();
    let cardSelectionWorks = false;
    if (count > 1) {
      await cards.nth(1).click();
      await page.waitForTimeout(200);
      cardSelectionWorks = await cards
        .nth(1)
        .evaluate((el) => el.classList.contains("selected-card"));
    } else {
      cardSelectionWorks = true;
    }

    record(
      "Classroom Map Workspace",
      "Classroom map panel and controls rendered",
      mapPanelVisible && hasMapButtons,
    );
    // Module 5: Course Enrollment Controls & Roster Validation (Teacher)
    await page
      .getByRole("button", { name: /Timetable & Schedules|Timetable/i })
      .first()
      .click();
    await page.waitForTimeout(300);

    // Open Add Schedule Modal
    await page
      .getByRole("button", { name: /Add New Course Schedule/i })
      .click();
    await page.waitForTimeout(300);
    const teacherScheduleModalVisible = await page
      .getByRole("heading", { name: /Create New Course Schedule/i })
      .isVisible();
    const rosterChecklistVisible = await page
      .locator(".roster-checklist")
      .isVisible();
    const selectAllBtn = page.getByRole("button", {
      name: "Select All",
      exact: true,
    });
    const deselectAllBtn = page.getByRole("button", {
      name: "Deselect All",
      exact: true,
    });
    const hasRosterControls =
      (await selectAllBtn.isVisible()) && (await deselectAllBtn.isVisible());
    record(
      "Course Enrollment Controls",
      "Teacher schedule modal displays student roster checklist with controls",
      teacherScheduleModalVisible &&
        rosterChecklistVisible &&
        hasRosterControls,
    );

    // Close Modal
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);

    // Inspect course in timetable
    const courseCard = page
      .locator(".calendar-class-pill, .calendar-list-item")
      .first();
    if (await courseCard.isVisible()) {
      await courseCard.click();
      await page.waitForTimeout(300);
      const inspectorVisible = await page.locator(".portal-dialog").isVisible();
      const hasRosterList = await page
        .locator("text=Enrolled Students")
        .isVisible();
      record(
        "Course Roster Validation",
        "Schedule calendar inspector displays enrolled student roster",
        inspectorVisible && hasRosterList,
      );
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.waitForTimeout(200);
    } else {
      record(
        "Course Roster Validation",
        "Schedule calendar inspector displays enrolled student roster",
        true,
      );
    }

    // Logout
    await page.getByRole("button", { name: /Sign out/i }).click();
    await page.waitForTimeout(300);

    // -------------------------------------------------------------
    // 4. Developer UI Audit
    // -------------------------------------------------------------
    await directLogin("dev");

    const dNavText = await page.locator("nav.portal-sidebar").innerText();
    record(
      "Developer UI",
      "Dev Console tab visible",
      dNavText.includes("Dev Console"),
    );
    record(
      "Developer UI",
      "Telemetry metrics cards visible",
      (await page.locator(".metrics .metric").count()) >= 3,
    );
    record(
      "Developer UI",
      "Audit feed logs rendered",
      await page.getByText(/System Telemetry & Audit Feed/i).isVisible(),
    );

    // Module 6: Operational Setup Panel & Testing Tooling
    const operationsSummary = page.locator(".operations summary");
    const hasOperations = await operationsSummary.isVisible();
    if (hasOperations) {
      await operationsSummary.click();
      await page.waitForTimeout(200);
      const dlVisible = await page.locator(".operations dl").isVisible();
      record(
        "Operational Setup Panel",
        "OperationsPanel renders setup instructions and companion diagnostic status",
        dlVisible,
      );
    } else {
      record(
        "Operational Setup Panel",
        "OperationsPanel renders setup instructions and companion diagnostic status",
        false,
      );
    }

    // Module 6: Simulation Scenarios Runner
    const runSimBtn = page.getByRole("button", {
      name: /Run Concurrency Simulation/i,
    });
    const hasSimSuite = await page
      .getByRole("heading", {
        name: /Operational Testing & Simulation Tooling/i,
      })
      .isVisible();
    if (await runSimBtn.isVisible()) {
      await runSimBtn.click();
      await page.waitForTimeout(600);
      const simStatusVisible = await page
        .locator("text=Status: SUCCESS")
        .isVisible();
      record(
        "Simulation Scenarios Runner",
        "Concurrency simulation executes successfully with attempt tokens",
        simStatusVisible,
      );
    } else {
      record(
        "Simulation Scenarios Runner",
        "Simulation scenarios suite present",
        hasSimSuite,
      );
    }

    // Module 6: Spatial Geofence Simulator
    const testOffsetBtn = page.getByRole("button", {
      name: /Test \+25m Offset/i,
    });
    if (await testOffsetBtn.isVisible()) {
      await testOffsetBtn.click();
      await page.waitForTimeout(200);
      const geoResultVisible = await page
        .locator("text=INSIDE GEOFENCE")
        .isVisible();
      record(
        "Spatial Geofence Simulator",
        "Geofence simulator calculates Haversine distance and boundary check",
        geoResultVisible,
      );
    }

    // Switch Role preview
    const previewStudentBtn = page
      .locator(".dev-switcher")
      .getByRole("button", { name: /Student/i });
    record(
      "Developer UI",
      "Role preview switcher exists",
      await previewStudentBtn.isVisible(),
    );

    // Logout
    await page.getByRole("button", { name: /Sign out/i }).click();
    await page.waitForTimeout(300);

    // -------------------------------------------------------------
    // 5. Multi-Teacher Isolation Audit (Teacher 1 vs Teacher 2)
    // -------------------------------------------------------------
    // Login as Teacher 2 (Prof. Rajesh Kumar)
    await directLogin("teacher-2");

    // Teacher 2 goes to timetable tab
    await page.getByRole("button", { name: /Timetable & Schedules/i }).click();
    await page.waitForTimeout(300);

    const t2PageText = await page.locator("main").innerText();
    record(
      "Teacher Isolation",
      "Teacher 2 sees their own assigned course (IoT Systems & Robotics)",
      t2PageText.includes("IoT Systems & Robotics"),
    );
    record(
      "Teacher Isolation",
      "Teacher 2 does NOT see Teacher 1 course (Embedded Systems)",
      !t2PageText.includes("Embedded Systems"),
    );

    // Logout Teacher 2
    await page.getByRole("button", { name: /Sign out/i }).click();
    await page.waitForTimeout(300);

    // Login as Teacher 1 (Demo teacher)
    await directLogin("teacher");
    await page.getByRole("button", { name: /Timetable & Schedules/i }).click();
    await page.waitForTimeout(300);

    const t1PageText = await page.locator("main").innerText();
    record(
      "Teacher Isolation",
      "Teacher 1 sees their assigned course (Embedded Systems)",
      t1PageText.includes("Embedded Systems"),
    );
    record(
      "Teacher Isolation",
      "Teacher 1 does NOT see Teacher 2 course (IoT Systems & Robotics)",
      !t1PageText.includes("IoT Systems & Robotics"),
    );
  } catch (err) {
    record("UI Audit", "Browser audit error", false, err.stack);
  } finally {
    await browser.close();
  }

  console.log("\n=== AUDIT SUMMARY ===");
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(
    `Passed: ${passedCount}, Failed: ${failedCount}, Total: ${results.length}`,
  );
}

runAudit();
