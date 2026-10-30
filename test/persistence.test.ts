import pg from "pg";
import { describe, expect, it } from "vitest";
import { PostgresPersistence } from "../src/core/persistence.js";
import { openApp } from "../src/server/app.js";
import { as, users } from "./helpers.js";

/** Runs against a real Postgres when TEST_DATABASE_URL is set (CI provides one). */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Postgres persistence", () => {
  it("restores matters, key dates, approvals and the audit chain after a restart, and keeps the audit log append-only", async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query("drop table if exists records, audit_log cascade");
    await admin.end();

    const p1 = new PostgresPersistence(url!);
    await p1.migrate();
    const app1 = await openApp(p1);
    const created = await app1.bus.execute(
      "create_matter",
      { number: "1998", title: "Priestley v ICWA", scheme: "icwa_mva", injuryDate: "2025-03-14", client: { name: "Toni Priestley" } },
      as(users.solicitor),
    );
    if (created.status !== "executed") throw new Error();
    const { matter, keyDates } = created.result as any;
    const pending = await app1.bus.execute("confirm_key_date", { matterId: matter.id, keyDateId: keyDates[0].id }, as(users.solicitor, "mcp"));
    await p1.close();

    const p2 = new PostgresPersistence(url!);
    const app2 = await openApp(p2);
    expect(app2.store.matterByNumber(users.solicitor.tenantId, "1998")?.title).toBe("Priestley v ICWA");
    expect(app2.store.keyDatesFor(users.solicitor.tenantId, matter.id)).toHaveLength(keyDates.length);
    if (pending.status !== "pending_approval") throw new Error();
    const decided = await app2.bus.execute("decide_approval", { approvalId: pending.approvalId, decision: "approve" }, as(users.principal));
    expect((decided as any).result.status).toBe("executed");
    expect(app2.bus.audit.verify()).toBeNull();
    expect(app2.bus.audit.list({ tenantId: users.solicitor.tenantId }).length).toBeGreaterThanOrEqual(4);

    const raw = new pg.Client({ connectionString: url });
    await raw.connect();
    await expect(raw.query("delete from audit_log")).rejects.toThrow(/append-only/);
    await raw.end();
    await p2.close();
  });
});
