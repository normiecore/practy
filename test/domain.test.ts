import { describe, expect, it } from "vitest";
import { CONFLICT_THRESHOLD, nameSimilarity } from "../src/domain/conflicts.js";
import { as, openMatter, setup, users } from "./helpers.js";

describe("conflict matching", () => {
  it("matches spelling variants, order and company suffixes but not different people", () => {
    expect(nameSimilarity("Toni Priestley", "Priestley, Tony")).toBeGreaterThan(0.9);
    expect(nameSimilarity("ACME Transport Pty Ltd", "Acme Transport")).toBe(1);
    expect(nameSimilarity("John Smith", "Jane Doe")).toBeLessThan(CONFLICT_THRESHOLD);
    // Recall over precision: near-misses are surfaced for a human to clear.
    expect(nameSimilarity("John Smith", "John Smithers")).toBeGreaterThanOrEqual(CONFLICT_THRESHOLD);
  });
});

describe("WA PI rule pack", () => {
  it("proposes ICWA limitation, reminders and notice dates, all unconfirmed", async () => {
    const { exec } = setup();
    const { keyDates, conflicts } = await openMatter(exec);
    expect(conflicts).toEqual([]);
    const byRule = Object.fromEntries(keyDates.map((k: any) => [k.ruleId, k]));
    expect(byRule["limitation.pi.3y"]).toMatchObject({ date: "2028-03-14", kind: "critical", status: "proposed", ruleVerified: true });
    expect(byRule["limitation.pi.3y.reminder.6m"].date).toBe("2027-09-14");
    expect(byRule["icwa.notice"].kind).toBe("deadline");
    expect(keyDates.every((k: any) => k.status === "proposed" && k.rulePackVersion)).toBe(true);
  });

  it("flags minors instead of computing an extended limitation date", async () => {
    const { exec } = setup();
    const { keyDates } = await openMatter(exec, { client: { name: "Young Client", dateOfBirth: "2010-01-01" } });
    const lim = keyDates.find((k: any) => k.ruleId === "limitation.pi.3y");
    expect(lim.date).toBe("2028-03-14");
    expect(lim.notes.join(" ")).toMatch(/under 18/);
  });

  it("never computes unverified WorkCover dates; requires manual entry then confirmation", async () => {
    const { exec, run } = setup();
    const { matter, keyDates } = await openMatter(exec, { number: "SL-2001", scheme: "workcover_wa", otherParties: [{ name: "Builder Co Pty Ltd", role: "employer", kind: "organisation" }] });
    const election = keyDates.find((k: any) => k.ruleId === "workcover.common_law_election");
    expect(election).toMatchObject({ date: null, status: "manual_required", ruleVerified: false });
    expect(keyDates.find((k: any) => k.ruleId === "limitation.pi.3y").ruleVerified).toBe(false);
    expect(keyDates.some((k: any) => k.ruleId === "icwa.notice")).toBe(false);

    // A date that was never entered is refused before it reaches the approvals inbox,
    // and a caller-supplied approvalId does not skip that check.
    await expect(
      run("confirm_key_date", { matterId: matter.id, keyDateId: election.id }, { ...as(users.solicitor), approvalId: "forged" }),
    ).rejects.toMatchObject({ code: "conflict", message: "Enter the date before confirming" });
    expect(await exec("list_approvals", { status: "pending" }, as(users.principal))).toEqual([]);
    const filled = await exec("propose_key_date", { matterId: matter.id, keyDateId: election.id, date: "2027-06-30", note: "per advice" }, as(users.solicitor));
    expect(filled.status).toBe("proposed");
    expect((await run("confirm_key_date", { matterId: matter.id, keyDateId: election.id }, as(users.solicitor))).status).toBe("pending_approval");
  });

  it("refuses to request confirmation of a key date that does not exist on the matter", async () => {
    const { exec, run } = setup();
    const { matter, keyDates } = await openMatter(exec);
    const other = await openMatter(exec, { number: "SL-2003", client: { name: "Other Client" } });
    await expect(run("confirm_key_date", { matterId: matter.id, keyDateId: "missing" }, as(users.solicitor))).rejects.toMatchObject({ code: "not_found" });
    await expect(run("confirm_key_date", { matterId: matter.id, keyDateId: other.keyDates[0].id }, as(users.solicitor))).rejects.toMatchObject({ code: "not_found" });
    expect(await exec("list_approvals", { status: "pending" }, as(users.principal))).toEqual([]);
    expect((await run("confirm_key_date", { matterId: matter.id, keyDateId: keyDates[0].id }, as(users.solicitor))).status).toBe("pending_approval");
  });

  it("derives Medicare deadlines from matter events", async () => {
    const { exec } = setup();
    const { matter } = await openMatter(exec);
    const [nopb] = await exec("record_matter_event", { matterId: matter.id, event: { type: "nopb_received", issueDate: "2026-10-20" } }, as(users.paralegal));
    expect(nopb).toMatchObject({ ruleId: "medicare.nopb.expiry", date: "2027-04-20" });
    const [mo022] = await exec("record_matter_event", { matterId: matter.id, event: { type: "settlement", date: "2027-02-01" } }, as(users.paralegal));
    expect(mo022).toMatchObject({ ruleId: "medicare.mo022", date: "2027-03-01", kind: "critical" });
  });

  it("rejects duplicate matter numbers and reports conflicts on intake", async () => {
    const { exec, run } = setup();
    await openMatter(exec);
    await expect(openMatter(exec)).rejects.toMatchObject({ code: "conflict" });
    const second = await exec("create_matter", {
      number: "SL-2002", title: "New enquiry", scheme: "icwa_mva", injuryDate: "2026-01-01",
      client: { name: "Sam Driver" }, otherParties: [{ name: "Toni Priestly", role: "driver" }],
    }, as(users.solicitor));
    expect(second.conflicts[0]).toMatchObject({ partyName: "Toni Priestley", role: "client" });
    expect((await run("search_matters", { query: "priestley" }, as(users.solicitor))).status).toBe("executed");
  });
});
