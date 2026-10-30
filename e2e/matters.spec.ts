import { clientName, createMatter, expect, matterNumber, openMatterInApp, test } from "./fixtures";

test("opens a matter and lands on its proposed key dates", async ({ page }) => {
  const number = matterNumber("OPEN");
  await openMatterInApp(page, { number, title: "Opening test v ICWA", client: clientName(), injuryDate: "2025-03-14" });

  await expect(page).toHaveURL(/#\/matters\/[^/]+\/dates$/);
  await expect(page.getByRole("status")).toContainText("Matter opened with");
  await expect(page.getByRole("heading", { level: 1, name: "Opening test v ICWA" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Key dates" })).toHaveAttribute("aria-selected", "true");
  const limitation = page.getByRole("row").filter({ hasText: "Limitation: commence proceedings (3 years from injury)" });
  await expect(limitation).toContainText("14/03/2028");
  await expect(limitation).toContainText("proposed");
});

test("confirms a key date through the approvals inbox", async ({ page }) => {
  await openMatterInApp(page, { number: matterNumber("CONF"), title: "Confirmation test v ICWA", client: clientName(), injuryDate: "2025-03-14" });
  await expect(page).toHaveURL(/#\/matters\/[^/]+\/dates$/);
  const matterId = new URL(page.url()).hash.split("/")[2]!;

  const limitation = page.getByRole("row").filter({ hasText: "Limitation: commence proceedings (3 years from injury)" });
  await limitation.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status")).toContainText("Sent to the approvals inbox");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Approvals/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Approvals" })).toBeVisible();
  // Other tests share the server, so pick the request for this matter.
  const request = page.locator(".card").filter({ has: page.locator(`a[href="#/matters/${matterId}"]`) });
  await expect(request).toHaveCount(1);
  await expect(request.getByRole("heading", { name: "Confirm key date" })).toBeVisible();
  await request.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toContainText("Approved");
  await expect(request).toHaveCount(0);

  await page.goto(`/#/matters/${matterId}/dates`);
  await expect(limitation.getByText("confirmed", { exact: true })).toBeVisible();
  await expect(limitation.getByRole("button", { name: "Confirm" })).toHaveCount(0);
});

test("warns of possible conflicts when the client matches an existing party", async ({ page, request }) => {
  const client = clientName();
  const first = await createMatter(request, { number: matterNumber("FIRST"), title: "First conflict matter", client });

  await openMatterInApp(page, { number: matterNumber("SECOND"), title: "Second conflict matter", client, injuryDate: "2025-06-01" });
  const dialog = page.getByRole("dialog", { name: "Possible conflicts" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("the conflict search matched existing parties");
  await expect(dialog).toContainText(client);
  await expect(dialog).toContainText("First conflict matter");
  await dialog.getByRole("button", { name: "Go to matter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Second conflict matter" })).toBeVisible();
  expect(page.url()).not.toContain(first.id);
});
