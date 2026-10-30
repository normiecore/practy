import { describe, expect, it } from "vitest";
import type { CalendarEvent, CalendarSink } from "../src/connectors/types.js";
import { IntegrationHub } from "../src/integrations/hub.js";
import { beginConnect, connectionSecretName, exchangeCode } from "../src/integrations/oauth.js";
import { createApp } from "../src/server/app.js";
import { as, TENANT, users } from "./helpers.js";

class FakeCalendar implements CalendarSink {
  readonly kind = "google" as const;
  readonly events = new Map<string, CalendarEvent>();
  async upsert(e: CalendarEvent) {
    this.events.set(e.practyId, e);
    return `ev-${e.practyId}`;
  }
  async remove(id: string) {
    this.events.delete(id);
  }
}

const CSV = `Matter Number,Client,Matter Type,Status,Date of Injury,Insurer
1998,Toni Priestley,Motor Vehicle Accident,Open,14/03/2025,Insurance Commission of WA
2001,John Citizen,WorkCover,Open,,
1500,Old Client,Public Liability,Closed,01/02/2019,
`;
const columns = { number: "Matter Number", clientName: "Client", matterType: "Matter Type", status: "Status", injuryDate: "Date of Injury", otherParties: [{ column: "Insurer", role: "insurer" }] };

describe("matter import", () => {
  it("previews, imports with schemes and rule-pack dates, and skips existing numbers", async () => {
    const app = createApp();
    const preview = await app.bus.execute("import_matters_csv", { csv: CSV, columns }, as(users.principal));
    expect((preview as any).result).toMatchObject({ total: 3, created: 3, dryRun: true });
    expect(app.store.mattersFor(TENANT)).toHaveLength(0);

    const run = (await app.bus.execute("import_matters_csv", { csv: CSV, columns, dryRun: false }, as(users.principal))) as any;
    expect(run.result.created).toBe(3);
    const byNo = (n: string) => app.store.matterByNumber(TENANT, n)!;
    expect([byNo("1998").scheme, byNo("2001").scheme, byNo("1500").scheme]).toEqual(["icwa_mva", "workcover_wa", "other"]);
    expect(byNo("1500").status).toBe("closed");
    const wcLimitation = app.store.keyDatesFor(TENANT, byNo("2001").id).find((k) => k.ruleId === "limitation.pi.3y")!;
    expect(wcLimitation).toMatchObject({ date: null, status: "manual_required" });

    const again = (await app.bus.execute("import_matters_csv", { csv: CSV, columns, dryRun: false }, as(users.principal))) as any;
    expect(again.result).toMatchObject({ created: 0 });
    expect(again.result.skipped).toHaveLength(3);
  });

  it("trims imported matter numbers and skips ones that cannot name a folder", async () => {
    const app = createApp();
    const csv = `Matter Number,Client\n 1998 ,Toni Priestley\n1998 - Priestley,Someone Else\n2001,John Citizen\n`;
    const run = (await app.bus.execute("import_matters_csv", { csv, columns: { number: "Matter Number", clientName: "Client" }, dryRun: false }, as(users.principal))) as any;
    expect(run.result.createdNumbers).toEqual(["1998", "2001"]);
    expect(run.result.skipped).toEqual([{ number: "1998 - Priestley", reason: expect.stringMatching(/no spaces/) }]);
    expect(app.store.matterByNumber(TENANT, "1998")!.number).toBe("1998");
  });
});

describe("calendar sync and digest", () => {
  it("syncs only confirmed dates for the user's matters and reports the day", async () => {
    const cal = new FakeCalendar();
    const app = createApp({ hub: new IntegrationHub().setCalendar(() => cal) });
    const created = (await app.bus.execute("create_matter", { number: "1998", title: "Priestley v ICWA", scheme: "icwa_mva", injuryDate: "2024-01-10", client: { name: "Toni Priestley" } }, as(users.solicitor))) as any;
    const lim = created.result.keyDates.find((k: any) => k.ruleId === "limitation.pi.3y");
    expect(((await app.bus.execute("sync_calendar", {}, as(users.solicitor))) as any).result.synced).toBe(0);
    const req = await app.bus.execute("confirm_key_date", { matterId: created.result.matter.id, keyDateId: lim.id }, as(users.solicitor));
    await app.bus.execute("decide_approval", { approvalId: (req as any).approvalId, decision: "approve" }, as(users.principal));
    expect(((await app.bus.execute("sync_calendar", {}, as(users.solicitor))) as any).result.synced).toBe(1);
    expect(cal.events.get(lim.id)).toMatchObject({ date: "2027-01-10", title: "1998 Priestley v ICWA: Limitation: commence proceedings (3 years from injury)" });
    expect(((await app.bus.execute("sync_calendar", {}, as(users.solicitor))) as any).result.synced).toBe(0);

    const digest = ((await app.bus.execute("daily_digest", { days: 90 }, as(users.solicitor))) as any).result;
    expect(digest.needsAttention.length).toBeGreaterThan(0);
    expect(digest.needsAttention[0].matterNumber).toBe("1998");
  });
});

describe("connect flows", () => {
  it("builds PKCE authorize URLs and exchanges codes", async () => {
    const p = { id: "xero" as const, label: "Xero", scope: "firm" as const, authorizeUrl: "https://login.xero.com/identity/connect/authorize", tokenUrl: "https://identity.xero.com/connect/token", scopes: ["offline_access"], clientId: "cid", clientSecret: "sec" };
    const { url, verifier } = beginConnect(p, "https://practy.example/integrations/callback/xero");
    const u = new URL(url);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe("offline_access");
    let body = "";
    const tok = await exchangeCode(p, "abc", "https://practy.example/integrations/callback/xero", verifier, (async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 1800 }));
    }) as typeof fetch);
    expect(body).toContain(`code_verifier=${verifier}`);
    expect(tok).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    expect(connectionSecretName(p, "u1")).toBe("xero");
    expect(connectionSecretName({ id: "google", scope: "user" }, "u1")).toBe("google:u1");
  });
});
