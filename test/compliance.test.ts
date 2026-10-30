import { describe, expect, it } from "vitest";
import { as, openMatter, setup, TENANT, users } from "./helpers.js";

describe("compliance registers", () => {
  it("tracks privacy requests and breach clocks", async () => {
    const { exec, run } = setup();
    const req = await exec("log_privacy_request", { kind: "access", requesterName: "Toni Priestley", details: "Copy of my file", receivedOn: "2026-09-01" }, as(users.paralegal));
    expect(req.dueBy).toBe("2026-10-01");
    expect((await exec<any[]>("list_privacy_requests", {}, as(users.paralegal)))[0].overdue).toBe(true);

    const breach = await exec("report_breach", { discoveredAt: "2026-10-20T02:00:00.000Z", description: "Email sent to wrong recipient", dataKinds: ["health"] }, as(users.solicitor));
    expect(breach.assessmentDue).toBe("2026-11-19");
    await expect(exec("record_breach_notification", { breachId: breach.id, oaicNotifiedAt: "2026-10-21T00:00:00.000Z" }, as(users.solicitor))).rejects.toMatchObject({ code: "conflict" });
    const pending = await run("assess_breach", { breachId: breach.id, eligible: true, reasoning: "Health information to unknown recipient" }, as(users.solicitor));
    if (pending.status !== "pending_approval") throw new Error();
    await exec("decide_approval", { approvalId: pending.approvalId, decision: "approve" }, as(users.principal));
    await exec("record_breach_notification", { breachId: breach.id, oaicNotifiedAt: "2026-10-21T00:00:00.000Z" }, as(users.solicitor));
    const ransom = await exec("record_ransomware_payment", { breachId: breach.id, paidAt: "2026-10-22T00:00:00.000Z" }, as(users.principal));
    expect(ransom.ransomware.reportDueAt).toBe("2026-10-25T00:00:00.000Z");
  });

  it("generates the ADM privacy-policy clause from the register", async () => {
    const { exec } = setup();
    const reg = await exec<any[]>("list_adm_register", {}, as(users.solicitor));
    expect(reg.length).toBeGreaterThanOrEqual(3);
    const { text } = await exec("privacy_policy_adm_clause", {}, as(users.solicitor));
    expect(text).toMatch(/Key-date rule pack/);
    expect(text).toMatch(/lawyer remains responsible/);
  });

  it("screens matters for AML designated services", async () => {
    const { exec } = setup();
    const { matter } = await openMatter(exec);
    const no = Object.fromEntries(["real_estate", "body_corporate", "trust_arrangement", "business_sale", "managing_client_money", "investments", "nominee"].map((k) => [k, false]));
    expect((await exec("aml_screen_matter", { matterId: matter.id, answers: no }, as(users.solicitor))).designatedService).toBe(false);
    expect((await exec("aml_status", {}, as(users.solicitor))).unscreened).toHaveLength(0);
    expect((await exec("aml_screen_matter", { matterId: matter.id, answers: { ...no, trust_arrangement: true } }, as(users.solicitor))).designatedService).toBe(true);
    expect((await exec("aml_status", {}, as(users.solicitor))).designated).toHaveLength(1);
  });

  it("computes retention dates with the minor rule and respects legal holds", async () => {
    const { exec, run } = setup();
    const { matter } = await openMatter(exec, { client: { name: "Young Person", dateOfBirth: "2015-06-01" } });
    await exec("update_matter", { matterId: matter.id, status: "closed" }, as(users.solicitor));
    const [row] = await exec<any[]>("retention_report", {}, as(users.principal));
    expect(row.destroyNotBefore).toBe("2040-06-01");
    const hold = await run("set_legal_hold", { matterId: matter.id, on: true, reason: "Anticipated proceedings" }, as(users.solicitor));
    if (hold.status !== "pending_approval") throw new Error();
    await exec("decide_approval", { approvalId: hold.approvalId, decision: "approve" }, as(users.principal));
    expect((await exec<any[]>("retention_report", {}, as(users.principal)))[0].legalHold).toBe(true);
  });

  it("exports the AI-use log for a matter", async () => {
    const { exec } = setup();
    const { matter } = await openMatter(exec);
    await exec("get_matter", { matterId: matter.id }, as(users.solicitor, "mcp"));
    const log = await exec("export_ai_use_log", { matterId: matter.id }, as(users.solicitor));
    expect(log.toolCalls.map((c: any) => [c.surface, c.command])).toEqual([["mcp", "get_matter"]]);
    expect(TENANT).toBe("t-soul");
  });
  it("keeps walled and no-AI matters out of the compliance lists", async () => {
    const { app, exec, run } = setup();
    const { matter: walled } = await openMatter(exec);
    const { matter: noAi } = await openMatter(exec, { number: "SL-2001", title: "Citizen v Insurer", client: { name: "John Citizen" }, aiPermitted: false });
    await exec("log_privacy_request", { kind: "access", requesterName: "Toni Priestley", matterId: walled.id, details: "Copy of my file", receivedOn: "2026-09-01" }, as(users.solicitor));
    await exec("log_privacy_request", { kind: "access", requesterName: "John Citizen", matterId: noAi.id, details: "Copy of my file", receivedOn: "2026-09-01" }, as(users.solicitor));
    app.store.matters.get(walled.id)!.restrictedTo = [users.solicitor.userId];

    const aml = await exec("aml_status", {}, as(users.paralegal));
    expect(aml.unscreened.map((m: any) => m.number)).toEqual(["SL-2001"]);
    expect(aml.openMatters).toBe(1);
    expect((await exec("aml_status", {}, as(users.solicitor, "mcp"))).unscreened.map((m: any) => m.number)).toEqual(["SL-1998"]);
    expect((await exec("aml_status", {}, as(users.solicitor))).unscreened).toHaveLength(2);

    expect((await exec<any[]>("list_privacy_requests", {}, as(users.paralegal))).map((r) => r.requesterName)).toEqual(["John Citizen"]);
    expect((await exec<any[]>("list_privacy_requests", {}, as(users.solicitor, "agent"))).map((r) => r.requesterName)).toEqual(["Toni Priestley"]);
    await expect(run("log_privacy_request", { kind: "other", requesterName: "X", matterId: walled.id, details: "x", receivedOn: "2026-09-01" }, as(users.paralegal))).rejects.toMatchObject({ code: "not_found" });
    const walledRequest = app.store.collection<{ id: string; tenantId: string; matterId?: string }>("privacy_request").list(TENANT, (r) => r.matterId === walled.id)[0]!;
    await expect(run("close_privacy_request", { requestId: walledRequest.id, status: "responded", outcome: "x" }, as(users.paralegal))).rejects.toMatchObject({ code: "not_found" });

    await exec("update_matter", { matterId: walled.id, status: "closed" }, as(users.solicitor));
    expect(await exec<any[]>("retention_report", {}, as(users.principal))).toHaveLength(0);
  });

  it("does not let upsert_adm_entry overwrite another tenant's entry", async () => {
    const { app, exec, run } = setup();
    const adm = app.store.collection<any>("adm_entry");
    adm.set({ id: "foreign", tenantId: users.outsider.tenantId, system: "Theirs", decisions: "d", personalInformation: "p", humanReview: "h", active: true, updatedAt: "2026-01-01T00:00:00.000Z" });
    const entry = { id: "foreign", system: "Hijacked", decisions: "d", personalInformation: "p", humanReview: "h" };
    await expect(run("upsert_adm_entry", entry, as(users.solicitor))).rejects.toMatchObject({ code: "not_found" });
    expect(adm.get("foreign")).toMatchObject({ tenantId: users.outsider.tenantId, system: "Theirs" });

    const own = await run("upsert_adm_entry", { ...entry, id: undefined, system: "Ours" }, as(users.solicitor));
    if (own.status !== "pending_approval") throw new Error();
    const done = await exec("decide_approval", { approvalId: own.approvalId, decision: "approve" }, as(users.principal));
    expect(done.status).toBe("executed");
    expect((await exec<any[]>("list_adm_register", {}, as(users.solicitor))).map((e) => e.system)).toContain("Ours");
  });
});
