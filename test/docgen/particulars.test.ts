import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { docxText } from "../../src/docgen/docx.js";
import { renderParticulars, type ParticularsDocument } from "../../src/docgen/particulars.js";
import { readPart } from "./fixtures.js";

// Illustrative figures only (fictional parties); the damages engine supplies real ones.
const DOC: ParticularsDocument = {
  heading: {
    court: "IN THE DISTRICT COURT OF WESTERN AUSTRALIA",
    registry: "HELD AT PERTH",
    actionNumber: "CIV 1234 of 2025",
    parties: [
      { name: "SAM PLAINTIFF", role: "Plaintiff" },
      { name: "EXAMPLE EMPLOYER PTY LTD", role: "Defendant" },
    ],
  },
  title: ["PLAINTIFF'S SCHEDULE OF DAMAGES"],
  details: [
    { label: "Date of document:", value: "1 November 2026" },
    { label: "Prepared by:", value: ["Example Firm", "1 Example Street", "PERTH WA 6000"] },
  ],
  intro: "The plaintiff provides the following particulars pursuant to rule 45C(3) of the District Court Rules 2005, calculated to 1 November 2026. They supersede the particulars dated 1 March 2026.",
  confidentialHeader: "CONFIDENTIAL FOR THE PURPOSES OF MEDIATION ONLY",
  heads: [
    {
      number: "1",
      title: "Loss of earning capacity",
      blocks: [
        {
          kind: "section",
          number: "1.1",
          title: "Past loss",
          blocks: [
            { kind: "paragraph", label: "(a)", text: "Weekly payments paid by the insurer (gross).", blocks: [{ kind: "calc", text: "Per claims history = $40,000.00" }] },
            { kind: "paragraph", label: "(b)", text: "Unindemnified period, net.", blocks: [{ kind: "calc", text: "130.29 weeks x $1,264.25 (net weekly wage) = $164,399.57" }] },
          ],
          amount: { label: "Total past loss of earning capacity", amount: "$204,399.57" },
        },
        {
          kind: "section",
          number: "1.2",
          title: "Future loss",
          blocks: [
            { kind: "paragraph", label: "(a)", text: "The 6% weekly multiplier for 25 years is 686.9.", blocks: [{ kind: "calc", text: "$1,264.25 x 686.9 x 0.95 = $824,986.75" }] },
          ],
          amount: { label: "Total future loss of earning capacity", amount: "$824,986.75" },
        },
      ],
      amount: { label: "Total loss of earning capacity", amount: "$1,029,386.32" },
    },
    {
      number: "3",
      title: "Special damages",
      blocks: [
        {
          kind: "table",
          columns: [{ header: "Period", weight: 2 }, { header: "Provider/payer", weight: 2 }, { header: "Item", weight: 3 }, { header: "Amount", align: "right", weight: 1.5 }],
          rows: [
            ["2024–2025", "Paid by insurer (claims history)", "Medical and health expenses", "$12,000.00"],
            ["2025–2026", "Plaintiff", "Psychology", "$1,800.00"],
          ],
          total: ["", "", "Total", "$13,800.00"],
        },
      ],
      amount: { label: "Total special damages", amount: "$13,800.00" },
    },
  ],
  summary: {
    rows: [
      { label: "1. Loss of earning capacity" },
      { label: "1.1 Past loss", amount: "$204,399.57", level: 1 },
      { label: "1.2 Future loss", amount: "$824,986.75", level: 1 },
      { label: "3. Special damages", amount: "$13,800.00" },
    ],
    total: { label: "Total", amount: "$1,043,186.32" },
    notes: ["The total includes $52,000.00 of statutory compensation refundable to the insurer. The net figure is $991,186.32."],
  },
  signature: ["", "____________________", "Example Firm", "Solicitors for the plaintiff"],
};

describe("renderParticulars", () => {
  it("renders the Stott layout", async () => {
    const bytes = await renderParticulars(DOC);
    const xml = readPart(bytes, "word/document.xml");
    const text = docxText(xml);

    expect(text).toContain("IN THE DISTRICT COURT OF WESTERN AUSTRALIA\nHELD AT PERTH\tCIV 1234 of 2025\nBETWEEN\nSAM PLAINTIFF\tPlaintiff\nand\nEXAMPLE EMPLOYER PTY LTD\tDefendant");
    expect(text).toContain("PLAINTIFF'S SCHEDULE OF DAMAGES");
    expect(text).toContain("pursuant to rule 45C(3)");
    expect(text).toContain("1.\tLOSS OF EARNING CAPACITY\n1.1\tPast loss\n(a)\tWeekly payments paid by the insurer (gross).\nPer claims history = $40,000.00\n(b)\tUnindemnified period, net.\n130.29 weeks x $1,264.25 (net weekly wage) = $164,399.57\nTotal past loss of earning capacity\t$204,399.57");
    expect(text).toContain("Total loss of earning capacity\t$1,029,386.32");
    expect(text).toContain("Period\nProvider/payer\nItem\nAmount\n2024–2025\nPaid by insurer (claims history)\nMedical and health expenses\n$12,000.00");
    expect(text).toContain("SUMMARY\n1. Loss of earning capacity\n1.1 Past loss\t$204,399.57\n1.2 Future loss\t$824,986.75\n3. Special damages\t$13,800.00\nTotal\t$1,043,186.32\nThe total includes $52,000.00 of statutory compensation refundable");

    // Total ruled above and below; kept with the signature.
    expect(xml).toMatch(/<w:keepNext\/>[^]*?<w:pBdr><w:top w:val="single"[^]*?<w:bottom w:val="single"[^]*?Total</);
    // Times New Roman 12 by default.
    const styles = readPart(bytes, "word/styles.xml");
    expect(styles).toContain('w:ascii="Times New Roman"');
    expect(styles).toContain('<w:sz w:val="24"/>');

    // Mediation header and "Page X of Y" footer.
    const zip = new PizZip(bytes);
    const header = Object.keys(zip.files).find((f) => /^word\/header\d*\.xml$/.test(f))!;
    const footer = Object.keys(zip.files).find((f) => /^word\/footer\d*\.xml$/.test(f))!;
    expect(docxText(readPart(bytes, header))).toBe("CONFIDENTIAL FOR THE PURPOSES OF MEDIATION ONLY");
    const footerXml = readPart(bytes, footer);
    expect(footerXml).toMatch(/Page [^]*PAGE[^]* of [^]*NUMPAGES/);
  });

  it("omits the mediation header when not requested and checks table shape", async () => {
    const bytes = await renderParticulars({ ...DOC, confidentialHeader: undefined });
    expect(Object.keys(new PizZip(bytes).files).some((f) => /^word\/header\d*\.xml$/.test(f))).toBe(false);
    const bad: ParticularsDocument = { ...DOC, heads: [{ number: "3", title: "Special", blocks: [{ kind: "table", columns: [{ header: "A" }, { header: "B" }], rows: [["only one"]] }] }] };
    await expect(renderParticulars(bad)).rejects.toThrow(/1 cells but 2 columns/);
  });
});
