import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { docxText as xmlText, getDocumentXml, openDocx } from "../src/docgen/docx.js";

const docxText = (bytes: Uint8Array) => xmlText(getDocumentXml(openDocx(bytes)));
import { IntegrationHub } from "../src/integrations/hub.js";
import { createApp } from "../src/server/app.js";
import { makeDocx, p, r, syntheticAuthorityForm } from "./docgen/fixtures.js";
import { FakeDocumentStore } from "./fakes.js";
import { as, TENANT, users } from "./helpers.js";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

async function pdf(text: string): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const page = d.addPage([595, 842]);
  page.drawText(text, { x: 50, y: 780, size: 12, font: await d.embedFont(StandardFonts.Helvetica) });
  return d.save();
}

async function setup() {
  const store = new FakeDocumentStore();
  const app = createApp({ hub: new IntegrationHub().setDocuments(() => store) });
  const exec = async (name: string, input: unknown, actor: (typeof users)[keyof typeof users] = users.solicitor) => {
    const out = await app.bus.execute(name, input, as(actor));
    if (out.status !== "executed") throw new Error(`${name}: ${out.status}`);
    return out.result as any;
  };
  const { matter } = await exec("create_matter", {
    number: "1998", title: "Priestley v ICWA", scheme: "icwa_mva", injuryDate: "2025-03-14",
    client: { name: "Toni Priestley", dateOfBirth: "1990-05-01" },
    otherParties: [{ name: "Insurance Commission of Western Australia", role: "defendant", kind: "organisation" }],
    references: ["CIV 501 of 2026"],
  });
  return { app, store, exec, matter };
}

describe("document workflow", () => {
  it("prepares the Authority to Settle on the firm's own form and saves it to the matter", async () => {
    const { exec, matter, store } = await setup();
    await expect(exec("generate_authority_document", { matterId: matter.id })).rejects.toMatchObject({ code: "conflict" });
    await exec("upload_template", { kind: "authority_form", name: "Authority to Settle", base64: b64(syntheticAuthorityForm()) }, users.principal);
    await exec("compute_authority_to_settle", {
      matterId: matter.id, settlementOfferCents: 3_343_055, legalCostsCents: 3_750_000, disbursementsCents: 253_000, medicalAccountsCents: 156_945,
      medicalAccountsPaidByClient: true, clientPaidDisbursements: true, solicitor: "A Solicitor", otherTerms: "resignation from employment.",
    });
    const out = await exec("generate_authority_document", { matterId: matter.id });
    expect(out.totals).toEqual({ totalOffer: "$75,030.00", netInHand: "$30,027.00", netTotal: "$37,530.00" });
    expect(out.document.name).toMatch(/^\d{4}\.\d{2}\.\d{2} Authority to Settle – Toni Priestley\.docx$/);
    const text = docxText(await store.download(out.document.storeFileId));
    expect(text).toContain("Toni Priestley");
    expect(text).toContain("E$30,027.00");
    expect(store.namesIn("Drafts")).toEqual([out.document.name]);
    expect([...store.folders.values()].some((f) => f.name === "1998 - Priestley, Toni - MVA")).toBe(true);
  });

  it("drafts letters on letterhead, Form 17 lists, particulars and court books", async () => {
    const { exec, matter, store } = await setup();
    await exec("upload_template", { kind: "letterhead", name: "Letterhead", base64: b64(makeDocx({ body: p(r("placeholder")) })) }, users.principal);
    const letter = await exec("generate_letter", { matterId: matter.id, addressee: ["Insurance Commission of WA", "PO Box 6703", "East Perth WA 6892"], salutation: "Sir/Madam", body: ["We act for Ms Priestley."], date: "2026-10-30" });
    expect(letter.name).toBe("2026.10.30 LTR to Insurance Commission of WA.docx");
    expect(docxText(await store.download(letter.storeFileId))).toContain("We act for Ms Priestley.");

    const report = await exec("upload_document", { matterId: matter.id, name: "2025.06.01 Medical Report – by Dr Smith – Orthopaedic Surgeon.pdf", base64: b64(await pdf("Report")), contentType: "application/pdf", subfolder: "Medical Reports", docDate: "2025-06-01", category: "Medical Reports" });
    const affidavit = await exec("upload_document", { matterId: matter.id, name: "2026.10.30 Affidavit of Kevin.pdf", base64: b64(await pdf("Affidavit")), contentType: "application/pdf" });
    const lod = await exec("generate_list_of_documents", { matterId: matter.id, actionNumber: "CIV 501 of 2026" });
    expect(lod.items).toBeGreaterThanOrEqual(5);
    expect(docxText(await store.download(lod.document.storeFileId))).toContain("Medical Report");

    await exec("compute_damages", {
      matterId: matter.id, plaintiff: { sex: "female" }, calculationDate: "2026-11-01", preInjuryEarnings: { grossWeeklyCents: 155_300 },
      generalDamagesCents: null, lifeExpectancy: { years: 45.1, citation: "ABS Life Tables, Western Australia, 2022 to 2024" },
    });
    const part = await exec("generate_particulars", { matterId: matter.id });
    const ptext = docxText(await store.download(part.document.storeFileId));
    expect(ptext).toContain("rule 45C(3)");
    expect(ptext).toContain("CIV 501 of 2026");
    expect(ptext).toContain(part.total);

    const book = await exec("build_court_book", { matterId: matter.id, mode: "house", title: "Affidavit of Kevin with annexures", documentIds: [affidavit.id, report.id], markPrefix: "KW" });
    expect(book.pages).toBeGreaterThanOrEqual(2);
    expect(book.document.name).toMatch(/Affidavit of Kevin with annexures\.pdf$/);

    const synced = await exec("sync_matter_documents", { matterId: matter.id });
    expect(synced.added).toBe(0);
    expect((await exec("check_document_name", { name: "2024.01.13 EM by Kevin Wong to Dr Smith" })).issues.length).toBeGreaterThan(0);
    expect((await exec("list_documents", { matterId: matter.id })).length).toBe(6);
    expect(TENANT).toBe("t-soul");
  });

  it("carries AI exclusion and evidence flags onto court books and markup copies", async () => {
    const { exec, matter } = await setup();
    const up = (name: string, bytes: Uint8Array, contentType: string) => exec("upload_document", { matterId: matter.id, name, base64: b64(bytes), contentType });
    const privileged = await up("2026.01.01 Privileged advice.pdf", await pdf("Privileged"), "application/pdf");
    const affidavit = await up("2026.10.30 Affidavit of Kevin.pdf", await pdf("Affidavit"), "application/pdf");
    const draft = await up("2026.10.30 Statement.docx", makeDocx({ body: p(r("text")) }), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    await exec("restrict_document_ai", { matterId: matter.id, documentId: privileged.id, reason: "privileged" });
    await exec("mark_evidence_document", { matterId: matter.id, documentId: affidavit.id, evidence: true });

    const book = await exec("build_court_book", { matterId: matter.id, mode: "book", title: "Book", documentIds: [affidavit.id, privileged.id] });
    expect(book.document).toMatchObject({ aiExcluded: true, evidence: true, derivedFrom: [affidavit.id, privileged.id] });
    expect(book.document.aiExcludedReason).toContain("privileged");
    await expect(exec("build_chronology", { matterId: matter.id, documentId: book.document.id })).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("excluded from AI") });

    // Excluding a source later also excludes copies already made from it.
    const markup = await exec("remove_tracked_changes", { matterId: matter.id, documentId: draft.id });
    expect(markup.document.aiExcluded).toBeUndefined();
    await exec("restrict_document_ai", { matterId: matter.id, documentId: draft.id, reason: "implied undertaking" });
    expect(await exec("get_document", { matterId: matter.id, documentId: markup.document.id })).toMatchObject({ aiExcluded: true, derivedFrom: [draft.id] });
  });
});
