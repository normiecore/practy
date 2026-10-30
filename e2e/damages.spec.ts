import { clientName, createMatter, expect, matterNumber, runCommand, test } from "./fixtures";

// The same plaintiff as test/damages/commands.test.ts.
const DAMAGES = {
  plaintiff: { sex: "female", background: "clerical work background" },
  calculationDate: "2026-11-01",
  preInjuryEarnings: { grossWeeklyCents: 155_300, source: "2024–25 income statement" },
  specialDamages: [{ from: "2025-04-01", providerPayer: "ICWA", item: "Physiotherapy", amountCents: 80_000, paidBy: "insurer" }],
  futureMedical: [{ service: "GP", costCents: 9_000, frequencyPerYear: 4, frequency: "every 4 months" }],
  generalDamagesCents: null,
  lifeExpectancy: { years: 45.1, citation: "ABS Life Tables, Western Australia, 2022 to 2024" },
};

const money = (cents: number) => (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

test("shows a saved damages model and Authority to Settle on the matter", async ({ page, request }) => {
  const matter = await createMatter(request, {
    number: matterNumber("DMG"),
    title: "Damages test v ICWA",
    client: clientName(),
    clientDateOfBirth: "1990-05-01",
    injuryDate: "2025-03-14",
  });
  const damages = await runCommand<{ version: number; model: { summary: { totalCents: number; netCents: number; lines: { id: string; title: string; amountCents: number }[] } } }>(
    request,
    "compute_damages",
    { matterId: matter.id, ...DAMAGES },
  );
  await runCommand(request, "compute_authority_to_settle", {
    matterId: matter.id,
    settlementOfferCents: 3_343_055,
    legalCostsCents: 3_750_000,
    disbursementsCents: 253_000,
    medicalAccountsCents: 156_945,
    medicalAccountsPaidByClient: true,
    clientPaidDisbursements: true,
  });

  await page.goto(`/#/matters/${matter.id}/damages`);
  await expect(page.getByRole("button", { name: "New version" })).toBeVisible();
  await expect(page.getByText(`Version ${damages.version},`)).toBeVisible();
  const heads = page.getByRole("table");
  await expect(heads.locator("thead th")).toHaveText(["Head", "Item", "Amount"]);
  const { summary } = damages.model;
  expect(summary.lines.length).toBeGreaterThan(0);
  for (const line of summary.lines) {
    await expect(heads.getByRole("row").filter({ hasText: line.title })).toContainText(money(line.amountCents));
  }
  await expect(heads.getByRole("row").filter({ hasText: /^Total\$/ })).toContainText(money(summary.totalCents));
  await expect(heads.getByRole("row").filter({ hasText: /^Net\$/ })).toContainText(money(summary.netCents));

  await page.getByRole("tab", { name: "Settlement" }).click();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Settlement" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Authority to Settle" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Compute", exact: true })).toBeVisible();
  const figures = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Figures (version 1)" }) });
  await expect(figures).toBeVisible();
  // Total offer, Medicare advance, net in hand and net total, as in the unit test.
  for (const cents of [7_503_000, 750_300, 3_002_700, 3_753_000]) await expect(figures).toContainText(money(cents));
  await expect(page.getByRole("heading", { name: "Settlement statement" })).toBeVisible();
});
