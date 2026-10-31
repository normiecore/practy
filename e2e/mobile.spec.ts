import { clientName, createMatter, expect, fitsScreen, matterNumber, test } from "./fixtures";

const PAGES = ["/#/", "/#/matters", "/#/approvals", "/#/diary", "/#/filing", "/#/trust", "/#/compliance", "/#/settings/firm"];
const TABS = ["overview", "dates", "tasks", "documents", "damages", "settlement"];

test("every main page fits an iPhone screen, with sign-out reachable", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator(".main h1").first()).toBeVisible();
    await fitsScreen(page, path);
  }
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("matter tabs fit an iPhone screen and fields are large enough not to zoom", async ({ page, request }) => {
  const matter = await createMatter(request, { number: matterNumber("MOB"), title: "Phone test v ICWA", client: clientName(), injuryDate: "2025-03-14" });
  for (const tab of TABS) {
    await page.goto(`/#/matters/${matter.id}/${tab}`);
    await expect(page.locator(".main h1").first()).toBeVisible();
    await fitsScreen(page, tab);
  }
  await page.goto("/#/matters");
  const size = await page.getByRole("textbox", { name: "Search matters" }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});
