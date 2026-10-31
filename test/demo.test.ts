import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { usersOf } from "../src/admin/commands.js";
import { actorFor } from "../src/auth/service.js";
import type { Approval } from "../src/core/approvals.js";
import { WriteQueue, type Persistence } from "../src/core/persistence.js";
import type { InvocationContext } from "../src/core/types.js";
import type { TimeEntry } from "../src/costs/time.js";
import type { MatterDocument } from "../src/documents/model.js";
import { Store } from "../src/domain/store.js";
import { createApp } from "../src/server/app.js";
import { DEMO_FIRM_NAME, DEMO_STAFF, demoRefusal, seedDemo, startDemo, type DemoServer, damagesDate } from "../src/server/demo.js";

const dirs: string[] = [];
const servers: DemoServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

/** A fresh app whose local document store writes to a temporary folder. */
function freshApp(opts: { store?: Store } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "practy-demo-test-"));
  dirs.push(dir);
  return createApp({ localDocumentsRoot: dir, ...opts });
}

const today = () => new Date().toISOString().slice(0, 10);

describe("demo sample data", () => {
  it("seeds a realistic firm through the command bus, with Today showing overdue and upcoming dates", async () => {
    const app = freshApp();
    const summary = await seedDemo(app, { env: {} });
    const principal = usersOf(app.store).list("default").find((u) => u.email === DEMO_STAFF.principal.email)!;
    const ctx: InvocationContext = { actor: actorFor(principal), surface: "ui" };
    const exec = async <T = any>(name: string, input: unknown): Promise<T> => {
      const out = await app.bus.execute(name, input, ctx);
      expect(out.status).toBe("executed");
      return (out as { result: T }).result;
    };

    expect(summary).toMatchObject({ tenantId: "default", firmName: DEMO_FIRM_NAME, signInEmail: "principal@example.com", pendingApprovals: 2 });
    expect((await exec("get_settings", {})).firmName).toBe(DEMO_FIRM_NAME);

    // Staff: a principal plus a solicitor and a paralegal added through the approval inbox.
    const staff = await exec<{ email: string; roles: string[] }[]>("list_users", {});
    expect(staff.map((u) => [u.email, u.roles])).toEqual(
      expect.arrayContaining([
        ["principal@example.com", ["principal", "trust_authoriser"]],
        ["solicitor@example.com", ["solicitor"]],
        ["paralegal@example.com", ["paralegal"]],
      ]),
    );
    expect(staff).toHaveLength(3);

    // Matters across both pilot schemes, each with a client and another party.
    const matters = await exec<{ id: string; number: string; scheme: string }[]>("search_matters", {});
    expect(matters).toHaveLength(5);
    expect(matters.filter((m) => m.scheme === "icwa_mva")).toHaveLength(3);
    expect(matters.filter((m) => m.scheme === "workcover_wa")).toHaveLength(2);
    expect(summary.matters.map((m) => m.number).sort()).toEqual(matters.map((m) => m.number).sort());
    for (const m of matters) {
      const detail = await exec("get_matter", { matterId: m.id });
      expect(detail.parties.map((p: { role: string }) => p.role)).toContain("client");
      expect(detail.parties.length).toBeGreaterThan(1);
    }
    expect(matters.filter((m) => app.store.matters.get(m.id)!.references?.length)).toHaveLength(4);

    // Key dates: some confirmed through approvals, some still proposed, one still to be entered.
    const dates = app.store.keyDatesFor("default");
    const statuses = (s: string) => dates.filter((k) => k.status === s).length;
    expect(statuses("confirmed")).toBe(14);
    expect(statuses("proposed")).toBe(15);
    expect(statuses("manual_required")).toBe(1);
    for (const k of dates.filter((k) => k.status === "confirmed")) expect(k.confirmedBy).toBeTruthy();

    // Every matter has file notes and tasks; evidence requests carry chase dates.
    const count = (kind: string) => app.store.collection(kind).list("default").length;
    for (const m of matters) {
      expect((await exec<unknown[]>("list_file_notes", { matterId: m.id })).length, `${m.number} file notes`).toBeGreaterThan(0);
      expect((await exec<unknown[]>("list_tasks", { matterId: m.id })).length, `${m.number} tasks`).toBeGreaterThan(0);
    }
    expect(count("file_note")).toBe(7);
    const requests = await exec<{ chaseOn: string[]; status: string; overdue: boolean }[]>("list_evidence_requests", { outstandingOnly: false });
    expect(requests).toHaveLength(7);
    expect(requests.every((r) => r.chaseOn.length === 2)).toBe(true);
    expect(requests.filter((r) => r.status === "received")).toHaveLength(1);
    expect(requests.some((r) => r.overdue)).toBe(true);
    // Seven tasks set by staff, plus two chase-ups for each evidence request.
    expect(count("task")).toBe(7 + 2 * 7);

    // Documents: small valid PDFs named by the firm's convention.
    const docs = matters.flatMap((m) => app.store.collection<MatterDocument>("document").list("default", (d) => d.matterId === m.id));
    expect(docs).toHaveLength(6);
    for (const d of docs) {
      expect(d.name).toMatch(/^\d{4}\.\d{2}\.\d{2} .+\.pdf$/);
      expect(d.contentType).toBe("application/pdf");
      expect((await exec<{ issues: unknown[] }>("check_document_name", { name: d.name.replace(/\.pdf$/, "") })).issues).toEqual([]);
      const bytes = await app.hub.requireDocuments("default").download((await exec("get_document", { matterId: d.matterId, documentId: d.id })).storeFileId);
      expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    }

    // One matter has a damages model and an Authority to Settle.
    const settling = summary.matters.find((m) => m.number === "DEMO-1002")!;
    const damages = await exec("get_damages", { matterId: settling.id });
    expect(damages.current.model.summary.totalCents).toBeGreaterThan(0);
    const authority = await exec("get_authority_to_settle", { matterId: settling.id });
    expect(authority.current.result.totalOfferCents).toBe(8_250_000 + 2_420_000 + 386_000 + 186_000);
    expect(count("damages_model")).toBe(1);
    expect(count("authority_draft")).toBe(1);

    // Time entries, some approved through the inbox and some still proposed.
    const time = app.store.collection<TimeEntry>("time_entry").list("default");
    expect(time.filter((e) => e.status === "approved")).toHaveLength(3);
    expect(time.filter((e) => e.status === "proposed")).toHaveLength(5);

    // Two requests wait in the inbox, from the paralegal; the rest were decided by a practitioner.
    const paralegal = usersOf(app.store).list("default").find((u) => u.email === DEMO_STAFF.paralegal.email)!;
    const pending = await exec<Approval[]>("list_approvals", { status: "pending" });
    expect(pending.map((a) => a.command).sort()).toEqual(["approve_time_entries", "confirm_key_date"]);
    expect(pending.every((a) => a.requestedBy === paralegal.id)).toBe(true);
    // Decided: two staff, the firm settings, 14 key dates and one batch of time.
    const executed = await exec<Approval[]>("list_approvals", { status: "executed" });
    expect(executed).toHaveLength(2 + 1 + 14 + 1);
    expect(executed.every((a) => a.decisions.length === 1 && a.decisions[0]!.decision === "approve")).toBe(true);

    // Today has something in every section.
    const digest = await exec("daily_digest", { days: 14 });
    expect(digest.overdue.length).toBeGreaterThan(0);
    expect(digest.overdue.every((k: { date: string }) => k.date < today())).toBe(true);
    expect(digest.upcoming.length).toBeGreaterThan(0);
    expect(digest.upcoming.every((k: { date: string }) => k.date >= today())).toBe(true);
    expect(digest.needsAttention.length).toBeGreaterThan(0);
    expect(digest.approvalsPending).toBe(2);
    expect(digest.tasksDue.length).toBe(4);

    // Everything after the first principal went through the bus, so it is in the audit log.
    const audited = app.bus.audit.list({ tenantId: "default" });
    expect(audited.filter((e) => e.command === "create_matter" && e.outcome === "executed")).toHaveLength(5);
    expect(audited.filter((e) => e.command === "upload_document" && e.outcome === "executed")).toHaveLength(6);
    expect(audited.every((e) => e.outcome !== "failed" && e.outcome !== "denied")).toBe(true);
  });

  it("leaves requests in the inbox that a practitioner can approve", async () => {
    const app = freshApp();
    await seedDemo(app, { env: {} });
    const principal = usersOf(app.store).list("default").find((u) => u.email === DEMO_STAFF.principal.email)!;
    const ctx: InvocationContext = { actor: actorFor(principal), surface: "ui" };
    for (const a of app.bus.approvals.list("default", "pending")) {
      const out = await app.bus.execute("decide_approval", { approvalId: a.id, decision: "approve" }, ctx);
      expect(out.status === "executed" && (out.result as Approval).status, a.command).toBe("executed");
    }
    const election = app.store.keyDatesFor("default").find((k) => k.ruleId === "workcover.common_law_election" && k.date);
    expect(election).toMatchObject({ status: "confirmed", confirmedBy: principal.id });
    expect(app.store.collection<TimeEntry>("time_entry").list("default").filter((e) => e.status === "approved")).toHaveLength(6);
  });

  it("refuses production, a database URL, a durable store and a firm that already has data", async () => {
    expect(demoRefusal({})).toBeUndefined();
    expect(demoRefusal({ DATABASE_URL: "" })).toBeUndefined();
    expect(demoRefusal({ NODE_ENV: "production" })).toMatch(/production/);
    expect(demoRefusal({ DATABASE_URL: "postgres://practy@db/practy" })).toMatch(/DATABASE_URL/);

    const app = freshApp();
    await expect(seedDemo(app, { env: { NODE_ENV: "production" } })).rejects.toThrow(/production/);
    await expect(seedDemo(app, { env: { DATABASE_URL: "postgres://practy@db/practy" } })).rejects.toThrow(/DATABASE_URL/);
    await expect(startDemo({ NODE_ENV: "production", PORT: "0" })).rejects.toThrow(/production/);
    await expect(startDemo({ DATABASE_URL: "postgres://practy@db/practy", PORT: "0" })).rejects.toThrow(/DATABASE_URL/);
    // Nothing was written by the refused attempts.
    expect(usersOf(app.store).list("default")).toHaveLength(0);
    expect(app.store.mattersFor("default")).toHaveLength(0);

    // Any store that writes through to durable storage (as Postgres does) is refused.
    const database: Persistence = { loadAll: async () => new Map(), loadAudit: async () => [], put: async () => {}, appendAudit: async () => {}, close: async () => {} };
    const durable = freshApp({ store: new Store(new WriteQueue(database)) });
    await expect(seedDemo(durable, { env: {} })).rejects.toThrow(/in-memory/);
    expect(usersOf(durable.store).list("default")).toHaveLength(0);

    await seedDemo(app, { env: {} });
    await expect(seedDemo(app, { env: {} })).rejects.toThrow(/already has/);
  });

  it("keeps the damages date within the years Practy has tax rates for", () => {
    expect(damagesDate("2026-11-01")).toBe("2026-11-01");
    const last = damagesDate("2099-01-01");
    expect(last < "2099-01-01").toBe(true);
    expect(last).toMatch(/^\d{4}-06-30$/);
  });

  it("serves the sample firm with the development sign-in only", async () => {
    // Reserve a free port, since the server's sign-in URLs are absolute.
    const probe = createServer().listen(0);
    await new Promise((r) => probe.once("listening", r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((r) => probe.close(r));
    const base = `http://127.0.0.1:${port}`;

    const demo = await startDemo({ PORT: String(port), PRACTY_BASE_URL: base, PRACTY_WEB_DIR: join(tmpdir(), "practy-demo-no-web") });
    servers.push(demo);
    expect(demo.signInUrl).toBe(`${base}/auth/login/dev`);
    // Signed in as the sample principal by anyone who can reach it, so only this computer by default.
    expect((demo.server.address() as AddressInfo).address).toBe("127.0.0.1");
    expect(demo.webBuilt).toBe(false);
    expect(await (await fetch(`${base}/auth/providers`)).json()).toEqual([{ id: "dev", label: "Development login" }]);

    const get = (url: string, cookie?: string) => fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });
    const login = await get(demo.signInUrl);
    const state = new URL(login.headers.get("location")!, base).searchParams.get("state")!;
    const callback = await get(`${base}/auth/callback/dev?state=${state}&code=${encodeURIComponent(demo.summary.signInEmail)}`);
    expect(callback.status).toBe(302);
    const cookie = callback.headers.get("set-cookie")!.split(";")[0]!;
    const session = await (await get(`${base}/api/session`, cookie)).json();
    expect(session).toMatchObject({ firmName: DEMO_FIRM_NAME, user: { email: "principal@example.com", roles: ["principal", "trust_authoriser"] } });
  });
});
