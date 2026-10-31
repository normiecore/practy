import { expect, runCommand, test } from "./fixtures";

test("a principal changes firm settings through the form and approves them", async ({ page, request }) => {
  const address = `Level ${Date.now() % 100}, 1 Hay St, Perth WA 6000`;
  await page.goto("/#/settings/firm");
  await page.getByRole("button", { name: "Edit settings" }).click();
  const form = page.getByRole("dialog", { name: "Firm settings" });
  await form.getByLabel("Address").fill(address);
  // A bad value is refused before it reaches the approvals inbox, and shown beside the field.
  await form.getByLabel("Time zone").fill("Perth");
  await form.getByRole("button", { name: "Send for approval" }).click();
  await expect(form.getByRole("alert").filter({ hasText: /time zone/i })).toBeVisible();
  await form.getByLabel("Time zone").fill("Australia/Perth");
  await form.getByRole("button", { name: "Send for approval" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText("Sent to the approvals inbox")).toBeVisible();

  const pending = await runCommand<{ id: string; command: string; input: { patch: Record<string, unknown> } }[]>(request, "list_approvals", { status: "pending" });
  const mine = pending.find((a) => a.command === "update_settings" && a.input.patch.firmAddress === address)!;
  expect(Object.keys(mine.input.patch)).toEqual(["firmAddress"]);
  await page.goto("/#/approvals");
  await page.locator(".card", { hasText: address }).getByRole("button", { name: "Approve" }).click();
  await page.goto("/#/settings/firm");
  await expect(page.getByText(address)).toBeVisible();
});
