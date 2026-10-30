import { describe, expect, it } from "vitest";
import { ATS_LABELS, AuthorityFormError, fillFirmAuthorityForm, type AuthorityFigures } from "../../src/docgen/authority.js";
import { docxText } from "../../src/docgen/docx.js";
import { makeDocx, p, r, readPart, syntheticAuthorityForm } from "./fixtures.js";

// The skill's worked example (Hu v Ramsay) as the calculator would display it; the
// people are replaced with fictional names.
const HU_V_RAMSAY: AuthorityFigures = {
  clientName: "Jane Citizen",
  injuryDate: "29/10/2024",
  solicitor: "Alex Solicitor",
  otherTerms: "resignation from employment with the respondent.",
  disbursementsNote: "Nil",
  cells: [
    { label: "settlement offer", display: "$33,430.55" },
    { label: "contribution towards legal costs", display: "$37,500.00" },
    { label: "contribution towards disbursements", display: "$2,530.00" },
    { label: "contribution towards medical accounts", display: "$1,569.45" },
    { label: "contribution towards Medicare Australia", display: "Nil" },
    { label: "TOTAL OFFER", display: "$75,030.00" },
    { label: "workers compensation refund", display: "Nil" },
    { label: "medical/other accounts", display: "by me" },
    { label: "Medicare Australia [10%", display: "E$7,503.00" },
    { label: "Tax (if applicable)", display: "Nil" },
    { label: "Centrelink refund", display: "E$ – to be ascertained" },
    { label: "Legal Aid Refund", display: "N/A" },
    { label: "barrister", display: "Nil" },
    { label: "other debts", display: "Nil" },
    { label: "outstanding disbursements to be paid", display: "Nil" },
    { label: "Soul Legal fees", display: "E$37,500.00" },
    { label: "estimated net in hand", display: "E$30,027.00" },
    { label: "plus Medicare/other benefits", display: "E$7,503.00" },
    { label: "plus residual balance held in trust", display: "Nil" },
    { label: "total", display: "E$37,530.00" },
  ],
};

/** label → value, read back from the filled table rows. */
function rows(xml: string): Map<string, string> {
  const text = docxText(xml).split("\n");
  const map = new Map<string, string>();
  for (let i = 0; i < text.length - 1; i++) map.set(text[i]!.trim(), text[i + 1]!.trim());
  return map;
}

describe("fillFirmAuthorityForm", () => {
  it("cells for the worked example follow ATS_LABELS", () => {
    expect(HU_V_RAMSAY.cells.map((c) => c.label)).toEqual([...ATS_LABELS]);
  });

  it("fills the worked example into the form", () => {
    const out = fillFirmAuthorityForm(syntheticAuthorityForm(), HU_V_RAMSAY);
    const xml = readPart(out, "word/document.xml");
    const text = docxText(xml);
    const next = rows(xml);

    // Tokens, including the one Word split across runs and the repeat under the signature.
    expect(text).toContain("I Jane Citizen DIRECT You");
    expect(text).toContain("on or about 29/10/2024 as follows");
    expect(text).toContain("Solicitor: Alex Solicitor");
    expect(text.match(/Jane Citizen/g)).toHaveLength(2);
    expect(text).not.toMatch(/\{\{|\}\}/);

    expect(text).toContain("other terms: resignation from employment with the respondent.");
    expect(text).toContain("Soul Legal fees (including disbursements of $Nil)");

    expect(next.get("settlement offer")).toBe("$33,430.55");
    expect(next.get("contribution towards legal costs (including GST)")).toBe("$37,500.00");
    expect(next.get("TOTAL OFFER")).toBe("$75,030.00");
    expect(next.get("medical/other accounts: _____________________________________")).toBe("by me");
    expect(next.get("Medicare Australia [10% advance payment, subject to refund, if any]")).toBe("E$7,503.00");
    expect(next.get("Centrelink refund – you to ascertain")).toBe("E$ – to be ascertained");
    expect(next.get("Legal Aid Refund, (if applicable)")).toBe("N/A");
    expect(next.get("Soul Legal fees (including disbursements of $Nil)")).toBe("E$37,500.00");
    expect(next.get("estimated net in hand cash settlement (subject to unknown figures above)")).toBe("E$30,027.00");
    expect(next.get("plus Medicare/other benefits (if any, up to)")).toBe("E$7,503.00");
    expect(next.get("total")).toBe("E$37,530.00");

    // The "[E means estimated] $" heading cell is not a row value and stays as is,
    // and no value cell is left unfilled.
    expect(xml).not.toMatch(/<w:t[^>]*>\s*E\$\s*<\/w:t>/);
    expect((xml.match(/<w:t[^>]*>\$<\/w:t>/g) ?? []).length).toBe(1);

    // Client-completed fields stay blank.
    expect(text).toContain("DATED this ________ day of");
    expect(text).toContain("BSB: __________________________Account No.");
    // Header/footer parts are untouched.
    expect(readPart(out, "word/header1.xml")).toContain("rIdLogo");
  });

  it("fills the disbursements blank with a figure when the firm carried them", () => {
    const out = fillFirmAuthorityForm(syntheticAuthorityForm(), { ...HU_V_RAMSAY, disbursementsNote: "2,530.00" });
    expect(docxText(readPart(out, "word/document.xml"))).toContain("(including disbursements of $2,530.00)");
  });

  it("escapes XML in values", () => {
    const out = fillFirmAuthorityForm(syntheticAuthorityForm(), { ...HU_V_RAMSAY, clientName: "A & B <Trust>" });
    const xml = readPart(out, "word/document.xml");
    expect(xml).toContain("A &amp; B &lt;Trust&gt;");
    expect(docxText(xml)).toContain("I A & B <Trust> DIRECT");
  });

  it("throws clearly when a label is missing or out of order", () => {
    const missing = { ...HU_V_RAMSAY, cells: [...HU_V_RAMSAY.cells.slice(0, 3), { label: "contribution towards rehabilitation", display: "$1.00" }] };
    expect(() => fillFirmAuthorityForm(syntheticAuthorityForm(), missing)).toThrow(/Label "contribution towards rehabilitation" not found/);
    const swapped = { ...HU_V_RAMSAY, cells: [HU_V_RAMSAY.cells[1]!, HU_V_RAMSAY.cells[0]!] };
    expect(() => fillFirmAuthorityForm(syntheticAuthorityForm(), swapped)).toThrow(/form order/);
  });

  it("throws when the template is not the firm form", () => {
    const plain = makeDocx({ body: p(r("Just a letter")) });
    expect(() => fillFirmAuthorityForm(plain, HU_V_RAMSAY)).toThrow(AuthorityFormError);
    expect(() => fillFirmAuthorityForm(plain, HU_V_RAMSAY)).toThrow(/\{\{CLIENT_NAME\}\} not found/);
  });

  it("throws when a value cell is missing after a label", () => {
    const form = makeDocx({ body: p(r("{{CLIENT_NAME}} {{INJURY_DATE}} {{SOLICITOR}} other terms: ___ disbursements of $___ settlement offer")) });
    expect(() => fillFirmAuthorityForm(form, { ...HU_V_RAMSAY, cells: HU_V_RAMSAY.cells.slice(0, 1) })).toThrow(/No "\$" or "E\$" value cell after label "settlement offer"/);
  });
});
