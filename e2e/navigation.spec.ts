import { clientName, createMatter, expect, matterNumber, test } from "./fixtures";

const PAGES: [string, string][] = [
  ["Today", ""],
  ["Matters", "matters"],
  ["Approvals", "approvals"],
  ["Diary", "diary"],
  ["Email filing", "filing"],
  ["Trust", "trust"],
  ["Compliance", "compliance"],
  ["Settings", "settings"],
  ["All commands", "commands"],
];

const TABS = ["Overview", "Key dates", "Tasks", "File notes", "Evidence requests", "Documents", "Chronology", "Damages", "Settlement", "Time and costs", "Trust", "All actions"];

test("every page in the left navigation loads", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const [label, path] of PAGES) {
    await nav.getByRole("link", { name: new RegExp(`^${label}`) }).click();
    await expect(page).toHaveURL(new RegExp(`#/${path}$`));
    await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toHaveClass("active");
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Page not found")).toHaveCount(0);
    await expect(page.getByRole("main").getByText("Loading…")).toHaveCount(0);
  }
});

test("every matter tab loads", async ({ page, request }) => {
  const matter = await createMatter(request, { number: matterNumber("TABS"), title: "Tabs test v ICWA", client: clientName(), injuryDate: "2025-03-14" });
  await page.goto(`/#/matters/${matter.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Tabs test v ICWA" })).toBeVisible();
  for (const label of TABS) {
    const tab = page.getByRole("tab", { name: label, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Unknown tab")).toHaveCount(0);
    await expect(page.getByRole("main").getByText("Loading…")).toHaveCount(0);
  }
});
