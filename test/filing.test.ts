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

  it("sends email only to matter parties, after approval, and files the sent copy", async () => {
    const { app, inbox, docs, m1998 } = await setupFiling("practy");
    await app.bus.execute("add_party", { matterId: m1998, name: "Dr Smith", role: "other", email: "dr@clinic.com.au" }, as(users.solicitor));
    await expect(app.bus.execute("send_email", { matterId: m1998, to: ["stranger@evil.com"], subject: "x", body: "y" }, as(users.solicitor, "agent"))).rejects.toMatchObject({ code: "invalid" });
    expect(((await app.bus.execute("list_approvals", { status: "pending" }, as(users.principal))) as any).result).toHaveLength(0);
    expect(inbox.sent).toHaveLength(0);

    const req = (await app.bus.execute("send_email", { matterId: m1998, to: ["dr@clinic.com.au"], subject: "Request for report", body: "Please provide your report." }, as(users.solicitor, "agent"))) as any;
    const done = (await app.bus.execute("decide_approval", { approvalId: req.approvalId, decision: "approve" }, as(users.solicitor))) as any;
    expect(done.result.status).toBe("executed");
    expect(inbox.sent[0]!.to).toEqual([{ email: "dr@clinic.com.au" }]);
    expect(docs.namesIn("Emails").some((n) => n.includes("EM to dr@clinic.com.au re Request for report"))).toBe(true);
  });
});

describe("filing respects walls and AI consent", () => {
  const since = { since: "2026-10-01T00:00:00Z" };
  const patch = (app: Awaited<ReturnType<typeof setupFiling>>["app"], matterId: string, p: Record<string, unknown>) =>
    app.store.matters.set({ ...app.store.matters.get(matterId)!, ...p });

  it("never matches, reveals or files into a matter the mailbox owner is walled from", async () => {
    const { app, docs, m2003 } = await setupFiling("practy");
    patch(app, m2003, { restrictedTo: [users.principal.userId] });
    const run = (await app.bus.execute("run_mail_sweep", since, as(users.solicitor))) as any;
    // d ("Appointment for Mr Nguyen") no longer resolves to the walled Nguyen matter.
    expect(run.result).toMatchObject({ filed: 2 });
    expect(documentsOf(app.store).list(TENANT, (d) => d.matterId === m2003)).toHaveLength(0);
    expect(docs.namesIn("Emails").some((n) => n.includes("Nguyen"))).toBe(false);
    for (const status of ["review", "filed", "misc"]) {
      const items = ((await app.bus.execute("list_filing_queue", { status }, as(users.solicitor))) as any).result;
      expect(JSON.stringify(items)).not.toContain(m2003);
      expect(JSON.stringify(items.map((i: any) => i.evidence))).not.toContain("nguyen");
    }
    // The service itself refuses, whichever path reaches it.
    const item = app.filing.items.list(TENANT, (i) => i.messageId === "d")[0]!;
    await expect(app.filing.file(users.solicitor, item, m2003)).rejects.toMatchObject({ code: "not_found" });
    expect(documentsOf(app.store).list(TENANT, (d) => d.matterId === m2003)).toHaveLength(0);
  });

  it("refuses to file or dismiss an item tied to a matter hidden on the calling surface", async () => {
    const { app, m1998, m2003 } = await setupFiling("practy");
    await app.bus.execute("run_mail_sweep", since, as(users.solicitor));
    const filedTo2003 = app.filing.items.list(TENANT, (i) => i.matterId === m2003 && i.status === "filed")[0]!;
    patch(app, m2003, { aiPermitted: false });
    // Item ids are guessable, so an AI client must not be able to touch or read it by id.
    await expect(app.bus.execute("dismiss_email", { itemId: filedTo2003.id }, as(users.solicitor, "agent"))).rejects.toMatchObject({ code: "not_found" });
    await expect(app.bus.execute("file_email", { itemId: filedTo2003.id, matterId: m1998 }, as(users.solicitor, "mcp"))).rejects.toMatchObject({ code: "not_found" });
    expect(app.filing.items.find(TENANT, filedTo2003.id)!.status).toBe("filed");
    patch(app, m2003, { aiPermitted: true, restrictedTo: [users.principal.userId] });
    await expect(app.bus.execute("dismiss_email", { itemId: filedTo2003.id }, as(users.solicitor))).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps an AI exclusion when excluded email content is filed again to another matter", async () => {
    const { app, m1998, m2003 } = await setupFiling("practy");
    await app.bus.execute("run_mail_sweep", since, as(users.solicitor));
    const filed = app.filing.items.list(TENANT, (i) => i.matterId === m1998 && i.status === "filed" && !!i.documentIds?.length)[0]!;
    for (const id of filed.documentIds!) {
      await app.bus.execute("restrict_document_ai", { matterId: m1998, documentId: id, reason: "privileged" }, as(users.solicitor));
    }
    const refiled = (await app.bus.execute("file_email", { itemId: filed.id, matterId: m2003 }, as(users.solicitor))) as any;
    const copies = documentsOf(app.store).list(TENANT, (d) => refiled.result.documentIds.includes(d.id));
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.every((d) => d.aiExcluded && d.derivedFrom?.length)).toBe(true);
  });

  it("hides queue items tied to no-AI matters from AI surfaces", async () => {
    const { app, m2003 } = await setupFiling("practy");
    patch(app, m2003, { aiPermitted: false });
    await app.bus.execute("run_mail_sweep", since, as(users.solicitor));
    const ui = ((await app.bus.execute("list_filing_queue", { status: "filed" }, as(users.solicitor))) as any).result;
    expect(ui.some((i: any) => i.matterId === m2003)).toBe(true);
    for (const status of ["review", "filed"]) {
      const ai = ((await app.bus.execute("list_filing_queue", { status }, as(users.solicitor, "agent"))) as any).result;
      expect(JSON.stringify(ai)).not.toContain(m2003);
      expect(ai.some((i: any) => i.subject.includes("Nguyen"))).toBe(false);
    }
  });
});

describe("send_email recipients and approval detail", () => {
  const since = { since: "2026-10-01T00:00:00Z" };

  it("does not treat an auto-filed sender as a correspondent until a person files their mail", async () => {
    const { app, m1998, m2003 } = await setupFiling("practy");
    await app.bus.execute("run_mail_sweep", since, as(users.solicitor));
    // reception@clinic.com.au reached m1998 only through automatic filing.
    await expect(app.bus.execute("send_email", { matterId: m1998, to: ["reception@clinic.com.au"], subject: "x", body: "y" }, as(users.solicitor, "agent"))).rejects.toMatchObject({ code: "invalid" });
    const queue = ((await app.bus.execute("list_filing_queue", {}, as(users.solicitor))) as any).result;
    await app.bus.execute("file_email", { itemId: queue[0].id, matterId: m2003 }, as(users.solicitor));
    const req = (await app.bus.execute("send_email", { matterId: m2003, to: ["physio@spark.com.au"], subject: "x", body: "y" }, as(users.solicitor, "agent"))) as any;
    expect(req.status).toBe("pending_approval");
  });

  it("does not let an AI client vouch for a sender by filing their email", async () => {
    const { app, m2003 } = await setupFiling("practy");
    await app.bus.execute("run_mail_sweep", since, as(users.solicitor));
    const queue = ((await app.bus.execute("list_filing_queue", {}, as(users.solicitor, "agent"))) as any).result;
    const fromPhysio = queue.find((i: any) => i.from === "physio@spark.com.au");
    await app.bus.execute("file_email", { itemId: fromPhysio.id, matterId: m2003 }, as(users.solicitor, "agent"));
    await expect(app.bus.execute("send_email", { matterId: m2003, to: ["physio@spark.com.au"], subject: "x", body: "y" }, as(users.solicitor, "agent"))).rejects.toMatchObject({ code: "invalid" });
  });

  it("shows the approver attachment names and rejects attachments from another matter up front", async () => {
    const { app, m1998, m2003 } = await setupFiling("practy");
    await app.bus.execute("run_mail_sweep", since, as(users.solicitor));
    await app.bus.execute("add_party", { matterId: m1998, name: "Dr Smith", role: "other", email: "dr@clinic.com.au" }, as(users.solicitor));
    const report = documentsOf(app.store).list(TENANT, (d) => d.matterId === m1998 && d.name.endsWith("Report.pdf"))[0]!;
    const other = documentsOf(app.store).list(TENANT, (d) => d.matterId === m2003)[0]!;
    const send = { matterId: m1998, to: ["dr@clinic.com.au"], subject: "Report", body: "Attached." };
    await expect(app.bus.execute("send_email", { ...send, attachDocumentIds: [other.id] }, as(users.solicitor, "agent"))).rejects.toMatchObject({ code: "not_found" });
    const req = (await app.bus.execute("send_email", { ...send, attachDocumentIds: [report.id] }, as(users.solicitor, "agent"))) as any;
    const pending = ((await app.bus.execute("list_approvals", { status: "pending" }, as(users.principal))) as any).result;
    const approval = pending.find((a: any) => a.id === req.approvalId);
    expect(approval.context.attachments).toEqual([{ id: report.id, name: "2026.10.28 Report.pdf", category: "Correspondence" }]);
  });
});
