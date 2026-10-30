import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { docxText } from "../../src/docgen/docx.js";
import { buildLetterOnLetterhead, LetterheadError, type Letter, type LetterProfile } from "../../src/docgen/letter.js";
import { makeDocx, p, r, readPart, SECT_PR } from "./fixtures.js";

const PROFILE: LetterProfile = {
  sender: { name: "Alex Solicitor", title: "Partner", email: "alex@example.test", phone: "(08) 0000 0000" },
  signOff: { text: "Example Firm", font: "Brush Script MT", sizePt: 36, color: "091753" },
};

const LETTER: Letter = {
  date: "1 July 2026",
  contactRef: "1676",
  addressee: ["Sam Client", "1 Example Street", "Perth WA 6000"],
  byEmail: "sam@example.test",
  salutation: "Sam",
  referenceLine: "[1456] Client – Motor vehicle claim",
  body: ["First paragraph & detail.", "Second paragraph."],
  enclosure: true,
};

const letterhead = () => makeDocx({ body: p(r("Template placeholder body text")) + p(r("Delete me")) });

describe("buildLetterOnLetterhead", () => {
  it("replaces only the body and keeps sectPr, header, footer and logo", () => {
    const src = letterhead();
    const out = buildLetterOnLetterhead(src, LETTER, PROFILE);
    const xml = readPart(out, "word/document.xml");
    expect(xml).not.toContain("Template placeholder");
    expect(xml).toContain(SECT_PR);
    expect(xml.trimEnd().endsWith(`${SECT_PR}</w:body></w:document>`)).toBe(true);
    for (const part of ["word/header1.xml", "word/footer1.xml", "word/_rels/document.xml.rels", "word/_rels/header1.xml.rels"]) {
      expect(readPart(out, part)).toBe(readPart(src, part));
    }
    expect(new PizZip(out).file("word/media/image1.png")?.asUint8Array()).toEqual(new PizZip(src).file("word/media/image1.png")?.asUint8Array());
  });

  it("lays the letter out in house style", () => {
    const xml = readPart(buildLetterOnLetterhead(letterhead(), LETTER, PROFILE), "word/document.xml");
    const lines = docxText(xml).split("\n").filter((l) => l.trim());
    expect(lines).toEqual([
      "1 July 2026\tContact Ref: 1676",
      "\t\tAlex Solicitor | Partner",
      "\tSam Client\talex@example.test",
      "\t1 Example Street\t(08) 0000 0000",
      "\tPerth WA 6000",
      "\tBy email: sam@example.test",
      "Dear Sam",
      "[1456] Client – Motor vehicle claim",
      "First paragraph & detail.",
      "Second paragraph.",
      "Yours faithfully",
      "Example Firm",
      "Encl.",
    ]);
    expect(xml).toContain('<w:jc w:val="both"/>');
    expect(xml).toContain("First paragraph &amp; detail.");
    // Script sign-off: configurable font, 36pt (72 half-points), colour.
    expect(xml).toMatch(/w:ascii="Brush Script MT"[^]*?<w:color w:val="091753"\/><w:sz w:val="72"\/>[^]*?Example Firm/);
    // Reference line bold 14pt; gold separator.
    expect(xml).toMatch(/<w:b\/><w:bCs\/><w:sz w:val="28"\/>[^]*?\[1456\]/);
    expect(xml).toContain('<w:color w:val="746425"/>');
  });

  it("omits optional parts and keeps the phone line for a one-line address", () => {
    const xml = readPart(
      buildLetterOnLetterhead(letterhead(), { date: "2 July 2026", addressee: ["Insurer Pty Ltd"], salutation: "Sir/Madam", body: ["Text."] }, { ...PROFILE, closing: "Yours sincerely" }),
      "word/document.xml",
    );
    const text = docxText(xml);
    expect(text).not.toContain("Contact Ref");
    expect(text).not.toContain("By email");
    expect(text).not.toContain("Encl.");
    expect(text).toContain("\t\t(08) 0000 0000");
    expect(text).toContain("Yours sincerely");
  });

  it("refuses a letterhead without section properties", () => {
    const zip = new PizZip(letterhead());
    zip.file("word/document.xml", '<w:document xmlns:w="w"><w:body><w:p/></w:body></w:document>');
    const bad = zip.generate({ type: "uint8array" });
    expect(() => buildLetterOnLetterhead(bad, LETTER, PROFILE)).toThrow(LetterheadError);
    expect(() => buildLetterOnLetterhead(letterhead(), { ...LETTER, body: [] }, PROFILE)).toThrow(/no body/);
  });
});
