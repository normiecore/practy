/** On a desktop screen tables keep their column headings and matter sections stay as tabs (phones get cards and a picker). */
import { clientName, createMatter, expect, matterNumber, test } from "./fixtures";

test("tables keep their headings and the matter tabs stay a strip on a desktop screen", async ({ page, request }) => {
  const number = matterNumber("DESK");
  const matter = await createMatter(request, { number, title: "Desktop table v ICWA", client: clientName(), injuryDate: "2025-03-14" });

  await page.goto(`/#/matters/${matter.id}/dates`);
  const table = page.getByRole("main").getByRole("table");
  await expect(table.locator("thead")).toBeVisible();
  await expect(table.locator("thead th")).toHaveText(["Date", "Key date", "Source", "Status", ""]);
  await expect(page.getByRole("tablist", { name: "Section" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Section" })).toBeHidden();
  // A row stays one line of cells, the Confirm button beside the status.
  const row = page.getByRole("row").filter({ hasText: "Limitation: commence proceedings (3 years from injury)" });
  const [status, confirm] = [await row.getByText("proposed").boundingBox(), await row.getByRole("button", { name: "Confirm" }).boundingBox()];
  expect(confirm!.x).toBeGreaterThan(status!.x);
  expect(Math.abs(confirm!.y - status!.y)).toBeLessThan(20);

  await page.goto("/#/matters");
  await page.getByRole("textbox", { name: "Search matters" }).fill(number);
  await expect(page.getByRole("main").locator("thead th")).toHaveText(["No.", "Title", "Scheme", "Injury date", "Status"]);
  await expect(page.getByRole("link", { name: number, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Desktop table v ICWA", exact: true })).toBeVisible();
});
