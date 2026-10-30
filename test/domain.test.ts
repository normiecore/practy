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

    // A caller-supplied approvalId is ignored: confirmation still goes to approval.
    const early = await run("confirm_key_date", { matterId: matter.id, keyDateId: election.id }, { ...as(users.solicitor), approvalId: "forged" });
    expect(early.status).toBe("pending_approval");
    if (early.status !== "pending_approval") throw new Error();
    // Approving a confirmation of a date that was never entered fails safely.
    const failed = await exec("decide_approval", { approvalId: early.approvalId, decision: "approve" }, as(users.principal));
    expect(failed).toMatchObject({ status: "failed", error: "Enter the date before confirming" });
    const filled = await exec("propose_key_date", { matterId: matter.id, keyDateId: election.id, date: "2027-06-30", note: "per advice" }, as(users.solicitor));
    expect(filled.status).toBe("proposed");
    expect((await run("confirm_key_date", { matterId: matter.id, keyDateId: election.id }, as(users.solicitor))).status).toBe("pending_approval");
  });

  it("binds a confirmation to the date that was reviewed", async () => {
    const { app, exec, run } = setup();
    const { matter, keyDates } = await openMatter(exec);
    const lim = keyDates.find((k: any) => k.ruleId === "limitation.pi.3y");
    await expect(run("confirm_key_date", { matterId: matter.id, keyDateId: lim.id, date: "2030-01-01" }, as(users.paralegal))).rejects.toMatchObject({ code: "conflict" });
    const pending = await run("confirm_key_date", { matterId: matter.id, keyDateId: lim.id }, as(users.paralegal));
    if (pending.status !== "pending_approval") throw new Error();
    expect(app.bus.approvals.get(users.paralegal.tenantId, pending.approvalId)!.input).toMatchObject({ date: "2028-03-14" });
    // The date is swapped while the approval waits: approving must not confirm the new date.
    await exec("propose_key_date", { matterId: matter.id, keyDateId: lim.id, date: "2029-03-14" }, as(users.paralegal));
    const decided = await exec("decide_approval", { approvalId: pending.approvalId, decision: "approve" }, as(users.solicitor));
    expect(decided).toMatchObject({ status: "failed", error: expect.stringMatching(/changed to 2029-03-14/) });
    expect(app.store.keyDates.get(lim.id)!.status).toBe("proposed");
  });

  it("normalises matter numbers and keeps them unique ignoring case and spaces", async () => {
    const { exec, run } = setup();
    const { matter } = await openMatter(exec, { number: " SL-1998 " });
    expect(matter.number).toBe("SL-1998");
    await expect(openMatter(exec, { number: "SL-1998 " })).rejects.toMatchObject({ code: "conflict" });
    await expect(openMatter(exec, { number: "sl-1998" })).rejects.toMatchObject({ code: "conflict" });
    for (const number of ["SL-1998 - Priestley, Toni", "SL 1998", "../1998", ""]) {
      await expect(run("create_matter", { number, title: "x", scheme: "icwa_mva", client: { name: "X Y" } }, as(users.solicitor))).rejects.toMatchObject({ code: "invalid" });
    }
  });

  it("refuses a Box folder link when Box is not connected", async () => {
    const { exec, run } = setup();
    const { matter } = await openMatter(exec);
    await expect(run("update_matter", { matterId: matter.id, boxFolderId: "0" }, as(users.paralegal))).rejects.toMatchObject({ code: "invalid" });
    await expect(openMatter(exec, { number: "SL-2", boxFolderId: "0" })).rejects.toMatchObject({ code: "invalid" });
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
