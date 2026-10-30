import { describe, expect, it } from "vitest";
import { AuditLog } from "../src/core/audit.js";
import { addMonths, addWorkingDays, addYears, WA_CALENDAR, workingDaysBetween } from "../src/core/calendar.js";
import { as, openMatter, setup, users } from "./helpers.js";

describe("calendar", () => {
  it("clamps 29 Feb anniversaries and flags them", () => {
    expect(addYears("2024-02-29", 3)).toEqual({ date: "2027-02-28", clamped: true });
    expect(addMonths("2026-08-31", 6)).toEqual({ date: "2027-02-28", clamped: true });
    expect(addMonths("2026-03-14", -6)).toEqual({ date: "2025-09-14", clamped: false });
  });

  it("counts WA working days around Christmas substitute holidays", () => {
    // 2026: 25 Dec (Fri) and Boxing Day substitute 28 Dec (Mon) are holidays.
    expect(addWorkingDays(WA_CALENDAR, "2026-12-24", 1)).toBe("2026-12-29");
    expect(workingDaysBetween(WA_CALENDAR, "2026-12-24", "2026-12-31")).toBe(3);
  });
});

describe("audit log", () => {
  it("detects tampering anywhere in the chain", () => {
    const log = new AuditLog();
    const base = { tenantId: "t", userId: "u", surface: "ui" as const, command: "x", outcome: "executed" as const, inputHash: "h", matterIds: [] };
    log.append(base);
    log.append({ ...base, command: "y" });
    log.append({ ...base, command: "z" });
    const entries = log.list({ tenantId: "t" });
    expect(log.verify()).toBeNull();
    const tampered = entries.map((e, i) => (i === 1 ? { ...e, command: "edited" } : e));
    expect(log.verify(tampered)).toBe(2);
  });
});

describe("command bus policy", () => {
  it("rejects invalid input with a readable message", async () => {
    const { run } = setup();
    await expect(run("create_matter", { number: "X" }, as(users.solicitor))).rejects.toMatchObject({ code: "invalid" });
  });

  it("enforces roles and tenant isolation", async () => {
    const { run, exec } = setup();
    const { matter } = await openMatter(exec);
    await expect(run("sync_trust_records", {}, as(users.solicitor))).rejects.toMatchObject({ code: "forbidden" });
    await expect(run("get_matter", { matterId: matter.id }, as(users.outsider))).rejects.toMatchObject({ code: "not_found" });
  });

  it("hides walled matters but still reports them in conflict searches", async () => {
    const { app, run, exec } = setup();
    const { matter } = await openMatter(exec);
    app.store.matters.get(matter.id)!.restrictedTo = [users.principal.userId];
    await expect(run("get_matter", { matterId: matter.id }, as(users.solicitor))).rejects.toMatchObject({ code: "not_found" });
    const hits = await exec<any[]>("conflict_search", { names: ["Tony Priestly"] }, as(users.solicitor));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ matter: null, partyName: "[restricted]", role: "client" });
    const visible = await exec<any[]>("conflict_search", { names: ["Priestley, Toni"] }, as(users.principal));
    expect(visible[0].matter.number).toBe("SL-1998");
  });

  it("routes tier 2 to a practitioner approval and executes on approval", async () => {
    const { app, run, exec } = setup();
    const { keyDates, matter } = await openMatter(exec);
    const limitation = keyDates.find((k: any) => k.ruleId === "limitation.pi.3y");
    const pending = await run("confirm_key_date", { matterId: matter.id, keyDateId: limitation.id }, as(users.paralegal, "mcp"));
    expect(pending.status).toBe("pending_approval");
    expect(app.store.keyDates.get(limitation.id)!.status).toBe("proposed");

    if (pending.status !== "pending_approval") throw new Error();
    // Paralegal cannot approve; approvals cannot be decided over the API surface.
    await expect(run("decide_approval", { approvalId: pending.approvalId, decision: "approve" }, as(users.paralegal))).rejects.toMatchObject({ code: "forbidden" });
    await expect(run("decide_approval", { approvalId: pending.approvalId, decision: "approve" }, as(users.solicitor, "api"))).rejects.toMatchObject({ code: "forbidden" });

    const decided = await exec("decide_approval", { approvalId: pending.approvalId, decision: "approve" }, as(users.solicitor));
    expect(decided.status).toBe("executed");
    expect(app.store.keyDates.get(limitation.id)).toMatchObject({ status: "confirmed", confirmedBy: users.solicitor.userId });
  });

  it("records every invocation, including denials, in the audit log", async () => {
    const { app, run, exec } = setup();
    const { matter } = await openMatter(exec);
    await exec("get_matter", { matterId: matter.id }, as(users.solicitor, "mcp"));
    await run("get_matter", { matterId: matter.id }, as(users.outsider, "mcp")).catch(() => {});
    const ai = app.bus.audit.list({ tenantId: users.solicitor.tenantId, matterId: matter.id, aiOnly: true });
    expect(ai.map((e) => [e.command, e.outcome])).toEqual([["get_matter", "executed"]]);
    expect(app.bus.audit.list({ tenantId: "t-other" })[0]?.outcome).toBe("denied");
    expect(app.bus.audit.verify()).toBeNull();
  });
});
