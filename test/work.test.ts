import { describe, expect, it } from "vitest";
import { as, openMatter, setup, users } from "./helpers.js";

describe("tasks, file notes and evidence requests", () => {
  it("creates chase-up tasks for requests and closes them on receipt", async () => {
    const { exec } = setup();
    const { matter } = await openMatter(exec);
    const req = await exec("log_evidence_request", { matterId: matter.id, kind: "medical_records", provider: "Fiona Stanley Hospital", description: "ED and inpatient records", requestedOn: "2026-10-01" }, as(users.paralegal));
    expect(req.chaseOn).toEqual(["2026-10-15", "2026-10-29"]);
    const mine = await exec<any[]>("list_tasks", {}, as(users.paralegal));
    expect(mine.map((t) => [t.dueOn, t.overdue])).toEqual([["2026-10-15", true], ["2026-10-29", true]]);
    expect((await exec<any[]>("list_evidence_requests", { matterId: matter.id }, as(users.solicitor)))[0].overdue).toBe(true);
    await exec("mark_evidence_received", { matterId: matter.id, requestId: req.id, invoiceCents: 22_000 }, as(users.paralegal));
    expect(await exec<any[]>("list_tasks", {}, as(users.paralegal))).toHaveLength(0);
    const digest = await exec("daily_digest", {}, as(users.paralegal));
    expect(digest.tasksDue).toHaveLength(0);
  });

  it("records file notes and keeps walled matters' tasks hidden", async () => {
    const { exec, app } = setup();
    const { matter } = await openMatter(exec);
    await exec("add_file_note", { matterId: matter.id, kind: "phone", text: "Client called re physio", minutes: 6 }, as(users.solicitor));
    expect(await exec<any[]>("list_file_notes", { matterId: matter.id }, as(users.solicitor))).toHaveLength(1);
    const t = await exec("create_task", { matterId: matter.id, title: "Request police report", assigneeId: users.paralegal.userId }, as(users.solicitor));
    app.store.matters.get(matter.id)!.restrictedTo = [users.solicitor.userId];
    expect(await exec<any[]>("list_tasks", {}, as(users.paralegal))).toHaveLength(0);
    await expect(exec("update_task", { taskId: t.id, status: "done" }, as(users.paralegal))).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps walled and no-AI matters' tasks out of the daily digest", async () => {
    const { exec, app } = setup();
    const { matter: walled } = await openMatter(exec);
    const { matter: noAi } = await openMatter(exec, { number: "SL-2001", title: "Citizen v Insurer", client: { name: "John Citizen" }, aiPermitted: false });
    await exec("create_task", { matterId: walled.id, title: "Walled task", assigneeId: users.paralegal.userId, dueOn: "2026-10-01" }, as(users.solicitor));
    await exec("create_task", { matterId: noAi.id, title: "No-AI task", assigneeId: users.paralegal.userId, dueOn: "2026-10-01" }, as(users.solicitor));
    await exec("create_task", { title: "Firm task", assigneeId: users.paralegal.userId, dueOn: "2026-10-01" }, as(users.solicitor));
    app.store.matters.get(walled.id)!.restrictedTo = [users.solicitor.userId];
    const titles = async (surface: "ui" | "mcp") => (await exec("daily_digest", {}, as(users.paralegal, surface))).tasksDue.map((t: any) => t.title).sort();
    expect(await titles("ui")).toEqual(["Firm task", "No-AI task"]);
    expect(await titles("mcp")).toEqual(["Firm task"]);
  });
});
