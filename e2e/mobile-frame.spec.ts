/** The app frame on an iPhone: bottom tab bar, More sheet, full-screen dialogs, the assistant and Today's counts. */
import { ADMIN_EMAIL, clientName, createMatter, expect, matterNumber, test } from "./fixtures";

const TABS: [string, string][] = [
  ["Matters", "matters"],
  ["Approvals", "approvals"],
  ["Diary", "diary"],
  ["Today", ""],
];
const MORE: [string, string][] = [
  ["Email filing", "filing"],
  ["Trust", "trust"],
  ["Compliance", "compliance"],
  ["Settings", "settings"],
  ["All commands", "commands"],
];

test("a bottom tab bar replaces the sidebar, and each tab navigates", async ({ page }) => {
  await page.goto("/#/trust");
  await expect(page.locator("nav.nav")).toBeHidden();
  await expect(page.getByRole("banner")).toContainText("Practy");
  const bar = page.getByRole("navigation", { name: "Main" });
  await expect(bar).toBeVisible();

  // Pinned to the bottom edge across the full width, with room left under the page for it.
  const screen = page.viewportSize()!;
  const box = (await bar.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(screen.height);
  expect(Math.round(box.width)).toBe(screen.width);
  const room = await page.locator(".main").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(room).toBeGreaterThanOrEqual(box.height);

  for (const [label, path] of TABS) {
    const tab = bar.getByRole("link", { name: new RegExp(`^${label}`) });
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await tab.click();
    await expect(page).toHaveURL(new RegExp(`#/${path}$`));
    await expect(tab).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Page not found")).toHaveCount(0);
  }
  const more = bar.getByRole("button", { name: "More" });
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("More opens a sheet with the other sections, the assistant and sign-out", async ({ page }) => {
  await page.goto("/");
  const more = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More" });
  const sheet = page.getByRole("dialog", { name: "More" });

  for (const [label, path] of MORE) {
    await more.click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/${path}$`));
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    // A section under More marks the More tab as the current one.
    await expect(more).toHaveClass(/active/);
  }

  await more.click();
  await expect(sheet).toContainText(ADMIN_EMAIL);
  await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
  // Focus moves into the sheet; Escape closes it and puts focus back on More.
  await expect(sheet).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();
  // Tapping the dimmed page above the sheet closes it too.
  await more.click();
  await page.locator(".sheet-back").click({ position: { x: 20, y: 20 } });
  await expect(sheet).toBeHidden();

  // The assistant opens full screen, with a message box large enough that iOS does not zoom.
  await more.click();
  await sheet.getByRole("button", { name: "Assistant" }).click();
  await expect(sheet).toBeHidden();
  const chat = page.getByRole("complementary", { name: "Assistant" });
  await expect(chat).toBeVisible();
  // Focus moves into the assistant, not back to the More tab it now covers.
  expect(await chat.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  const closeChat = (await chat.getByRole("button", { name: "Close assistant" }).boundingBox())!;
  expect(Math.min(closeChat.width, closeChat.height)).toBeGreaterThanOrEqual(44);
  const screen = page.viewportSize()!;
  const box = (await chat.boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([screen.width, screen.height]);
  const message = chat.getByRole("textbox", { name: "Message" });
  await expect(message).toBeInViewport({ ratio: 1 });
  expect(await message.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await chat.getByRole("button", { name: "Close assistant" }).click();
  await expect(chat).toBeHidden();
});

test("a long dialog fills the screen and keeps its submit button in view", async ({ page, request }) => {
  const matter = await createMatter(request, { number: matterNumber("MFR"), title: "Frame test v ICWA", client: clientName(), clientDateOfBirth: "1990-05-01", injuryDate: "2025-03-14" });
  await page.goto(`/#/matters/${matter.id}/damages`);
  await page.getByRole("button", { name: "Compute damages" }).click();
  const dialog = page.getByRole("dialog", { name: "Particulars of damages" });
  await expect(dialog).toBeVisible();

  const screen = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect([box.x, box.y, Math.round(box.width), Math.round(box.height)]).toEqual([0, 0, screen.width, screen.height]);
  // The form is longer than the screen, yet the submit button shows without scrolling.
  expect(await dialog.locator(".modal-body").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(dialog.getByRole("button", { name: "Compute damages" })).toBeInViewport({ ratio: 1 });

  // Scrolled to the middle, the title and close button stay put and the submit button stays in view.
  await dialog.locator(".modal-body").evaluate((el) => el.scrollTo(0, el.scrollHeight / 2));
  await expect(dialog.getByRole("heading", { name: "Particulars of damages" })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("button", { name: "Compute damages" })).toBeInViewport({ ratio: 1 });
  const close = dialog.getByRole("button", { name: "Close" });
  await expect(close).toBeInViewport({ ratio: 1 });
  const size = (await close.boundingBox())!;
  expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(dialog).toBeHidden();
});

test("a failed submit brings its message into view above the sticky button", async ({ page, request }) => {
  const matter = await createMatter(request, { number: matterNumber("MFE"), title: "Frame errors v ICWA", client: clientName(), injuryDate: "2025-03-14" });
  await page.goto(`/#/matters/${matter.id}/damages`);
  await page.getByRole("button", { name: "Compute damages" }).click();
  const dialog = page.getByRole("dialog", { name: "Particulars of damages" });
  // Tapped straight away: sex, date of birth and earnings are missing.
  await dialog.getByRole("button", { name: "Compute damages" }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Still needed" })).toBeInViewport();
  // A second failed tap, from the top of the form, finds it again.
  await dialog.locator(".modal-body").evaluate((el) => el.scrollTo(0, 0));
  await dialog.getByRole("button", { name: "Compute damages" }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Still needed" })).toBeInViewport();
});

test("each tab opens at the top of its page", async ({ page }) => {
  await page.goto("/#/commands");
  await page.locator(".main").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Approvals" }).click();
  await expect(page).toHaveURL(/#\/approvals/);
  expect(await page.locator(".main").evaluate((el) => el.scrollTop)).toBe(0);
});

test("Today shows its four counts two to a row", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator(".main .card").filter({ has: page.locator(".stat") });
  await expect(cards).toHaveCount(4);
  const [a, b, c, d] = await Promise.all([0, 1, 2, 3].map(async (i) => (await cards.nth(i).boundingBox())!));
  expect(a!.y).toBe(b!.y);
  expect(c!.y).toBe(d!.y);
  expect(c!.y).toBeGreaterThan(a!.y);
  expect(b!.x).toBeGreaterThan(a!.x + a!.width);
  expect(b!.x + b!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
