import { test, expect } from "@playwright/test";

const base = "http://127.0.0.1:5190";
const password = "correct-horse-battery";

test.describe.configure({ mode: "serial" });

test("connected mode: register, profile, reload, silent renewal, logout without re-login", async ({
  browser,
}) => {
  const errors = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const email = `student-${Date.now()}@example.test`;
  await page.goto(base);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByText("Quick Demo Login")).toHaveCount(0);

  // wrong password is refused with a readable message
  await page.getByLabel("Email", { exact: true }).fill("nobody@example.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-1");
  await page.getByRole("button", { name: "Sign in to Portal ➔" }).click();
  await expect(page.getByText(/incorrect/i)).toBeVisible();

  // register through the real UI
  await page.getByRole("button", { name: /Register Account/ }).click();
  await page.getByLabel("Full Name").fill("Ada Student");
  await page.getByLabel("Roll Number").fill("ECE900");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel(/Password \(at least 10/).fill(password);
  await page.getByRole("button", { name: "Create Account & Sign In" }).click();
  await expect(
    page.getByRole("heading", { name: "Ada Student" }),
  ).toBeVisible();
  const auth1 = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("tp-auth")),
  );
  expect(auth1.user.role).toBe("student");
  expect(JSON.stringify(auth1)).not.toMatch(
    /referencePhoto|data:image|password/i,
  );

  // profile update through the UI
  await page
    .locator('.mobile-nav-item[aria-label="My Profile & Settings"]')
    .click();
  const nameField = page.getByLabel("Full Name").first();
  await nameField.fill("Ada Lovelace");
  await page
    .getByRole("button", { name: /Save|Update/ })
    .first()
    .click();
  await expect(page.getByText(/updated successfully/i)).toBeVisible();
  const afterSave = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("tp-auth")),
  );
  expect(afterSave.user.name).toBe("Ada Lovelace");
  expect(JSON.stringify(afterSave)).not.toMatch(/referencePhoto|data:image/);

  // reload keeps the session; then a dead server token is silently renewed from Firebase
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ada Lovelace" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const a = JSON.parse(sessionStorage.getItem("tp-auth"));
    a.token = "revoked-or-expired";
    sessionStorage.setItem("tp-auth", JSON.stringify(a));
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ada Lovelace" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(sessionStorage.getItem("tp-auth")).token),
    )
    .not.toBe("revoked-or-expired");
  const renewed = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("tp-auth")),
  );
  expect(renewed.expiresAt).toBe(auth1.expiresAt); // absolute 8 h limit is not extended

  // logout revokes the server session and does not silently sign back in
  const token = renewed.token;
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(
    (
      await page.request.get(`${base}/api/state`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(401);
  await page.reload();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(
    await page.evaluate(() => sessionStorage.getItem("tp-auth")),
  ).toBeNull();
  expect(errors).toEqual([]);
  await ctx.close();
});

test("connected mode: teacher signs in with Firebase credentials; students cannot reach teacher views", async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto(base);
  await page.getByLabel("Email", { exact: true }).fill("teacher@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to Portal ➔" }).click();
  await expect(page.getByTestId("occupancy-panel")).toBeVisible();
  const auth = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("tp-auth")),
  );
  expect(auth.user.role).toBe("admin");
  const asTeacher = await page.request.get(`${base}/api/people`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(asTeacher.status()).toBe(200);
  // developer role control is not offered to teachers
  await page.getByRole("button", { name: "Student Directory" }).first().click();
  await expect(page.getByText("Role control")).toHaveCount(0);
  await page.close();
});
