import { describe, expect, it } from "vitest";
import type { TimeEntry } from "../../src/costs/time.js";
import { pilotBus } from "../damages/pilot-bus.js";
import { as, users } from "../helpers.js";

describe("costs commands", () => {
  it("proposes time from heuristics, flags AI-assisted entries and approves them through the inbox", async () => {
    const { exec, bus, matter } = await pilotBus();
    const proposed = await exec<TimeEntry[]>(
      "propose_time_entry",
      {
        matterId: matter.id,
        entries: [
          { category: "SP", date: "2026-09-18", unitsFrom: { kind: "email", direction: "sent", words: 250 }, description: "Email to insurer", sourceRef: "gmail:abc", scaleItem: "preparation" },
          { category: "SP", date: "2026-09-22", unitsFrom: { kind: "perusal", pages: 6, density: "dense" }, description: "Peruse medical report", scaleItem: "preparation" },
          { category: "CPL", date: "2026-09-22", unitsFrom: { kind: "email", direction: "sent", words: 40, internal: true }, description: "Internal email" },
        ],
      },
      as(users.solicitor, "mcp"),
    );
    expect(proposed.map((e) => [e.units, e.claimable, e.aiAssisted, e.status])).toEqual([
      [3, true, true, "proposed"],
      [12, true, true, "proposed"],
      [1, false, true, "proposed"],
    ]);

    await expect(
      bus.execute("propose_time_entry", { matterId: matter.id, entries: [{ category: "SP", date: "2026-09-22", units: 1, description: "x", scaleItem: "nope" }] }, as(users.solicitor)),
    ).rejects.toMatchObject({ code: "invalid" });

    const pending = await bus.execute("approve_time_entries", { matterId: matter.id, entryIds: proposed.map((e) => e.id) }, as(users.solicitor, "mcp"));
    expect(pending.status).toBe("pending_approval");
    const approvalId = pending.status === "pending_approval" ? pending.approvalId : "";
    const decided = await exec("decide_approval", { approvalId, decision: "approve" }, as(users.principal));
    expect(decided.status).toBe("executed");
    expect((await exec<TimeEntry[]>("list_time_entries", { matterId: matter.id, status: "approved" }, as(users.paralegal))).map((e) => e.approvedBy)).toEqual([
      users.principal.userId,
      users.principal.userId,
      users.principal.userId,
    ]);

    const sheet = await exec("timesheet_summary", { matterId: matter.id, status: "approved" }, as(users.paralegal));
    // 3 units at the 2024 SP rate ($572) and 12 units at the 2026 SP rate ($660)
    expect(sheet.rows.map((r: { amountCents: number }) => r.amountCents)).toEqual([17_160, 79_200]);
    expect(sheet.nonClaimable).toHaveLength(1);
    expect(sheet.totals.claimableValueCents).toBe(96_360);

    const check = await exec(
      "check_costs_disclosure",
      { matterId: matter.id, estimateCents: 100_000, terms: { basis: "conditional", upliftPercent: 30 }, agreementDate: "2026-09-25" },
      as(users.solicitor),
    );
    expect(check.requirement.level).toBe("standard_form");
    expect(check.terms.errors.map((e: { code: string }) => e.code)).toEqual(["uplift_cap"]);
    expect(check.estimate).toMatchObject({ usedCents: 96_360, approaching: true, exceeded: false });
    expect(check.coolingOff.endsOn).toBe("2026-10-05");
  });

  it("hides time entries on other firms' matters", async () => {
    const { bus, matter } = await pilotBus();
    await expect(bus.execute("list_time_entries", { matterId: matter.id }, as(users.outsider))).rejects.toMatchObject({ code: "not_found" });
  });
});
