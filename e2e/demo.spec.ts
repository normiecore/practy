/**
 * The sample firm from `npm run demo` (src/server/demo.ts), served on its own port by the "demo"
 * project. Someone previewing Practy signs in as the principal and should see a working firm.
 * Read-only: the tests share one demo server, so they change nothing.
 */
import type { Page } from "@playwright/test";
import { expect, fitsScreen, test } from "./fixtures";

const PRINCIPAL = { email: "principal@example.com", name: "Alex Demo" };

async function signIn(page: Page) {
  await page.goto("/auth/login/dev");
  await page.getByLabel("Email").fill(PRINCIPAL.email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

const section = (page: Page, heading: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

test("Today shows the sample firm's overdue and coming dates, tasks and approvals", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toContainText("Example Law (sample data)");
  await expect(nav).toContainText(PRINCIPAL.name);
  await expect(nav.getByRole("link", { name: /Approvals/ })).toContainText("2");

  await expect(page.locator(".card").filter({ hasText: "Approvals waiting" })).toContainText("2");
  const overdue = section(page, "Overdue");
  await expect(overdue.getByRole("row").filter({ hasText: "Serve medical reports on the insurer" })).toContainText("DEMO-1004");
  await expect(overdue.getByRole("row").filter({ hasText: "Reply to the insurer's request for further information" })).toContainText("confirmed");
  const coming = section(page, "Coming up");
  await expect(coming.getByRole("row").filter({ hasText: "Conciliation conference" })).toContainText("DEMO-1004");
  await expect(coming.getByRole("row").filter({ hasText: "Settlement conference with Example Insurer" })).toContainText("DEMO-1002");
  await expect(section(page, "My tasks").getByRole("listitem")).toHaveCount(4);
  // One WorkCover election date entered by the paralegal and waiting for approval, one still to be entered.
  const elections = section(page, "Proposed dates to confirm").getByRole("row").filter({ hasText: "Common-law election" });
  await expect(elections.filter({ hasText: "DEMO-1003" })).toContainText("proposed");
  await expect(elections.filter({ hasText: "DEMO-1004" })).toContainText("manual required");
});

test("the approvals inbox holds the paralegal's requests", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/approvals");
  const cards = page.locator(".card").filter({ hasText: "Requested by Jordan Demo" });
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ has: page.getByRole("heading", { name: "Confirm key date" }) })).toHaveCount(1);
  await expect(cards.filter({ has: page.getByRole("heading", { name: "Approve time entries" }) })).toHaveCount(1);
  await expect(cards.first().getByRole("button", { name: "Approve" })).toBeVisible();

  await page.getByRole("tab", { name: "Executed" }).click();
  await expect(page.locator(".card").filter({ hasText: "Alex Demo approved" }).first()).toBeVisible();
});

test("the settling matter has documents, evidence, damages, an Authority to Settle and time", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/matters");
  const rows = page.getByRole("main").getByRole("row").filter({ hasText: /DEMO-100\d/ });
  await expect(rows).toHaveCount(5);
  await expect(rows.filter({ hasText: "ICWA motor vehicle" })).toHaveCount(3);
  await expect(rows.filter({ hasText: "WorkCover WA" })).toHaveCount(2);

  await rows.filter({ hasText: "DEMO-1002" }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: /Specimen v Example Insurer/ })).toBeVisible();

  await page.getByRole("tab", { name: "Documents" }).click();
  const ime = page.getByRole("link", { name: /^\d{4}\.\d{2}\.\d{2} SIER12 – IME Report – by Dr Quinn Example/ });
  await expect(ime).toBeVisible();
  // The sample documents are real PDFs the browser can open.
  const pdf = await page.request.get((await ime.getAttribute("href"))!);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("tab", { name: "Evidence requests" }).click();
  await expect(page.getByRole("main")).toContainText("Sample Physio Clinic");

  await page.getByRole("tab", { name: "Damages" }).click();
  await expect(page.getByText("Version 1,")).toBeVisible();
  await page.getByRole("tab", { name: "Settlement" }).click();
  await expect(page.getByRole("heading", { name: "Figures (version 1)" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("$112,420.00");

  await page.getByRole("tab", { name: "Time and costs" }).click();
  await expect(page.getByRole("main")).toContainText("Draft particulars of damages");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("Today fits the screen with the sample data, and the tab bar counts the approvals", async ({ page }) => {
    await signIn(page);
    await fitsScreen(page, "Today");
    await expect(section(page, "Overdue").getByRole("row").filter({ hasText: "Serve medical reports on the insurer" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Approvals/ })).toContainText("2");
  });
});
