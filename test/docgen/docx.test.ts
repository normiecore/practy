import { describe, expect, it } from "vitest";
import {
  docxText,
  fillTagged,
  getDocumentXml,
  openDocx,
  parseXml,
  replaceTextPattern,
  replaceTokens,
  saveDocx,
  serializeXml,
  setDocumentXml,
  xmlEscape,
  xmlUnescape,
} from "../../src/docgen/docx.js";
import { makeDocx, p, r, readPart } from "./fixtures.js";

const wrap = (body: string) => `<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`;

describe("xml helpers", () => {
  it("escapes and unescapes", () => {
    expect(xmlEscape(`a & b < c > "d"`)).toBe("a &amp; b &lt; c &gt; &quot;d&quot;");
    expect(xmlUnescape("&amp;&lt;&gt;&quot;&apos;&#8211;&#x2013;")).toBe(`&<>"'––`);
  });

  it("round-trips a document part unchanged", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="w"><!-- c --><w:body><w:p w:rsidR="00A1"><w:r><w:t xml:space="preserve"> a &amp; b </w:t></w:r><w:r><w:t>x &gt; y</w:t></w:r></w:p><w:p/></w:body></w:document>`;
    expect(serializeXml(parseXml(xml))).toBe(xml);
  });

  it("opens, edits and saves a docx", () => {
    const zip = openDocx(makeDocx({ body: p(r("Hello")) }));
    setDocumentXml(zip, getDocumentXml(zip).replace("Hello", "Goodbye"));
    expect(docxText(readPart(saveDocx(zip), "word/document.xml"))).toBe("Goodbye");
    expect(() => openDocx(new Uint8Array([1, 2, 3]))).toThrow(/Not a readable/);
  });
});

describe("replaceTokens", () => {
  it("replaces tokens split across runs, keeping the first run's formatting", () => {
    const xml = wrap(p(r("Dear "), r("{{CLI", "<w:b/>"), r("ENT_NA", "<w:i/>"), r("ME}}, welcome")));
    const out = replaceTokens(xml, { "{{CLIENT_NAME}}": "Jane & Co" });
    expect(out.replaced["{{CLIENT_NAME}}"]).toBe(1);
    expect(docxText(out.xml)).toBe("Dear Jane & Co, welcome");
    // The value sits in the bold run where the token started.
    expect(out.xml).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Jane &amp; Co</w:t>');
  });

  it("replaces several tokens in one run and repeated tokens", () => {
    const xml = wrap(p(r("{{A}} and {{B}} and {{A}}")) + p(r("{{"), r("A}}")));
    const out = replaceTokens(xml, { "{{A}}": "x", "{{B}}": "y" });
    expect(docxText(out.xml)).toBe("x and y and x\nx");
    expect(out.replaced).toEqual({ "{{A}}": 3, "{{B}}": 1 });
  });

  it("does not match across paragraphs and reports misses", () => {
    const xml = wrap(p(r("{{A")) + p(r("}}")));
    const out = replaceTokens(xml, { "{{A}}": "x" });
    expect(out.replaced["{{A}}"]).toBe(0);
    expect(out.xml).toBe(xml);
  });

  it("supports regex patterns with a limit", () => {
    const xml = wrap(p(r("other terms: "), r("_____")) + p(r("other terms: ___")));
    const out = replaceTextPattern(xml, /(other terms:)\s*_+/, "$1 none", 1);
    expect(out.count).toBe(1);
    expect(docxText(out.xml)).toBe("other terms: none\nother terms: ___");
  });
});

describe("fillTagged", () => {
  const template = () =>
    makeDocx({
      body: [p(r("Dear {{"), r("name}},")), p(r("{{#items}}")), p(r("- {{label}}: {{amount}}")), p(r("{{/items}}")), p(r("{{^paid}}Unpaid{{/paid}}"))].join(""),
    });

  it("fills tags, paragraph loops and inverted sections", () => {
    const out = fillTagged(template(), { name: "Jane", items: [{ label: "Costs", amount: "$1.00" }, { label: "Disb", amount: "$2.00" }], paid: false });
    expect(docxText(readPart(out, "word/document.xml"))).toBe("Dear Jane,\n- Costs: $1.00\n- Disb: $2.00\nUnpaid");
  });

  it("refuses to leave tags unfilled unless asked", () => {
    expect(() => fillTagged(template(), { items: [], paid: true })).toThrow(/no value: name/);
    const out = fillTagged(template(), { items: [], paid: true }, { missing: "blank" });
    expect(docxText(readPart(out, "word/document.xml"))).toBe("Dear ,\n");
  });

  it("reports template syntax errors", () => {
    expect(() => fillTagged(makeDocx({ body: p(r("{{#open}} never closed")) }), {})).toThrow(/Template error/);
  });
});
