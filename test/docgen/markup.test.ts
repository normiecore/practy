import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { docxText } from "../../src/docgen/docx.js";
import { MarkupError, residualRevisions, tracksToMarkup } from "../../src/docgen/markup.js";
import { makeDocx, readPart } from "./fixtures.js";

const A = 'w:id="1" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"';

const BODY = [
  // Plain text, an insertion (bold run), a deletion and a run with a format change.
  `<w:p><w:r><w:t xml:space="preserve">The plaintiff </w:t></w:r>`,
  `<w:ins ${A}><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">urgently </w:t></w:r></w:ins>`,
  `<w:del ${A}><w:r><w:delText xml:space="preserve">quickly </w:delText></w:r></w:del>`,
  `<w:r><w:rPr><w:i/><w:rPrChange ${A}><w:rPr/></w:rPrChange></w:rPr><w:t>claims.</w:t></w:r></w:p>`,
  // Paragraph-mark deletion, a move, churn, and range markers.
  `<w:p><w:pPr><w:pPrChange ${A}><w:pPr/></w:pPrChange><w:rPr><w:del ${A}/></w:rPr></w:pPr>`,
  `<w:moveFromRangeStart w:id="5" w:name="m1"/><w:moveFrom ${A}><w:r><w:t>Old place.</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="5"/>`,
  `<w:moveToRangeStart w:id="6" w:name="m1"/><w:moveTo ${A}><w:r><w:t>New place.</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="6"/>`,
  `<w:ins ${A}><w:del ${A}><w:r><w:delText>churn</w:delText></w:r></w:del></w:ins>`,
  `<w:r><w:commentReference w:id="0"/></w:r></w:p>`,
].join("");

const SETTINGS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackChanges/><w:zoom w:percent="100"/></w:settings>';

function tracked(): Uint8Array {
  return makeDocx({
    body: BODY,
    settings: SETTINGS,
    extraParts: { "word/comments.xml": '<w:comments xmlns:w="w"><w:comment w:id="0"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>' },
    extraRels: '<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
    extraContentTypes: '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
  });
}

describe("tracksToMarkup", () => {
  it("styles insertions and deletions, keeps deleted text and strips all revision markup", () => {
    const { bytes, report } = tracksToMarkup(tracked());
    const xml = readPart(bytes, "word/document.xml");
    expect(residualRevisions(xml)).toEqual([]);
    expect(xml).not.toMatch(/<w:(ins|del|moveFrom|moveTo|rPrChange|pPrChange|delText)\b/);
    expect(xml).not.toMatch(/RangeStart|RangeEnd/);

    expect(docxText(xml)).toBe("The plaintiff urgently quickly claims.\nOld place.New place.");
    // Insertion: existing bold and size kept, colour and underline added in schema order.
    expect(xml).toContain('<w:rPr><w:b/><w:color w:val="FF0000"/><w:sz w:val="24"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">urgently </w:t>');
    // Deletion: text kept as w:t with strike.
    expect(xml).toContain('<w:rPr><w:strike/><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">quickly </w:t>');
    // Format change accepted: current italics kept.
    expect(xml).toContain("<w:rPr><w:i/></w:rPr><w:t>claims.</w:t>");
    expect(report).toMatchObject({ insertionsStyled: 2, deletionsStyled: 2, churnRunsDropped: 1, formatChangesAccepted: 2, trackChangesSettingRemoved: 1 });
    expect(readPart(bytes, "word/settings.xml")).not.toContain("trackChanges");
    // Comments are left alone by default.
    expect(new PizZip(bytes).file("word/comments.xml")).not.toBeNull();
  });

  it("uses the requested colour", () => {
    const xml = readPart(tracksToMarkup(tracked(), { color: "#0000ff" }).bytes, "word/document.xml");
    expect(xml).toContain('<w:color w:val="0000FF"/>');
    expect(() => tracksToMarkup(tracked(), { color: "blue" })).toThrow(MarkupError);
  });

  it("strips comments with their relationships when asked", () => {
    const { bytes, report } = tracksToMarkup(tracked(), { stripComments: true });
    const zip = new PizZip(bytes);
    expect(zip.file("word/comments.xml")).toBeNull();
    expect(readPart(bytes, "word/document.xml")).not.toContain("commentReference");
    expect(readPart(bytes, "word/_rels/document.xml.rels")).not.toContain("comments.xml");
    expect(readPart(bytes, "[Content_Types].xml")).not.toContain("comments.xml");
    expect(report.commentPartsDropped).toBe(1);
    expect(report.commentMarkersRemoved).toBe(1);
  });

  it("also cleans headers and footers", () => {
    const src = new PizZip(tracked());
    src.file("word/footer1.xml", `<w:ftr xmlns:w="w"><w:p><w:ins ${A}><w:r><w:t>Amended</w:t></w:r></w:ins></w:p></w:ftr>`);
    const out = tracksToMarkup(src.generate({ type: "uint8array" })).bytes;
    expect(residualRevisions(readPart(out, "word/footer1.xml"))).toEqual([]);
    expect(readPart(out, "word/footer1.xml")).toContain('<w:u w:val="single"/>');
  });
});
