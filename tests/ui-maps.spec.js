import { test, expect } from "@playwright/test";
import { base, login, apiToken, closeOpenSessions } from "./ui-helpers.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const stubTiles = (page) =>
  page.route("https://tile.openstreetmap.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: png }),
  );

async function openClassrooms(page) {
  await page.goto(base);
  await login(page, "teacher");
  await page
    .getByRole("button", { name: /Classrooms/ })
    .first()
    .click();
  await expect(page.getByLabel("Classroom location map")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("map: list and pins select each other, radius is metres, tooltip text is inert, draft cancel keeps the saved venue", async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stubTiles(page);
  await closeOpenSessions(page.request);
  // a venue whose name tries to inject markup
  const token = await apiToken(page.request, "teacher");
  const evil = '<img src=x onerror="window.__xss=1">Lab';
  const created = await page.request.post(`${base}/api/classrooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: evil,
      capacity: 20,
      lat: 13.09,
      lng: 80.28,
      radius: 75,
      maxAccuracy: 100,
    },
  });
  expect(created.ok()).toBe(true);
  await openClassrooms(page);
  const pins = page.locator(".leaflet-marker-icon");
  await expect(pins).toHaveCount(4);

  // list -> map: choose the evil venue card, map re-selects it (selected card highlighted)
  const card = page.locator(".item-card", { hasText: "Lab" }).last();
  await card.click();
  await expect(card).toHaveClass(/selected-card/);
  // map -> list: clicking another pin selects its card
  await pins.nth(0).dispatchEvent("click");
  await expect(page.locator(".item-card.selected-card")).toHaveCount(1);
  await expect(page.locator(".item-card.selected-card")).toContainText(
    "ECE Lab 1",
  );

  // tooltip is plain text, never markup
  await card.click();
  await pins.nth(3).dispatchEvent("mouseover");
  const tip = page.locator(".leaflet-tooltip", { hasText: "onerror" });
  await expect(tip).toContainText("onerror");
  expect(await tip.locator("img").count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  // 75 m radius at zoom 17 on lat ~13.09 is ~129 px across
  await page.getByRole("button", { name: "Zoom to selected room" }).click();
  await page.waitForTimeout(600);
  const widths = await page
    .locator("path.leaflet-interactive")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(widths.some((w) => Math.abs(w - 129) < 8)).toBe(true);

  // editing creates a draft preview; Cancel keeps the saved venue untouched
  await card.getByRole("button", { name: /Edit/ }).click();
  await page.getByLabel("Venue / Room Name").fill("Draft rename");
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await expect(page.getByText("Draft rename")).toHaveCount(0);
  const rooms = await (
    await page.request.get(`${base}/api/classrooms`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  expect(rooms.find((r) => r.name === evil)).toBeTruthy();
  expect(errors).toEqual([]);
  await page.close();
});

test("map: failed tiles fall back to a usable schematic and retry button", async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await openClassrooms(page);
  await expect(
    page.getByText("Schematic location view — street map unavailable."),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("img", { name: /geofence/i })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry street map" }),
  ).toBeVisible();
  // the rest of the page stays usable
  await page.getByRole("button", { name: /Edit/ }).first().click();
  await expect(page.getByLabel("Venue / Room Name")).toBeVisible();
  await page.close();
});
