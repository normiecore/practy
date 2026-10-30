import { describe, expect, it } from "vitest";
import type { StoredDamages } from "../../src/damages/commands.js";
import { as, TENANT, users } from "../helpers.js";
import { pilotBus } from "./pilot-bus.js";

const DAMAGES = {
  plaintiff: { sex: "female", background: "clerical work background" },
  calculationDate: "2026-11-01",
  preInjuryEarnings: { grossWeeklyCents: 155_300, source: "2024–25 income statement" },
  specialDamages: [{ from: "2025-04-01", providerPayer: "ICWA", item: "Physiotherapy", amountCents: 80_000, paidBy: "insurer" }],
  futureMedical: [{ service: "GP", costCents: 9_000, frequencyPerYear: 4, frequency: "every 4 months" }],
  generalDamagesCents: null,
  lifeExpectancy: { years: 45.1, citation: "ABS Life Tables, Western Australia, 2022 to 2024" },
};

describe("damages commands", () => {
  it("saves versioned drafts using the matter's injury date and client date of birth", async () => {
    const { exec, matter, store } = await pilotBus();
    const v1 = await exec<StoredDamages>("compute_damages", { matterId: matter.id, ...DAMAGES }, as(users.solicitor));
    expect(v1).toMatchObject({ version: 1, status: "draft", input: { injuryDate: "2025-03-14", scheme: "icwa_mva", plaintiff: { dateOfBirth: "1990-05-01", name: "Toni Priestley" } } });
    expect(v1.audit.map((w) => w.code)).toContain("frequency_mismatch");
    expect(v1.model.summary.refundable.insurerPaidExpensesCents).toBe(80_000);

    await exec("compute_damages", { matterId: matter.id, ...DAMAGES, generalDamagesCents: 8_000_000 }, as(users.solicitor));
    const got = await exec("get_damages", { matterId: matter.id }, as(users.paralegal));
    expect(got.current.version).toBe(2);
    expect(got.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect((await exec("get_damages", { matterId: matter.id, version: 1 }, as(users.paralegal))).current.id).toBe(v1.id);
    expect(store.collection("damages_model").list(TENANT)).toHaveLength(2);
  });

  it("reports engine problems as invalid input and hides other firms' matters", async () => {
    const { bus, matter } = await pilotBus();
    await expect(bus.execute("compute_damages", { matterId: matter.id, ...DAMAGES, jongenPercent: 10 }, as(users.solicitor))).rejects.toMatchObject({ code: "invalid" });
    await expect(bus.execute("get_damages", { matterId: matter.id }, as(users.outsider))).rejects.toMatchObject({ code: "not_found" });
  });

  it("drafts the Authority to Settle with a settlement statement from recorded clearances", async () => {
    const { exec, matter } = await pilotBus();
    const hu = {
      matterId: matter.id,
      settlementOfferCents: 3_343_055,
      legalCostsCents: 3_750_000,
      disbursementsCents: 253_000,
      medicalAccountsCents: 156_945,
      medicalAccountsPaidByClient: true,
      clientPaidDisbursements: true,
    };
    const a1 = await exec("compute_authority_to_settle", hu, as(users.solicitor));
    expect(a1.result).toMatchObject({ totalOfferCents: 7_503_000, medicareAdvanceCents: 750_300, netInHandCents: 3_002_700, netTotalCents: 3_753_000 });
    expect(a1.input).toMatchObject({ clientName: "Toni Priestley", injuryDate: "14/3/2025" });
    expect(a1.statement.lines[0].kind).toBe("medicare_advance_held");

    await exec("record_clearance", { matterId: matter.id, kind: "medicare", event: { type: "nopb_received", issueDate: "2026-09-01" } }, as(users.paralegal));
    await exec("record_clearance", { matterId: matter.id, kind: "medicare", event: { type: "charge_received", date: "2026-10-20", amountCents: 120_000 } }, as(users.paralegal));
    const a2 = await exec("compute_authority_to_settle", { ...hu, centrelink: "nil" }, as(users.solicitor));
    expect(a2.version).toBe(2);
    expect(a2.statement.lines[0]).toMatchObject({ kind: "medicare", amountCents: 120_000 });
    expect(a2.statement.clientBalanceCents).toBe(7_503_000 - 120_000 - 3_750_000);
  });

  it("tracks clearances and what blocks release", async () => {
    const { exec, bus, matter } = await pilotBus();
    const c = await exec("record_clearance", { matterId: matter.id, kind: "medicare", event: { type: "requested", date: "2026-08-01" } }, as(users.paralegal));
    const c2 = await exec("record_clearance", { matterId: matter.id, clearanceId: c.id, event: { type: "nopb_received", issueDate: "2026-08-20" } }, as(users.paralegal));
    expect(c2).toMatchObject({ id: c.id, status: "nopb_received", nopbExpiresOn: "2027-02-20" });
    await expect(
      bus.execute("record_clearance", { matterId: matter.id, clearanceId: c.id, event: { type: "paid", date: "2026-10-01" } }, as(users.paralegal)),
    ).rejects.toMatchObject({ code: "conflict" });

    const listed = await exec("list_clearances", { matterId: matter.id, settlementDate: "2026-10-15", asAt: "2026-10-20" }, as(users.paralegal));
    expect(listed.clearances).toHaveLength(1);
    expect(listed.release.blocked).toBe(true);
    expect(listed.release.mo022DueOn).toBe("2026-11-12");
    expect(listed.release.blockers.map((b: { kind: string }) => b.kind)).toEqual(["centrelink", "medicare"]);
  });

  it("estimates the Centrelink preclusion period from the matter's injury date", async () => {
    const { exec, matter } = await pilotBus();
    const e = await exec(
      "estimate_centrelink_preclusion",
      { matterId: matter.id, lumpSumCents: 10_000_000, settlementType: "agreed", incomeCutOutWeeklyCents: 120_000, incomeCutOutSource: "test figure", incomeCutOutDate: "2026-10-01" },
      as(users.solicitor, "mcp"),
    );
    expect(e).toMatchObject({ estimate: true, weeks: 41, from: "2025-03-14" });
  });
});
