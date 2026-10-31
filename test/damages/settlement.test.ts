import { describe, expect, it } from "vitest";
import { computeAuthority, computeSettlementStatement, type AuthorityInput } from "../../src/damages/settlement.js";

/** Worked example from the firm's field mapping (SRC Act). */
const HU: AuthorityInput = {
  clientName: "Han Hu",
  injuryDate: "29/10/2024",
  settlementOfferCents: 3_343_055,
  legalCostsCents: 3_750_000,
  disbursementsCents: 253_000,
  medicalAccountsCents: 156_945,
  medicareContributionCents: 0,
  medicalAccountsPaidByClient: true,
  clientPaidDisbursements: true,
  otherTerms: "resignation from employment with Ramsay Health Care.",
  feesLabel: "Soul Legal fees",
};

describe("computeAuthority (port of fill_authority.py)", () => {
  it("reproduces Hu v Ramsay", () => {
    const r = computeAuthority(HU);
    expect(r.totalOfferCents).toBe(7_503_000);
    expect(r.medicareAdvanceCents).toBe(750_300);
    expect(r.firmFeesCents).toBe(3_750_000);
    expect(r.netInHandCents).toBe(3_002_700);
    expect(r.netTotalCents).toBe(3_753_000);
    expect(r.disbursementsBlank).toBe("Nil");
    expect(r.cells).toEqual([
      { label: "settlement offer", display: "$33,430.55" },
      { label: "contribution towards legal costs", display: "$37,500.00" },
      { label: "contribution towards disbursements", display: "$2,530.00" },
      { label: "contribution towards medical accounts", display: "$1,569.45" },
      { label: "contribution towards Medicare Australia", display: "Nil" },
      { label: "TOTAL OFFER", display: "$75,030.00" },
      { label: "workers compensation refund", display: "Nil" },
      { label: "medical/other accounts", display: "by me" },
      { label: "Medicare Australia [10%", display: "E$7,503.00" },
      { label: "Tax (if applicable)", display: "Nil" },
      { label: "Centrelink refund", display: "E$ – to be ascertained" },
      { label: "Legal Aid Refund", display: "N/A" },
      { label: "barrister", display: "Nil" },
      { label: "other debts", display: "Nil" },
      { label: "outstanding disbursements to be paid", display: "Nil" },
      { label: "Soul Legal fees", display: "E$37,500.00" },
      { label: "estimated net in hand", display: "E$30,027.00" },
      { label: "plus Medicare/other benefits", display: "E$7,503.00" },
      { label: "plus residual balance held in trust", display: "Nil" },
      { label: "total", display: "E$37,530.00" },
    ]);
  });

  it("deducts medical accounts and firm disbursements when the flags are off", () => {
    const r = computeAuthority({ ...HU, medicalAccountsPaidByClient: false, clientPaidDisbursements: false });
    expect(r.firmFeesCents).toBe(4_003_000);
    expect(r.disbursementsBlank).toBe("2,530.00");
    expect(r.netInHandCents).toBe(7_503_000 - 750_300 - 4_003_000 - 156_945);
    expect(r.cells.find((c) => c.label === "medical/other accounts")!.display).toBe("E$1,569.45");
  });

  it("handles Centrelink as text or a number, and Legal Aid null as N/A", () => {
    const cl = (centrelink: AuthorityInput["centrelink"]) => computeAuthority({ ...HU, centrelink }).cells.find((c) => c.label === "Centrelink refund")!.display;
    expect(cl("nil")).toBe("Nil");
    expect(cl(" ")).toBe("Nil");
    expect(cl("awaiting clearance")).toBe("E$ – awaiting clearance");
    expect(cl(0)).toBe("Nil");
    expect(cl(123_456)).toBe("E$1,234.56");
    expect(computeAuthority({ ...HU, centrelink: 123_456 }).netInHandCents).toBe(3_002_700 - 123_456);
    expect(computeAuthority({ ...HU, legalAidRefundCents: 0 }).cells.find((c) => c.label === "Legal Aid Refund")!.display).toBe("Nil");
    expect(computeAuthority({ ...HU, legalAidRefundCents: 50_000 }).netInHandCents).toBe(3_002_700 - 50_000);
  });

  it("shows a zero settlement offer as $0.00, not Nil", () => {
    expect(computeAuthority({ settlementOfferCents: 0, legalCostsCents: 100_000 }).cells[0]!.display).toBe("$0.00");
  });
});

describe("computeSettlementStatement", () => {
  it("holds the 10% advance until the notice of charge, and balances to the receipt", () => {
    const s = computeSettlementStatement({ authority: { ...HU, centrelink: "nil" } });
    expect(s.balanced).toBe(true);
    expect(s.lines.map((l) => [l.kind, l.amountCents])).toEqual([
      ["medicare_advance_held", 750_300],
      ["costs", 3_750_000],
      ["client", 3_002_700],
    ]);
    expect(s.varianceFromAuthorityCents).toBe(0);
    expect(s.issues[0]).toMatch(/notice of charge/);
  });

  it("replaces the advance with the actual charges and pays every clearance", () => {
    const s = computeSettlementStatement({
      authority: { ...HU, medicalAccountsPaidByClient: false, clientPaidDisbursements: false },
      medicareChargeCents: 210_000,
      centrelinkChargeCents: 150_000,
      ndisRecoveryCents: 40_000,
      otherRecoveries: [{ payee: "HBF", description: "Private health fund recovery", amountCents: 10_000 }],
      funder: { payee: "Disbursement funder", description: "Funded report payout", amountCents: 253_000 },
      disbursements: [],
    });
    const sum = s.lines.reduce((t, l) => t + l.amountCents, 0);
    expect(sum).toBe(7_503_000);
    expect(s.balanced).toBe(true);
    expect(s.issues).toEqual([]);
    expect(s.clientBalanceCents).toBe(7_503_000 - 210_000 - 150_000 - 40_000 - 10_000 - 156_945 - 253_000 - 3_750_000);
    expect(s.lines.at(-1)).toMatchObject({ kind: "client", basis: "actual" });
  });

  it("refuses to distribute from a shortfall", () => {
    const s = computeSettlementStatement({ authority: { ...HU, centrelink: "nil" }, medicareChargeCents: 0, costsCents: 8_000_000 });
    expect(s.balanced).toBe(false);
    expect(s.lines.some((l) => l.kind === "client")).toBe(false);
    expect(s.issues.join(" ")).toMatch(/debit/);
  });
});
