import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { extractTextItems } from "unpdf";
import {
  A4,
  buildMasterBook,
  emailToPdf,
  formatSent,
  htmlToBlocks,
  pdfPageTexts,
  planHouseAffidavit,
  renderHouseIndex,
  type HouseIndexRow,
} from "../../src/docgen/pdf.js";

/** A PDF whose pages say "<name> page N"; optional page size and rotation. */
async function makePdf(name: string, pages: number, size: [number, number] = A4, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage(size);
    if (rotate) p.setRotation({ type: "degrees", angle: rotate } as never);
    p.drawText(`${name} page ${i}`, { x: 60, y: size[1] / 2, size: 14, font });
  }
  return doc.save();
}

/** Text items on a page, for position checks (y from the bottom). */
async function items(bytes: Uint8Array, page: number) {
  const { items } = await extractTextItems(new Uint8Array(bytes));
  return items[page - 1]!;
}

/** The text drawn near the top-right corner of a page (the page-number stamp). */
async function topRight(bytes: Uint8Array, page: number): Promise<string | undefined> {
  const its = await items(bytes, page);
  return its.find((i) => i.x > A4[0] - 120 && i.y > A4[1] - 60 && /^\d+$/.test(i.str.trim()))?.str.trim();
}

const outlineTitles = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  const outlines = doc.catalog.lookup(PDFName.of("Outlines"), PDFDict);
  const titles: string[] = [];
  let item = outlines.lookupMaybe(PDFName.of("First"), PDFDict);
  while (item) {
    titles.push(item.lookup(PDFName.of("Title"))!.toString());
    item = item.lookupMaybe(PDFName.of("Next"), PDFDict);
  }
  return titles;
};

const linkCount = async (bytes: Uint8Array, page: number) => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPage(page - 1).node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.size() ?? 0;
};

describe("buildMasterBook: book", () => {
  it("adds a cover and a table of contents whose page numbers match the stamps", async () => {
    const out = await buildMasterBook({
      mode: "book",
      title: "Book of Payslips",
      subtitle: "Sam Plaintiff",
      date: "1 November 2026",
      documents: [
        { bytes: await makePdf("Alpha", 2), displayName: "Alpha payslips" },
        { bytes: await makePdf("Beta", 3), displayName: "Beta payslips" },
        { bytes: await makePdf("Gamma", 1), displayName: "Gamma letter" },
      ],
    });
    expect(out.pageCount).toBe(8);
    const texts = await pdfPageTexts(out.bytes);
    expect(texts).toHaveLength(8);
    expect(texts[0]).toContain("Book of Payslips");
    expect(texts[0]).toContain("1 November 2026");
    expect(texts[1]).toContain("TABLE OF CONTENTS");
    expect(out.entries).toEqual([
      { label: "Alpha payslips", page: "3" },
      { label: "Beta payslips", page: "5" },
      { label: "Gamma letter", page: "8" },
    ]);
    // The index cites the real position, and that page carries the document and the stamp.
    for (const e of out.entries) {
      expect(texts[1]).toMatch(new RegExp(`${e.label}\\s+${e.page}`));
      expect(texts[Number(e.page) - 1]).toContain(`${e.label.split(" ")[0]} page 1`);
    }
    // absolute-content: stamps only after the front matter, bottom centre.
    for (let p = 3; p <= 8; p++) expect(texts[p - 1]).toMatch(new RegExp(`(^|\\s)${p}(\\s|$)`));
    expect((await items(out.bytes, 1)).filter((i) => /^\d+$/.test(i.str.trim()))).toEqual([]);
    expect((await items(out.bytes, 2)).filter((i) => i.y < 40)).toEqual([]);
    const stamp = (await items(out.bytes, 4)).find((i) => i.str.trim() === "4")!;
    expect(stamp.y).toBeLessThan(40);
    expect(Math.abs(stamp.x + stamp.width / 2 - A4[0] / 2)).toBeLessThan(5);

    expect(await outlineTitles(out.bytes)).toHaveLength(3);
    expect(await linkCount(out.bytes, 2)).toBe(3);
  });

  it("refuses an empty book and out-of-range index rows", async () => {
    await expect(buildMasterBook({ mode: "book", title: "x", documents: [] })).rejects.toThrow(/No documents/);
    await expect(
      buildMasterBook({ mode: "book", title: "x", documents: [{ bytes: await makePdf("A", 1), displayName: "A", tocEntries: [{ label: "A2", page: 2 }] }] }),
    ).rejects.toThrow(/outside 1..1/);
    await expect(buildMasterBook({ mode: "book", title: "x", documents: [{ bytes: new Uint8Array([1, 2]), displayName: "Broken scan" }] })).rejects.toThrow(/"Broken scan"/);
  });
});

describe("buildMasterBook: court form", () => {
  it("renders INDEX DETAILS with absolute top-right numbering over a multi-page index", async () => {
    const exhibit = await makePdf("Exhibit", 3);
    const many = await Promise.all(Array.from({ length: 30 }, (_, i) => makePdf(`Doc${i + 1}`, 1)));
    const out = await buildMasterBook({
      mode: "court",
      courtForm: {
        court: "District Court of Western Australia",
        heldAt: "Perth",
        fileNumber: "CIV No: 2380 of 2021",
        formTitle: "Affidavit in Response",
        parties: [
          { name: "Sam Plaintiff", role: "Plaintiff" },
          { name: "Example Company Pty Ltd (ACN 000 000 000)", role: "Defendant" },
        ],
        personMaking: "Sam Deponent",
        dateMade: "2 March 2026",
        purpose: "In response to the defendant's application",
        filedBy: "Plaintiff",
      },
      documents: [
        { bytes: await makePdf("Affidavit", 2), displayName: "Affidavit of Sam Deponent" },
        {
          bytes: exhibit,
          displayName: "Attachments SD1-SD2",
          tocEntries: [
            { label: "Attachment SD1 – first exhibit", page: 1 },
            { label: "Attachment SD2 – second exhibit", page: 3 },
          ],
        },
        ...many.map((bytes, i) => ({ bytes, displayName: `Attachment SD${i + 3} – document ${i + 1}` })),
      ],
    });
    const texts = await pdfPageTexts(out.bytes);
    const indexPages = out.pageCount - 2 - 3 - 30;
    expect(indexPages).toBeGreaterThan(1);
    expect(texts[0]).toContain("INDEX DETAILS");
    expect(texts[0]).toMatch(/Person making\s+affidavit\s+Sam Deponent/);
    expect(texts[0]).toContain("CIV No: 2380 of 2021");
    // No cover; every page after the first is stamped top-right with its real position.
    expect(await topRight(out.bytes, 1)).toBeUndefined();
    for (const p of [2, indexPages + 1, out.pageCount]) expect(await topRight(out.bytes, p)).toBe(String(p));
    // Index rows cite where each document starts, including rows pointing into one PDF.
    const sd2 = out.entries.find((e) => e.label.startsWith("Attachment SD2"))!;
    expect(texts[Number(sd2.page) - 1]).toContain("Exhibit page 3");
    const last = out.entries[out.entries.length - 1]!;
    expect(last.page).toBe(String(out.pageCount));
    expect(texts[out.pageCount - 1]).toContain("Doc30 page 1");
    expect(texts.slice(0, indexPages).join("\n")).toMatch(/Attachment SD32 – document 30\s+\d+/);
  });

  it("requires court details", async () => {
    await expect(buildMasterBook({ mode: "court", courtForm: {}, documents: [{ bytes: await makePdf("A", 1), displayName: "A" }] })).rejects.toThrow(/court-form index needs/);
  });

  it("stamps rotated and cropped pages on the visible page", async () => {
    const out = await buildMasterBook({
      mode: "court",
      courtForm: { fileNumber: "CIV 1 of 2026" },
      documents: [
        { bytes: await makePdf("Landscape", 1, A4, 90), displayName: "Rotated plan" },
        { bytes: await makePdf("Letter", 1, [612, 792]), displayName: "US letter page" },
      ],
    });
    const texts = await pdfPageTexts(out.bytes);
    expect(texts[1]).toMatch(/(^|\s)2(\s|$)/);
    expect(texts[2]).toMatch(/(^|\s)3(\s|$)/);
  });
});

describe("buildMasterBook: house-style affidavit", () => {
  const email = () =>
    emailToPdf({
      from: "Opponent Lawyer <lawyer@example.test>",
      to: ["Alex Solicitor <alex@example.test>"],
      sent: "2026-03-02T02:05:56Z",
      subject: "Offer",
      html: "<p>We are instructed to accept.</p>",
    });

  it("numbers continuously, labels each annexure and fills the index ranges", async () => {
    let renders = 0;
    const affidavit = async (rows: HouseIndexRow[]) => {
      renders++;
      // The index plus two pages of the affidavit's own paragraphs.
      const index = await PDFDocument.load(await renderHouseIndex(rows, ["AFFIDAVIT OF SAM DEPONENT"]));
      const body = await PDFDocument.load(await makePdf("Affidavit body", 2));
      for (const p of await index.copyPages(body, [0, 1])) index.addPage(p);
      return index.save();
    };
    const out = await buildMasterBook({
      mode: "house",
      affidavit,
      affidavitTitle: "Affidavit of Sam Deponent",
      affidavitNumbered: false,
      markPrefix: "SD",
      firstMarkNumber: 8,
      annexures: [
        { description: "Letter to the insurer", sources: [{ bytes: await makePdf("Letter", 2) }] },
        { description: "Email accepting the offer and attachment", sources: [{ bytes: await email(), layout: "house-email" }, { bytes: await makePdf("Attachment", 1) }] },
        { mark: "SD10", description: "Medical report", sources: [{ bytes: await makePdf("Report", 3, [612, 792]) }] },
      ],
    });
    expect(renders).toBeGreaterThanOrEqual(1);
    expect(out.plan!.indexRows).toEqual([
      { no: 1, annexure: "", document: "Affidavit of Sam Deponent", pages: "1 to 3" },
      { no: 2, annexure: "SD8", document: "Letter to the insurer", pages: "4 to 5" },
      { no: 3, annexure: "SD9", document: "Email accepting the offer and attachment", pages: "6 to 7" },
      { no: 4, annexure: "SD10", document: "Medical report", pages: "8 to 10" },
    ]);
    expect(out.pageCount).toBe(10);
    const texts = await pdfPageTexts(out.bytes);
    expect(texts).toHaveLength(10);
    // The index on page 1 carries the ranges.
    expect(texts[0]).toMatch(/SD8\s+Letter to the insurer\s+4 to 5/);
    expect(texts[0]).toMatch(/SD10\s+Medical report\s+8 to 10/);
    // Every page numbered top-right, continuously.
    for (let p = 1; p <= 10; p++) expect(await topRight(out.bytes, p)).toBe(String(p));
    // Label only on each annexure's first page.
    const labelled = texts.map((t, i) => (t.includes("Annexure “") || t.includes('Annexure "') ? i + 1 : 0)).filter(Boolean);
    expect(labelled).toEqual([4, 6, 8]);
    expect(texts[3]).toContain('Annexure "SD8"');
    expect(texts[5]).toContain("We are instructed to accept.");
    expect(texts[7]).toContain("Report page 1");
    // Scaled documents sit on A4.
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPage(7).getSize()).toEqual({ width: A4[0], height: A4[1] });
    expect(await outlineTitles(out.bytes)).toHaveLength(4);
  });

  it("uses the affidavit's own numbers when it already prints them", async () => {
    const out = await buildMasterBook({
      mode: "house",
      affidavit: await makePdf("Affidavit", 2),
      annexures: [{ mark: "KW1", description: "Letter", sources: [{ bytes: await makePdf("Letter", 1) }] }],
    });
    expect(await topRight(out.bytes, 1)).toBeUndefined();
    expect(await topRight(out.bytes, 3)).toBe("3");
    expect(out.plan!.annexures[0]).toMatchObject({ mark: "KW1", first: 3, last: 3, pages: "3" });
  });

  it("plans page ranges without building", () => {
    expect(planHouseAffidavit(4, [{ mark: "KW8", description: "a", pages: 4 }, { mark: "KW9", description: "b", pages: 1 }]).annexures.map((a) => a.pages)).toEqual(["5 to 8", "9"]);
  });
});

describe("emailToPdf", () => {
  it("prints headers, keeps Outlook list numbering, drops hidden text and paginates", async () => {
    const paras = Array.from({ length: 70 }, (_, i) => `<p>Paragraph ${i + 1} of the quoted chain with enough words to wrap across the width of the page when printed.</p>`).join("");
    const html = `<html><head><style>p{}</style></head><body>
      <div style="display:none">Preview text that must not print</div>
      <span style="font-size:1pt">tiny</span>
      <p>Dear Alex,</p>
      <ol start="3"><li>Third point &amp; more</li></ol>
      <ol start="4"><li>Fourth point<ol type="a"><li>sub a</li><li>sub b</li></ol></li></ol>
      <p><b>Bold</b> and <u>underlined</u> and a link <https://example.test/x></p>
      <blockquote>Quoted reply text</blockquote>
      ${paras}</body></html>`;
    const bytes = await emailToPdf({
      from: "Opponent Lawyer <lawyer@example.test>",
      to: ["Alex Solicitor <alex@example.test>", "Second <second@example.test>"],
      cc: "cc@example.test",
      sent: "2026-03-02T02:05:56Z",
      subject: "Settlement   offer",
      attachments: ["Letter.pdf", "Schedule.pdf"],
      html,
    });
    const texts = await pdfPageTexts(bytes);
    expect(texts.length).toBeGreaterThan(1);
    const first = texts[0]!;
    expect(first).toMatch(/From:\s*Opponent Lawyer <lawyer@example.test>/);
    expect(first).toContain("Monday, 2 March 2026 10:05 am (AWST)");
    expect(first).toContain("Subject: Settlement offer");
    expect(first).toContain("Attachments: Letter.pdf; Schedule.pdf");
    expect(first).toContain("3. Third point & more");
    expect(first).toContain("4. Fourth point");
    expect(first).toMatch(/a\.\s*sub a/);
    expect(first).toMatch(/b\.\s*sub b/);
    expect(first).toContain("Quoted reply text");
    expect(first).not.toContain("Preview text");
    expect(first).not.toContain("tiny");
    expect(first).not.toContain("https://example.test");
    expect(texts.join("\n")).toContain("Paragraph 70 of the quoted chain");
    // The top 4.2 cm stays clear on every page for the annexure label and number.
    for (let p = 1; p <= texts.length; p++) {
      for (const it of await items(bytes, p)) expect(it.y).toBeLessThan(A4[1] - 4.2 * 28.3465 + 1);
    }
  });

  it("falls back to plain text and folds characters the standard font cannot encode", async () => {
    const bytes = await emailToPdf({ from: "Zoë Ł <z@example.test>", sent: "already formatted", subject: "Re: plan", text: "Line one\n\n\n\n> \n>\nLine two 你好" });
    const text = (await pdfPageTexts(bytes))[0]!;
    expect(text).toContain("Zoë L <z@example.test>");
    expect(text).toContain("Sent: already formatted");
    expect(text).toMatch(/Line one\s+Line two \?\?/);
  });

  it("formats the sent time in the given zone", () => {
    expect(formatSent(new Date("2026-07-01T00:30:00Z"), "Australia/Perth")).toBe("Wednesday, 1 July 2026 8:30 am (AWST)");
    expect(formatSent("2026-07-01T00:30:00Z", "Australia/Sydney")).toMatch(/^Wednesday, 1 July 2026 10:30 am \(AEST\)$/);
  });

  it("parses lists and nested structure", () => {
    const blocks = htmlToBlocks('<ol start="7"><li>seven</li><li>eight</li></ol><ul><li>dot</li></ul>');
    expect(blocks.filter((b) => b.runs.length).map((b) => [b.bullet, b.runs.map((r) => r.text).join("")])).toEqual([
      ["7.", "seven"],
      ["8.", "eight"],
      ["•", "dot"],
    ]);
  });
});

describe("pdfPageTexts", () => {
  it("returns one string per page", async () => {
    expect(await pdfPageTexts(await makePdf("Doc", 3))).toEqual(["Doc page 1", "Doc page 2", "Doc page 3"]);
  });
});
