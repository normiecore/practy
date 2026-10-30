import { describe, expect, it } from "vitest";
import { coolingOffEnd, disclosureRequirement, estimateExceeded, validateCostsTerms } from "../../src/costs/disclosure.js";
import { DETERMINATIONS, determinationFor, itemFor, rateFor } from "../../src/costs/scales.js";
import { estimateDraftingUnits, estimateEmailUnits, estimatePerusalUnits, timesheetSummary, type TimeEntry } from "../../src/costs/time.js";

describe("scales", () => {
  it("switches to the 2026 Determination on 21/9/2026, not 1 July", () => {
    expect(rateFor("SP", "2026-07-01").rateCents).toBe(57_200);
    expect(rateFor("SP", "2026-09-20")).toMatchObject({ rateCents: 57_200, determinationId: "lcc-2024", verified: true });
    expect(rateFor("SP", "2026-09-21")).toMatchObject({ rateCents: 66_000, determinationId: "lcc-2026", verified: false });
    expect(rateFor("JP", "2026-09-21").rateCents).toBe(48_400);
    expect(rateFor("CPL", "2026-09-21").rateCents).toBe(30_800);
    expect(rateFor("counsel", "2026-09-21").rateCents).toBe(66_000);
  });

  it("selects each Determination by the date of the work", () => {
    expect(rateFor("SP", "2021-03-01").rateCents).toBe(49_500);
    expect(rateFor("counsel", "2023-03-01").rateCents).toBe(47_300);
    expect(rateFor("CPL", "2025-03-01").rateCents).toBe(26_400);
    expect(() => rateFor("SP", "2020-06-30")).toThrow();
  });

  it("uses the WorkCover forum rates by period", () => {
    expect(rateFor("SP", "2021-01-01", "workcover").rateCents).toBe(41_800);
    expect(rateFor("JP", "2023-01-01", "workcover").rateCents).toBe(34_100);
    expect(rateFor("CPL", "2026-09-20", "workcover").rateCents).toBe(18_700);
    expect(rateFor("SP", "2026-09-21", "workcover").rateCents).toBe(56_100);
    expect(() => rateFor("counsel", "2026-10-01", "workcover")).toThrow();
  });

  it("keeps date ranges contiguous and items unverified", () => {
    for (const forum of ["court", "workcover"] as const) {
      const ds = DETERMINATIONS.filter((d) => d.forum === forum);
      for (let i = 1; i < ds.length; i++) expect(ds[i - 1]!.to! < ds[i]!.from).toBe(true);
    }
    expect(itemFor("lcc-2026", "statement_of_claim")?.max).toEqual({ kind: "hours", hours: 20, category: "SP" });
    expect(itemFor("lcc-2020", "preparation")?.max).toMatchObject({ hours: 120 });
    expect(itemFor("lcc-2026", "conferences")?.item).toBe("28");
    expect(itemFor("lcc-2024", "other_work")?.item).toBe("35");
    expect(DETERMINATIONS.flatMap((d) => d.items).every((i) => i.verified === false)).toBe(true);
    expect(determinationFor("2026-10-01")?.id).toBe("lcc-2026");
  });
});

describe("unit heuristics", () => {
  it("estimates emails at 120 words sent and 350 received per unit, minimum 1", () => {
    expect(estimateEmailUnits({ direction: "sent", words: 10 }).units).toBe(1);
    expect(estimateEmailUnits({ direction: "sent", words: 121 }).units).toBe(2);
    expect(estimateEmailUnits({ direction: "received", words: 700 }).units).toBe(2);
    expect(estimateEmailUnits({ direction: "received", words: 701 }).units).toBe(3);
    expect(estimateEmailUnits({ direction: "sent", words: 50, internal: true }).claimable).toBe(false);
  });

  it("estimates perusal and drafting", () => {
    expect(estimatePerusalUnits({ pages: 10, density: "dense" }).units).toBe(20);
    expect(estimatePerusalUnits({ pages: 3, density: "light" }).units).toBe(2);
    expect(estimatePerusalUnits({ pages: 100, density: "clinical", unitsPerPage: 0.75 }).units).toBe(75);
    expect(estimatePerusalUnits({ pages: 4, density: "certificate" })).toMatchObject({ units: 2, suggestedCategory: "CPL" });
    expect(estimateDraftingUnits({ kind: "dense", pages: 3, settlingUnits: 2 }).units).toBe(14);
    expect(estimateDraftingUnits({ kind: "form", complex: true }).units).toBe(2);
  });
});

describe("timesheetSummary", () => {
  const entry = (over: Partial<TimeEntry>): TimeEntry => ({
    id: Math.random().toString(36).slice(2),
    tenantId: "t",
    matterId: "m",
    feeEarnerId: "u-sp",
    feeEarnerName: "Senior",
    category: "SP",
    forum: "court",
    date: "2026-09-01",
    units: 10,
    description: "Work",
    claimable: true,
    status: "approved",
    aiAssisted: false,
    proposedBy: "u",
    proposedAt: "2026-09-01T00:00:00Z",
    ...over,
  });

  it("prices each entry at the rate in force on its work date and separates non-claimable rows", () => {
    const s = timesheetSummary([
      entry({ date: "2026-09-20", units: 10, scaleItem: "writ" }),
      entry({ date: "2026-09-21", units: 5, scaleItem: "writ" }),
      entry({ units: 3, claimable: false, description: "Internal email" }),
    ]);
    expect(s.rows.map((r) => r.amountCents)).toEqual([57_200, 33_000]);
    expect(s.nonClaimable).toHaveLength(1);
    expect(s.totals.nonClaimableValueCents).toBe(17_160);
    expect(s.byFeeEarner).toEqual([{ feeEarner: "Senior", category: "SP", units: 15, hours: 1.5, valueCents: 90_200 }]);
    expect(s.unverifiedRates).toEqual(["Legal Profession (Supreme and District Courts) (Contentious Business) Determination 2026"]);
  });

  it("caps an item by SP-equivalent hours across Determinations", () => {
    // 1.5 SP hours over two Determinations, plus 1 JP hour: writ cap is 1.5 SP hours.
    const s = timesheetSummary([
      entry({ date: "2026-09-20", units: 10, scaleItem: "writ" }),
      entry({ date: "2026-09-21", units: 5, scaleItem: "writ" }),
      entry({ date: "2026-09-21", units: 10, category: "JP", feeEarnerId: "u-jp", feeEarnerName: "Junior", scaleItem: "writ" }),
    ]);
    const writ = s.byItem.find((i) => i.scaleItem === "writ")!;
    expect(writ.valueCents).toBe(57_200 + 33_000 + 48_400);
    expect(writ.capEquivalentHours).toBeCloseTo(1 + 0.5 + 48_400 / 66_000, 2);
    expect(writ.capHours).toBe(1.5);
    expect(writ.claimCents).toBeLessThan(writ.valueCents);
    expect(s.totals.capReductionCents).toBe(writ.reductionCents);
    expect(s.totals.claimCents + s.totals.capReductionCents).toBe(s.totals.claimableValueCents);
  });

  it("separates solicitor/client-only work", () => {
    const s = timesheetSummary([entry({ scaleItem: "other_work", units: 2 }), entry({ units: 1, partyParty: false })]);
    expect(s.totals.partyPartyExcludedCents).toBe(11_440 + 5_720);
    expect(s.byItem.find((i) => i.scaleItem === "other_work")!.notes.join(" ")).toMatch(/solicitor\/client only/);
  });
});

describe("costs disclosure", () => {
  it("branches at $750 and $3,000", () => {
    expect(disclosureRequirement(74_999).level).toBe("none");
    expect(disclosureRequirement(75_000).level).toBe("standard_form");
    expect(disclosureRequirement(299_999).level).toBe("standard_form");
    expect(disclosureRequirement(300_000).level).toBe("full_s174");
  });

  it("rejects uplift over 25% and any contingency fee", () => {
    expect(validateCostsTerms({ basis: "conditional", upliftPercent: 25 }).valid).toBe(true);
    expect(validateCostsTerms({ basis: "conditional", upliftPercent: 25.5 }).errors.map((e) => e.code)).toEqual(["uplift_cap"]);
    expect(validateCostsTerms({ basis: "hourly", upliftPercent: 10 }).errors.map((e) => e.code)).toEqual(["uplift_not_conditional"]);
    expect(validateCostsTerms({ basis: "percentage_of_recovery" }).errors.map((e) => e.code)).toEqual(["contingency_fee"]);
    expect(validateCostsTerms({ basis: "conditional", percentageOfRecovery: 20 }).valid).toBe(false);
  });

  it("monitors the estimate", () => {
    expect(estimateExceeded({ wipCents: 700_000, disbursementsCents: 100_000, estimateCents: 1_000_000 })).toMatchObject({ approaching: true, exceeded: false, usedPercent: 80 });
    expect(estimateExceeded({ wipCents: 700_000, disbursementsCents: 100_000, estimateCents: 1_000_000, thresholdPct: 90 }).approaching).toBe(false);
    expect(estimateExceeded({ wipCents: 1_000_000, disbursementsCents: 1, estimateCents: 1_000_000 }).exceeded).toBe(true);
  });

  it("counts 5 clear business days for cooling-off, skipping WA holidays", () => {
    // Friday 25/9/2026; Monday 28/9/2026 is the King's Birthday holiday in WA.
    expect(coolingOffEnd("2026-09-25")).toMatchObject({ endsOn: "2026-10-05", verified: false });
  });
});
