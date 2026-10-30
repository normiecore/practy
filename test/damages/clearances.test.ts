import { describe, expect, it } from "vitest";
import { applyClearanceEvent, centrelinkPreclusionEstimate, clearanceBlockers, newClearance, type Clearance } from "../../src/damages/clearances.js";

const mk = (kind: Clearance["kind"], id = kind) => newClearance({ id, tenantId: "t", matterId: "m", kind });

describe("clearance status machine", () => {
  it("runs Medicare from NOPB request to payment", () => {
    let c = mk("medicare");
    c = applyClearanceEvent(c, { type: "requested", date: "2026-03-01" });
    c = applyClearanceEvent(c, { type: "nopb_received", issueDate: "2026-03-20", pastBenefitsCents: 123_400 });
    expect(c.nopbExpiresOn).toBe("2026-09-20");
    c = applyClearanceEvent(c, { type: "mo022_lodged", date: "2026-10-05" });
    c = applyClearanceEvent(c, { type: "charge_received", date: "2026-10-20", amountCents: 98_000 });
    c = applyClearanceEvent(c, { type: "paid", date: "2026-10-22" });
    expect(c).toMatchObject({ status: "paid", paidCents: 98_000 });
    expect(c.history).toHaveLength(5);
  });

  it("rejects illegal transitions", () => {
    expect(() => applyClearanceEvent(mk("medicare"), { type: "paid", date: "2026-01-01" })).toThrow();
    expect(() => applyClearanceEvent(mk("centrelink"), { type: "nopb_received", issueDate: "2026-01-01" })).toThrow(/does not apply/);
    const na = applyClearanceEvent(mk("dva"), { type: "not_applicable", reason: "Not a veteran" });
    expect(() => applyClearanceEvent(na, { type: "requested", date: "2026-01-01" })).toThrow();
  });
});

describe("clearanceBlockers", () => {
  it("blocks release until every clearance is paid or not applicable", () => {
    const settlement = "2026-10-01";
    let medicare = applyClearanceEvent(mk("medicare"), { type: "nopb_received", issueDate: "2026-03-20" });
    const centrelink = applyClearanceEvent(applyClearanceEvent(mk("centrelink"), { type: "requested", date: "2026-09-01" }), {
      type: "charge_received",
      date: "2026-09-20",
      amountCents: 150_000,
    });
    let check = clearanceBlockers([medicare, centrelink], settlement, { asAt: "2026-10-10" });
    expect(check.blocked).toBe(true);
    expect(check.mo022DueOn).toBe("2026-10-29");
    expect(check.blockers.map((b) => b.kind)).toEqual(["medicare", "centrelink"]);
    expect(check.warnings.map((w) => w.reason).join(" ")).toMatch(/expired on 20\/9\/2026.*MO022 due/);

    expect(clearanceBlockers([medicare], settlement, { asAt: "2026-11-01" }).blockers.some((b) => /MO022 overdue/.test(b.reason))).toBe(true);
    expect(clearanceBlockers([medicare], settlement).blockers.some((b) => b.clearanceId === null && b.kind === "centrelink")).toBe(true);

    medicare = applyClearanceEvent(medicare, { type: "mo022_lodged", date: "2026-10-05" });
    medicare = applyClearanceEvent(medicare, { type: "charge_received", date: "2026-10-20", amountCents: 1_000 });
    medicare = applyClearanceEvent(medicare, { type: "paid", date: "2026-10-21" });
    const paidCl = applyClearanceEvent(centrelink, { type: "paid", date: "2026-10-21" });
    check = clearanceBlockers([medicare, paidCl], settlement, { asAt: "2026-10-22" });
    expect(check).toMatchObject({ blocked: false, blockers: [], warnings: [] });
  });
});

describe("centrelinkPreclusionEstimate", () => {
  const base = { incomeCutOutWeeklyCents: 120_000, incomeCutOutSource: "Services Australia guide (test figure)", incomeCutOutDate: "2026-10-01", injuryDate: "2024-10-29" };

  it("uses 50% of an agreed lump sum over the weekly cut-out, from the injury date", () => {
    const e = centrelinkPreclusionEstimate({ ...base, lumpSumCents: 10_000_000, settlementType: "agreed" });
    // $50,000 / $1,200 = 41.67 -> 41 whole weeks
    expect(e).toMatchObject({ estimate: true, verified: false, compensationPartCents: 5_000_000, weeks: 41, from: "2024-10-29", to: "2025-08-11" });
    expect(e.formula).toBe("50% x $100,000.00 = $50,000.00 / $1,200.00 (income cut-out per week) = 41 whole weeks from 29/10/2024 to 11/8/2025");
    expect(e.label).toMatch(/ESTIMATE/);
  });

  it("needs the economic-loss portion for a judgment", () => {
    expect(centrelinkPreclusionEstimate({ ...base, lumpSumCents: 10_000_000, settlementType: "judgment" }).weeks).toBeNull();
    expect(centrelinkPreclusionEstimate({ ...base, lumpSumCents: 10_000_000, settlementType: "judgment", economicLossCents: 2_400_000 }).weeks).toBe(20);
  });
});
