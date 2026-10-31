/** Page content on an iPhone: tables as cards, the matter section picker, tap targets and phone keyboards. */
import type { Locator, Page } from "@playwright/test";
import { clientName, createMatter, expect, fitsScreen, matterNumber, runCommand, test } from "./fixtures";

const TABS = ["overview", "dates", "tasks", "notes", "evidence", "documents", "chronology", "damages", "settlement", "time", "trust", "actions"];
// Long enough to wrap past three lines at 390px, so the clamp has to cut it.
const LONG_NAME = "2025-04-02 Letter from the treating orthopaedic surgeon to the insurer about the treatment plan, prognosis and work capacity of the plaintiff following the second surgery and the independent medical examination.pdf";

// The same plaintiff as e2e/damages.spec.ts.
const DAMAGES = {
  plaintiff: { sex: "female", background: "clerical work background" },
  calculationDate: "2026-11-01",
  preInjuryEarnings: { grossWeeklyCents: 155_300, source: "2024–25 income statement" },
  specialDamages: [{ from: "2025-04-01", providerPayer: "ICWA", item: "Physiotherapy", amountCents: 80_000, paidBy: "insurer" }],
  futureMedical: [{ service: "GP", costCents: 9_000, frequencyPerYear: 4, frequency: "every 4 months" }],
  generalDamagesCents: null,
  lifeExpectancy: { years: 45.1, citation: "ABS Life Tables, Western Australia, 2022 to 2024" },
};

/**
 * The element lies wholly within the screen's width and nothing around it scrolls sideways
 * (the old tables sat in a sideways-scrolling box with their action columns off screen).
 */
async function acrossScreen(target: Locator, what: string, tap = true) {
  await expect(target, what).toBeVisible();
  const m = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const wrap = el.closest(".table-wrap");
    return { left: r.left, right: r.right, height: r.height, viewport: window.innerWidth, wrapScrolls: wrap ? wrap.scrollWidth > wrap.clientWidth : false };
  });
  expect(m.left, `${what} starts off screen`).toBeGreaterThanOrEqual(0);
  expect(m.right, `${what} runs off screen`).toBeLessThanOrEqual(m.viewport);
  expect(m.wrapScrolls, `${what} sits in a table that scrolls sideways`).toBe(false);
  if (tap) expect(m.height, `${what} is too small to tap`).toBeGreaterThanOrEqual(44);
}

async function seededMatter(request: import("@playwright/test").APIRequestContext) {
  const matter = await createMatter(request, { number: matterNumber("CARD"), title: "Card test v ICWA", client: clientName(), clientDateOfBirth: "1990-05-01", injuryDate: "2025-03-14" });
  await runCommand(request, "upload_document", {
    matterId: matter.id,
    name: LONG_NAME,
    base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
    contentType: "application/pdf",
    docDate: "2025-04-02",
  });
  await runCommand(request, "create_task", { matterId: matter.id, title: "Request hospital records", dueOn: "2026-11-10" });
  await runCommand(request, "log_evidence_request", { matterId: matter.id, kind: "medical_records", provider: "Fiona Stanley Hospital", description: "ED records" });
  await runCommand(request, "compute_damages", { matterId: matter.id, ...DAMAGES });
  return matter;
}

const mainTableHeads = (page: Page) => page.getByRole("main").locator("thead");

test("key dates are cards with the Confirm button on screen", async ({ page, request }) => {
  const matter = await createMatter(request, { number: matterNumber("KD"), title: "Key date cards v ICWA", client: clientName(), injuryDate: "2025-03-14" });
  await page.goto(`/#/matters/${matter.id}/dates`);
  const card = page.getByRole("row").filter({ hasText: "Limitation: commence proceedings (3 years from injury)" });
  await expect(card).toContainText("14/03/2028");
  await expect(card).toContainText("proposed");
  await acrossScreen(card.getByRole("button", { name: "Confirm" }), "Confirm");
  await acrossScreen(card.getByRole("button", { name: "Edit" }), "Edit");
  // Each value carries its own label once the column headings are hidden.
  await expect(mainTableHeads(page)).toBeHidden();
  await expect(card.locator('td[data-label="Date"]')).toHaveText("14/03/2028");
  await expect(card.locator('td[data-label="Status"]')).toHaveText("proposed");
  await fitsScreen(page, "key dates");

  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status")).toContainText("Sent to the approvals inbox");
});

test("documents are cards with their actions on screen and long names cut to three lines", async ({ page, request }) => {
  const matter = await seededMatter(request);
  await page.goto(`/#/matters/${matter.id}/documents`);
  const card = page.getByRole("row").filter({ hasText: "orthopaedic surgeon" });
  for (const name of ["Chronology", "Mark evidence", "Exclude from AI"]) await acrossScreen(card.getByRole("button", { name }), name);
  const link = card.getByRole("link");
  await expect(link).toHaveAttribute("title", LONG_NAME);
  await acrossScreen(link, "Document link");
  const clamp = await link.evaluate((el) => {
    const style = getComputedStyle(el);
    return { cut: el.scrollHeight > el.clientHeight, lines: el.clientHeight / parseFloat(style.lineHeight), padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) };
  });
  expect(clamp.cut, "the long name is actually cut").toBe(true);
  // No padding inside the clip, or part of a fourth line shows beneath the third.
  expect(clamp.padding).toBe(0);
  expect(clamp.lines).toBeLessThanOrEqual(3.05);
  await fitsScreen(page, "documents");
});

test("the Matters list shows each matter as a card with one tall link", async ({ page, request }) => {
  const number = matterNumber("LIST");
  const matter = await createMatter(request, { number, title: "Matter card v ICWA", client: clientName(), injuryDate: "2025-03-14" });
  await page.goto("/#/matters");
  const search = page.getByRole("textbox", { name: "Search matters" });
  await expect(search).toHaveAttribute("enterkeyhint", "search");
  await search.fill(number);
  // Number and title are one link, at least 44px tall, across the screen.
  const link = page.getByRole("link", { name: new RegExp(`^${number}\\s+Matter card v ICWA$`) });
  await acrossScreen(link, "Matter link");
  const card = page.getByRole("row").filter({ has: link });
  await expect(card.getByText("ICWA motor vehicle")).toBeVisible();
  await expect(card).toContainText("14/03/2025");
  // Search and scheme filter share a row.
  const [s, f] = [await search.boundingBox(), await page.getByRole("combobox", { name: "Scheme" }).boundingBox()];
  expect(Math.abs(s!.y - f!.y), "search and scheme filter on one row").toBeLessThan(2);
  await fitsScreen(page, "matters");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#/matters/${matter.id}$`));
});

test("a section picker replaces the matter tabs and switches section by URL", async ({ page, request }) => {
  const matter = await createMatter(request, { number: matterNumber("PICK"), title: "Picker test v ICWA", client: clientName(), injuryDate: "2025-03-14" });
  await page.goto(`/#/matters/${matter.id}`);
  const picker = page.getByRole("combobox", { name: "Section" });
  await expect(picker).toHaveValue("overview");
  await expect(page.getByRole("tablist")).toBeHidden();
  await acrossScreen(picker, "Section picker");
  await picker.selectOption({ label: "Documents" });
  await expect(page).toHaveURL(new RegExp(`#/matters/${matter.id}/documents$`));
  await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
  await picker.selectOption({ label: "Key dates" });
  await expect(page).toHaveURL(new RegExp(`#/matters/${matter.id}/dates$`));
  await expect(page.getByRole("heading", { name: "Key dates" })).toBeVisible();
  // The breadcrumb back to Matters is a full-size tap target.
  await acrossScreen(page.getByRole("main").getByRole("link", { name: "Matters", exact: true }), "Breadcrumb");
});

test("no tab or list page scrolls sideways with real content in it", async ({ page, request }) => {
  const matter = await seededMatter(request);
  for (const tab of TABS) {
    await page.goto(`/#/matters/${matter.id}/${tab}`);
    await expect(page.locator(".main h1").first()).toBeVisible();
    await expect(page.getByRole("main").getByText("Loading…")).toHaveCount(0);
    await fitsScreen(page, tab);
  }
  // Damages: every amount, and the totals, on screen.
  await page.goto(`/#/matters/${matter.id}/damages`);
  const net = page.getByRole("row").filter({ hasText: /^Net\$/ });
  await acrossScreen(net.locator(".num"), "Net amount", false);
  for (const path of ["/#/", "/#/diary", "/#/commands", "/#/settings/users", "/#/settings/sessions"]) {
    await page.goto(path);
    await expect(page.locator(".main h1").first()).toBeVisible();
    await expect(page.getByRole("main").getByText("Loading…")).toHaveCount(0);
    await fitsScreen(page, path);
  }
  // Every action in the list of commands can be reached and tapped.
  await page.goto("/#/commands");
  await acrossScreen(page.getByRole("main").getByRole("button", { name: "Open a matter" }), "Command");
});

test("forms bring up the email and phone keyboards", async ({ page }) => {
  await page.goto("/#/matters");
  await page.getByRole("button", { name: "Open a matter" }).click();
  const client = page.getByRole("dialog", { name: "Open a matter" }).getByRole("group", { name: "Client" });
  const email = client.getByRole("textbox", { name: /^Email/ });
  await expect(email).toHaveAttribute("type", "email");
  await expect(email).toHaveAttribute("autocomplete", "email");
  const phone = client.getByRole("textbox", { name: /^Phone/ });
  await expect(phone).toHaveAttribute("type", "tel");
  await expect(phone).toHaveAttribute("autocomplete", "tel");
  await expect(client.getByRole("textbox", { name: /^Name/ })).toHaveAttribute("enterkeyhint", "go");
});

test("sign-in sessions open from the Section picker as cards, with this device marked and no End button on it", async ({ page }) => {
  await page.goto("/#/settings/firm");
  const picker = page.getByRole("combobox", { name: "Section" });
  await acrossScreen(picker, "Section picker");
  await picker.selectOption({ label: "Sign-in sessions" });
  await expect(page).toHaveURL(/#\/settings\/sessions$/);
  const mine = page.getByRole("main").getByRole("row").filter({ hasText: "This device" });
  await expect(mine).toHaveCount(1);
  await expect(mine.getByRole("button")).toHaveCount(0);
  await expect(mine.locator('td[data-label="Location"]')).toBeVisible();
  await expect(mainTableHeads(page)).toBeHidden();
  await acrossScreen(page.getByRole("button", { name: "Sign out all other devices" }), "Sign out all other devices");
  await fitsScreen(page, "sign-in sessions");
});
