import { describe, expect, it } from "vitest";
import { settingsFor, type TenantSettings } from "../src/admin/settings.js";
import { matchEmail, DEFAULT_MISC } from "../src/filing/matcher.js";
import { cleanSubject, emailBaseName } from "../src/filing/naming.js";
import { IntegrationHub } from "../src/integrations/hub.js";
import { documentsOf } from "../src/documents/model.js";
import { createApp } from "../src/server/app.js";
import { FakeDocumentStore, FakeMailSource, mail } from "./fakes.js";
import { as, TENANT, users } from "./helpers.js";

const FIRM = ["soullegal.com.au"];

describe("email naming", () => {
  it("names by direction relative to the firm and never names the fee earner", () => {
    const base = { date: "2026-09-02T01:22:00Z", cc: [] };
    expect(emailBaseName({ ...base, from: { email: "kevin@soullegal.com.au", name: "Kevin Wong" }, to: [{ email: "x@hmc.com.au", name: "Hollywood Medical Centre" }], subject: "Re: 1998 - Priestley, Toni - MVA: surgery on 12.12.2023" }, FIRM))
      .toBe("2026.09.02 EM to Hollywood Medical Centre re surgery on 12.12.2023");
    expect(emailBaseName({ ...base, from: { email: "claims@icwa.wa.gov.au", name: "ICWA" }, to: [{ email: "kevin@soullegal.com.au" }], subject: "FW: liability" }, FIRM)).toBe("2026.09.02 EM from ICWA re liability");
    expect(emailBaseName({ ...base, from: { email: "a@hmc.com.au", name: "Hollywood Medical Centre" }, to: [{ email: "p@neuro.com.au", name: "Prof Panegyres" }], subject: "surgery" }, FIRM)).toBe("2026.09.02 EM from Hollywood Medical Centre to Prof Panegyres re surgery");
    expect(cleanSubject("Re: RE: Fwd: [1380] - Pollemans, Joe - WC - medical")).toBe("medical");
  });
});

describe("matcher", () => {
  const index = [
    { matterId: "m1", number: "1998", status: "open" as const, clientName: "Toni Priestley", surnames: ["priestley"], emails: ["toni@example.com"], references: ["civ 501 of 2026"] },
    { matterId: "m2", number: "2001", status: "open" as const, clientName: "Jo Smith", surnames: ["smith"], emails: [], references: [] },
    { matterId: "m3", number: "2002", status: "open" as const, clientName: "Al Smith", surnames: ["smith"], emails: [], references: [] },
  ];
  const cfg = { firmDomains: FIRM, ...DEFAULT_MISC };
  const facts = (subject: string, from = "dr@clinic.com.au", body = "") => ({ subject, from, to: ["kevin@soullegal.com.au"], cc: [], body, threadId: "t" });

  it("files on number + surname, action number, thread or unique surname", () => {
    expect(matchEmail(facts("1998 - Priestley, Toni - MVA report"), index, undefined, cfg)).toMatchObject({ decision: "file", matterId: "m1" });
    expect(matchEmail(facts("Hearing CIV 501/2026"), index, undefined, cfg)).toMatchObject({ decision: "file", matterId: "m1" });
    expect(matchEmail(facts("thanks"), index, "m2", cfg)).toMatchObject({ decision: "file", matterId: "m2", confidence: 0.99 });
    expect(matchEmail(facts("Report for Ms Priestley"), index, undefined, cfg)).toMatchObject({ decision: "file", matterId: "m1" });
  });

  it("sends ambiguous evidence to review and system mail to misc", () => {
    const smith = matchEmail(facts("Smith appointment"), index, undefined, cfg);
    expect(smith).toMatchObject({ decision: "review" });
    expect(smith.candidates.sort()).toEqual(["m2", "m3"]);
    expect(matchEmail(facts("Invoice 1998 attached"), index, undefined, cfg).decision).toBe("review");
    expect(matchEmail(facts("Hello", "toni@example.com"), index, undefined, cfg)).toMatchObject({ decision: "review", candidates: ["m1"] });
    expect(matchEmail(facts("Task reminder", "no-reply@practicepanther.com"), index, undefined, cfg).decision).toBe("misc");
  });
});

async function setupFiling(mode: "practy" | "label_bridge") {
  const docs = new FakeDocumentStore();
  const inbox = new FakeMailSource("kevin@soullegal.com.au", [
    mail({ id: "a", subject: "1998 - Priestley, Toni - MVA: specialist report", from: { email: "reception@clinic.com.au", name: "Smith Street Medical" }, attachments: [{ filename: "ATT01 - Report.pdf", contentType: "application/pdf", size: 10, bytes: new Uint8Array(10) }] }),
    mail({ id: "b", threadId: "t-a", subject: "Re: thanks", from: { email: "reception@clinic.com.au" }, date: "2026-10-28T03:00:00.000Z" }),
    mail({ id: "c", subject: "Task reminder", from: { email: "no-reply@practicepanther.com" } }),
    mail({ id: "d", subject: "Appointment for Mr Nguyen", from: { email: "physio@spark.com.au" } }),
    mail({ id: "e", subject: "Physio update", from: { email: "physio@spark.com.au", name: "Spark Physio" } }),
  ]);
  const hub = new IntegrationHub().setDocuments(() => docs).setMail(() => inbox);
  const app = createApp({ hub, renderEmailPdf: async (m) => new TextEncoder().encode(`PDF ${m.subject}`) });
  const s = app.store.collection<TenantSettings>("tenant_settings");
  const cur = settingsFor(app.store, TENANT);
  s.set({ ...cur, identity: { ...cur.identity, allowedDomains: FIRM }, mail: { ...cur.mail, provider: "gmail", filingMode: mode } });
  const r1 = await app.bus.execute("create_matter", { number: "1998", title: "Priestley v ICWA", scheme: "icwa_mva", injuryDate: "2025-03-14", client: { name: "Toni Priestley" } }, as(users.solicitor));
  const r2 = await app.bus.execute("create_matter", { number: "2003", title: "Nguyen v ICWA", scheme: "icwa_mva", injuryDate: "2025-05-01", client: { name: "Van Nguyen" } }, as(users.solicitor));
  return { app, docs, inbox, m1998: (r1 as any).result.matter.id as string, m2003: (r2 as any).result.matter.id as string };
}

describe("filing service", () => {
  it("files strong matches into the matter's Emails folder with convention names, queues the rest, and is idempotent", async () => {
    const { app, docs, m1998, m2003 } = await setupFiling("practy");
    const run = (await app.bus.execute("run_mail_sweep", { since: "2026-10-01T00:00:00Z" }, as(users.solicitor))) as any;
    // a: number + surname; b: same thread as a; d: unique surname; c: system mail; e: no evidence.
    expect(run.result).toMatchObject({ processed: 5, filed: 3, review: 1, misc: 1 });
    expect(docs.namesIn("Emails")).toEqual([
      "2026.10.28 EM from Smith Street Medical re specialist report.eml",
      "2026.10.28 EM from Smith Street Medical re specialist report.pdf",
      "2026.10.28 EM from physio@spark.com.au re Appointment for Mr Nguyen.eml",
      "2026.10.28 EM from physio@spark.com.au re Appointment for Mr Nguyen.pdf",
      "2026.10.28 EM from reception@clinic.com.au re thanks.eml",
      "2026.10.28 EM from reception@clinic.com.au re thanks.pdf",
      "2026.10.28 Report.pdf",
    ]);
    expect([...docs.folders.values()].some((f) => f.name === "1998 - Priestley, Toni - MVA")).toBe(true);
    expect(documentsOf(app.store).list(TENANT, (d) => d.matterId === m1998)).toHaveLength(3);

    const queue = ((await app.bus.execute("list_filing_queue", {}, as(users.solicitor))) as any).result;
    expect(queue.map((i: any) => i.subject)).toEqual(["Physio update"]);
    const filed = ((await app.bus.execute("file_email", { itemId: queue[0].id, matterId: m2003 }, as(users.solicitor))) as any).result;
    expect(filed).toMatchObject({ status: "filed", matterId: m2003, filedVia: "practy" });
    expect(docs.namesIn("Emails")).toContain("2026.10.28 EM from Spark Physio re Physio update.pdf");

    const again = (await app.bus.execute("run_mail_sweep", { since: "2026-10-01T00:00:00Z" }, as(users.solicitor))) as any;
    expect(again.result.processed).toBe(0);
  });

  it("drives the firm's existing automation with refile labels in bridge mode", async () => {
    const { app, inbox, docs } = await setupFiling("label_bridge");
    await app.bus.execute("run_mail_sweep", { since: "2026-10-01T00:00:00Z" }, as(users.solicitor));
    expect(inbox.labels.get("a")).toEqual(["Box Filed/Refile/1998"]);
    expect(docs.files.size).toBe(0);
  });
});
