import { describe, expect, it } from "vitest";
import { auditDamages, computeDamages, parseFrequencyPerYear, parseHoursPerWeek, splitByFinancialYear, type DamagesInput } from "../../src/damages/engine.js";
import { fmtMoney, roundDiv, weeksInclusive } from "../../src/damages/money.js";
import { incomeTaxCents, multiplierFor, netWeekly, sgRateFor, taxTableFor } from "../../src/damages/tables.js";

const LIFE = { years: 41.98, citation: "ABS Life Tables, Western Australia, 2022 to 2024" };

/** Plaintiff aged exactly 42 at the calculation date: 25 years to age 67. */
const base = (over: Partial<DamagesInput> = {}): DamagesInput => ({
  plaintiff: { dateOfBirth: "1984-11-01", sex: "male", background: "manual work background" },
  injuryDate: "2024-10-29",
  calculationDate: "2026-11-01",
  preInjuryEarnings: { grossAnnualCents: 8_075_600 },
  generalDamagesCents: null,
  lifeExpectancy: LIFE,
  ...over,
});

const head = (m: ReturnType<typeof computeDamages>, id: string) => m.heads.find((h) => h.id === id)!;

describe("money", () => {
  it("rounds half away from zero exactly", () => {
    expect(roundDiv(5, 10)).toBe(1);
    expect(roundDiv(-5, 10)).toBe(-1);
    expect(roundDiv(112_012_550, 100)).toBe(1_120_126);
    expect(fmtMoney(16_439_957)).toBe("$164,399.57");
    expect(fmtMoney(-100)).toBe("-$1.00");
  });

  it("counts inclusive weeks", () => {
    expect(weeksInclusive("2024-07-01", "2025-06-30")).toBe(5214);
  });
});

describe("tables", () => {
  it("computes resident tax by year (net = gross less income tax only)", () => {
    // $1,553.00 x 52 = $80,756: 2024–25 tax $4,288 + 30% x $35,756 = $15,014.80
    expect(incomeTaxCents(8_075_600, taxTableFor(2024)!)).toBe(1_501_480);
    expect(netWeekly(155_300, 2024).netWeeklyCents).toBe(126_425);
    // 2023–24: $5,092 + 32.5% x $35,756 = $16,712.70; net $64,043.30 / 52
    expect(incomeTaxCents(8_075_600, taxTableFor(2023)!)).toBe(1_671_270);
    expect(netWeekly(155_300, 2023).netWeeklyCents).toBe(123_160);
    // 2026–27: first rate 15% ($4,020 at $45,000); 2027–28: 14% ($3,752)
    expect(incomeTaxCents(4_500_000, taxTableFor(2026)!)).toBe(402_000);
    expect(incomeTaxCents(4_500_000, taxTableFor(2027)!)).toBe(375_200);
    expect(netWeekly(155_300, 2026).verified).toBe(false);
    expect(netWeekly(155_300, 2024).verified).toBe(true);
  });

  it("selects SG by financial year", () => {
    expect(sgRateFor("2021-06-30").rateBps).toBe(950);
    expect(sgRateFor("2023-07-01").rateBps).toBe(1100);
    expect(sgRateFor("2025-06-30").rateBps).toBe(1150);
    expect(sgRateFor("2030-01-01").rateBps).toBe(1200);
  });

  it("looks up multipliers by rounding to the nearest whole year, never interpolating", () => {
    expect(multiplierFor(25).display).toBe("686.9");
    expect(multiplierFor(24.5).years).toBe(25);
    expect(multiplierFor(24.49).years).toBe(24);
    expect(multiplierFor(24.49).display).toBe("674.3");
    expect(multiplierFor(10.3).tenths).toBe(3955);
    expect(multiplierFor(0.5).display).toBe("50.7");
    expect(multiplierFor(50.4).display).toBe("846.9");
    expect(multiplierFor(41.98).citation).toBe("The 6% weekly multiplier for 42 years is 818.0");
    expect(() => multiplierFor(0.4)).toThrow();
    expect(() => multiplierFor(50.5)).toThrow();
  });
});

describe("computeDamages", () => {
  it("reproduces the firm's future superannuation example to the cent", () => {
    const m = computeDamages(base());
    expect(m.parameters.grossWeeklyCents).toBe(155_300);
    expect(m.parameters.earningsMultiplier?.years).toBe(25);
    const fs = head(m, "2.2");
    expect(fs.amountCents).toBe(10_337_124);
    expect(fs.lines).toContain("    $1,553.00 x 12% x 85% = $158.41 per week x 686.9 = $108,811.83 x 0.95 = $103,371.24");
    expect(fs.lines[0]).toContain("reduced by 15% (Jongen discount) to take into account fund management fees");
  });

  it("splits the unindemnified period by tax year and claims it net", () => {
    const m = computeDamages(base({ unindemnifiedPeriods: [{ from: "2024-05-01", to: "2024-08-31" }], injuryDate: "2024-04-30" }));
    const h = head(m, "1.1");
    expect(splitByFinancialYear({ from: "2024-05-01", to: "2024-08-31" })).toHaveLength(2);
    expect(h.lines).toContain("    8.71 weeks x $1,231.60 (net weekly wage 2023–24) = $10,727.24");
    expect(h.lines).toContain("    8.86 weeks x $1,264.25 (net weekly wage 2024–25) = $11,201.26");
    expect(h.amountCents).toBe(1_072_724 + 1_120_126);
    expect(h.tables[0]!.rows.map((r) => r[0])).toEqual(["2023–24", "2024–25"]);
  });

  it("puts weekly payments in past loss at gross and defaults the unindemnified period after them", () => {
    const m = computeDamages(base({ weeklyPayments: [{ from: "2024-10-29", to: "2025-06-30", grossPaidCents: 4_500_000, payer: "GIO" }] }));
    const h = head(m, "1.1");
    expect(h.lines.some((l) => l.includes("paid by GIO = $45,000.00"))).toBe(true);
    // 1/7/2025 to 1/11/2026, net at 2025–26 then 2026–27 rates
    expect(h.lines).toContain("    52.14 weeks x $1,264.25 (net weekly wage 2025–26) = $65,918.00");
    expect(h.lines).toContain("    17.71 weeks x $1,269.41 (net weekly wage 2026–27) = $22,481.25");
    expect(h.amountCents).toBe(4_500_000 + 6_591_800 + 2_248_125);
    expect(m.summary.refundable.weeklyPaymentsCents).toBe(4_500_000);
  });

  it("uses the current year's rates for future loss and flags the legislated cut", () => {
    const m = computeDamages(base());
    expect(m.parameters.netWeeklyCurrent.netWeeklyCents).toBe(126_941);
    expect(head(m, "1.2").lines.at(-1)).toBe("    $1,269.41 x 686.9 = $871,957.73 x 0.95 (5% contingencies) = $828,359.84");
    expect(m.flags.some((f) => f.code === "future_tax_change")).toBe(true);
  });

  it("charges interest only on the plaintiff's own losses, never on insurer-paid amounts", () => {
    const input = base({
        weeklyPayments: [{ from: "2024-10-29", to: "2025-06-30", grossPaidCents: 4_500_000, payer: "GIO" }],
        unindemnifiedPeriods: [],
        pastSuperFrom: "2026-12-01",
        specialDamages: [
          { from: "2025-01-10", providerPayer: "Dr A", item: "Consultation", amountCents: 20_000, paidBy: "insurer" },
          { from: "2025-08-10", providerPayer: "Psychologist", item: "Sessions", amountCents: 150_000, paidBy: "plaintiff" },
        ],
      });
    const m = computeDamages(input);
    expect(m.interest).toHaveLength(1);
    expect(m.interest[0]).toMatchObject({ head: "3", principalCents: 150_000 });
    expect(head(m, "5").lines[0]).toBe("(a) Special damages paid by the plaintiff: $1,500.00 x 3% x 1.23 years (from 10/8/2025) = $55.35");
    expect(head(m, "3").amountCents).toBe(170_000);
    expect(m.summary.refundable).toEqual({ weeklyPaymentsCents: 4_500_000, insurerPaidExpensesCents: 20_000, totalCents: 4_520_000 });
    expect(m.summary.netCents).toBe(m.summary.totalCents - 4_520_000);
    expect(auditDamages(m, input).filter((w) => w.code === "interest_on_insurer_paid")).toEqual([]);
  });

  it("costs future needs at annual / 52.14 x lifetime multiplier x 0.95", () => {
    const m = computeDamages(
      base({
        futureMedical: [{ service: "GP review", costCents: 9_000, frequencyPerYear: 4 }],
        futureCare: [{ hourlyRateCents: 5_000, hoursPerWeek: 3 }],
        aids: [{ item: "Shower chair", amountCents: 25_000 }],
        otherItems: [{ item: "Travel", amountCents: 10_000 }],
        generalDamagesCents: 9_000_000,
      }),
    );
    // $360.00 / 52.14 = $6.90; x 818.0 = $5,644.20; x 0.95 = $5,361.99
    expect(head(m, "6.1").amountCents).toBe(536_199);
    expect(head(m, "6.2").amountCents).toBe(11_656_500);
    expect(head(m, "6.3").amountCents).toBe(25_000);
    expect(head(m, "6.4").amountCents).toBe(10_000);
    expect(head(m, "7").amountCents).toBe(9_000_000);
    expect(m.summary.totalCents).toBe(m.heads.reduce((s, h) => s + h.amountCents, 0));
  });

  it("never invents general damages", () => {
    const m = computeDamages(base());
    expect(head(m, "7")).toMatchObject({ amountCents: 0, placeholder: true });
    expect(auditDamages(m, base()).some((w) => w.code === "general_damages_placeholder")).toBe(true);
  });

  it("rejects a Jongen discount outside 15–30%", () => {
    expect(() => computeDamages(base({ jongenPercent: 10 }))).toThrow(/Jongen/);
    expect(head(computeDamages(base({ jongenPercent: 20 })), "2.2").lines[1]).toContain("x 80% = $149.09 per week");
  });

  it("flags the WorkCover s 424 band with an unverified cap", () => {
    const m = computeDamages(base({ scheme: "workcover_wa", wpiPercent: 18 }));
    expect(m.flags.find((f) => f.code === "workcover_s424_cap")).toMatchObject({ verified: false });
    expect(computeDamages(base({ scheme: "workcover_wa", wpiPercent: 25 })).flags.some((f) => f.code === "workcover_s424_cap")).toBe(false);
    expect(computeDamages(base({ scheme: "icwa_mva", wpiPercent: 18 })).flags.some((f) => f.code === "workcover_s424_cap")).toBe(false);
  });
});

describe("auditDamages", () => {
  it("catches the firm's known errors", () => {
    const input = base({
      preInjuryEarnings: { grossAnnualCents: 8_075_600, grossWeeklyCents: 155_000 },
      unindemnifiedPeriods: [{ from: "2025-07-01", to: "2026-12-31" }],
      futureMedical: [{ service: "Psychiatrist", costCents: 40_000, frequencyPerYear: 4, frequency: "every 4 months" }],
      futureCare: [{ hourlyRateCents: 5_000, hoursPerWeek: 12, hoursDescription: "2 hours a day" }],
      multiplierYears: { earnings: 20 },
    });
    const m = computeDamages(input);
    const codes = auditDamages(m, input).map((w) => w.code);
    expect(codes).toContain("annual_divisor");
    expect(codes).toContain("period_beyond_calculation_date");
    expect(codes).toContain("frequency_mismatch");
    expect(codes).toContain("hours_mismatch");
    expect(codes).toContain("working_life_age");
  });

  it("detects a summary that no longer adds up, inconsistent contingencies and interest on insurer money", () => {
    const input = base({
      futureMedical: [{ service: "GP", costCents: 9_000, frequencyPerYear: 3, frequency: "every 4 months" }],
      specialDamages: [{ from: "2025-01-10", providerPayer: "GIO", item: "Physio", amountCents: 50_000, paidBy: "insurer" }],
    });
    const m = computeDamages(input);
    expect(auditDamages(m, input).filter((w) => w.code !== "general_damages_placeholder")).toEqual([]);
    const tampered = structuredClone(m);
    tampered.summary.totalCents += 100;
    tampered.heads.find((h) => h.id === "6.1")!.contingencyBps = 1000;
    tampered.interest.push({ head: "3", label: "Special damages", principalCents: 50_000, from: "2025-01-10", yearsHundredths: 100, amountCents: 1_500 });
    const codes = auditDamages(tampered, input).map((w) => w.code);
    expect(codes).toContain("summary_mismatch");
    expect(codes).toContain("contingency_inconsistent");
    expect(codes).toContain("interest_on_insurer_paid");
  });

  it("parses narrative frequencies and hours", () => {
    expect(parseFrequencyPerYear("every 4 months")).toBe(3);
    expect(parseFrequencyPerYear("fortnightly")).toBe(26);
    expect(parseFrequencyPerYear("twice a year")).toBe(2);
    expect(parseFrequencyPerYear("6 times per year")).toBe(6);
    expect(parseFrequencyPerYear("as needed")).toBeNull();
    expect(parseHoursPerWeek("2 hours a day")).toBe(14);
    expect(parseHoursPerWeek("12 hours per week")).toBe(12);
  });
});
