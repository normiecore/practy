/**
 * Particulars / schedule of damages (WA District Court r 45C(3)) in the Stott CPC-A1
 * layout: Times New Roman 12; numbered heads with lettered paragraphs; indented
 * calculation lines; tables; a two-column summary with a ruled total line and the
 * refundable statutory compensation sentence; optional mediation header; "Page X of Y".
 *
 * ParticularsDocument is presentational: every figure arrives as a display string.
 * The damages engine (src/damages) owns the arithmetic and maps onto this model, so
 * the workings, tables and summary come from one source and cannot drift.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type IBorderOptions,
} from "docx";

export interface CourtHeading {
  /** e.g. "IN THE DISTRICT COURT OF WESTERN AUSTRALIA" */
  court: string;
  /** e.g. "HELD AT PERTH" */
  registry?: string;
  /** e.g. "CIV 1234 of 2025" */
  actionNumber: string;
  parties: { name: string; role: string }[];
}

export interface AmountLine {
  label: string;
  /** Display string, e.g. "$164,399.57". */
  amount: string;
}

export interface ParticularsTable {
  kind: "table";
  caption?: string;
  columns: { header: string; align?: "left" | "right" | "center"; /** Relative width. */ weight?: number }[];
  rows: string[][];
  /** Bold total row, same column count. */
  total?: string[];
}

export type ParticularsBlock =
  /** A sub-head such as "1.1 Past loss". */
  | { kind: "section"; number: string; title: string; blocks: ParticularsBlock[]; amount?: AmountLine }
  /** A lettered paragraph "(a) …"; nested blocks (calc lines, tables) sit under it. */
  | { kind: "paragraph"; label?: string; text: string; blocks?: ParticularsBlock[] }
  /** An indented working line, e.g. "130.29 weeks x $1,264.25 (net weekly wage) = $164,399.57". */
  | { kind: "calc"; text: string }
  | ParticularsTable
  /** A label with a right-aligned bold amount, e.g. "Total past loss of earning capacity". */
  | ({ kind: "amount" } & AmountLine);

export interface ParticularsHead {
  /** "1", "2" … */
  number: string;
  title: string;
  blocks: ParticularsBlock[];
  /** The head's figure, shown at its end. */
  amount?: AmountLine;
}

export interface ParticularsSummary {
  heading?: string;
  /** level 0 = numbered head, level 1 = indented sub-item. */
  rows: { label: string; amount?: string; level?: 0 | 1 }[];
  total: AmountLine;
  /** e.g. "The total includes $X of statutory compensation refundable to the insurer; the net figure is $Y." */
  notes?: string[];
}

export interface ParticularsDocument {
  heading: CourtHeading;
  /** Title lines, ruled above and below, e.g. ["PLAINTIFF'S PARTICULARS OF DAMAGES"]. */
  title: string[];
  /** Borderless "Date of document / Filed on behalf of / Prepared by …" block. */
  details?: { label: string; value: string | string[] }[];
  /** Opening line citing r 45C(3), the calculation date and what it supersedes. */
  intro: string;
  /** e.g. "CONFIDENTIAL FOR THE PURPOSES OF MEDIATION ONLY". */
  confidentialHeader?: string;
  heads: ParticularsHead[];
  summary: ParticularsSummary;
  /** Signature block lines, kept on the page with the total. */
  signature?: string[];
}

const FONT = "Times New Roman";
const SIZE = 24;
const TEXT_W = 9026; // A4 less 1-inch margins, in twips
const STEP = 720;

const run = (text: string, o: { bold?: boolean; italics?: boolean } = {}) => new TextRun({ text, font: FONT, size: SIZE, bold: !!o.bold, italics: !!o.italics });
const rule: IBorderOptions = { style: BorderStyle.SINGLE, size: 8, color: "000000", space: 4 };
const thin: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const none: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const rightTab = [{ type: TabStopType.RIGHT, position: TEXT_W }];

function numbered(label: string, text: string, left: number, o: { bold?: boolean; keepNext?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [run(`${label}\t`, { bold: !!o.bold }), run(text, { bold: !!o.bold })],
    indent: { left, hanging: STEP },
    tabStops: [{ type: TabStopType.LEFT, position: left }],
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120 },
    keepNext: !!o.keepNext,
  });
}

function amountPara(a: AmountLine, left: number, o: { keepNext?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [run(a.label, { bold: true }), run(`\t${a.amount}`, { bold: true })],
    indent: { left },
    tabStops: rightTab,
    spacing: { before: 60, after: 200 },
    keepNext: !!o.keepNext,
  });
}

function table(t: ParticularsTable, left: number): (Paragraph | Table)[] {
  const width = TEXT_W - left;
  const weights = t.columns.map((c) => c.weight ?? 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.floor((width * w) / sum));
  const align = (i: number) => {
    const a = t.columns[i]?.align ?? "left";
    return a === "right" ? AlignmentType.RIGHT : a === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;
  };
  const cell = (text: string, i: number, bold: boolean) =>
    new TableCell({
      width: { size: widths[i]!, type: WidthType.DXA },
      borders: { top: thin, bottom: thin, left: thin, right: thin },
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [new Paragraph({ alignment: align(i), children: [run(text, { bold })] })],
    });
  for (const r of [...t.rows, ...(t.total ? [t.total] : [])]) {
    if (r.length !== t.columns.length) throw new Error(`Table row has ${r.length} cells but ${t.columns.length} columns: ${r.join(" | ")}`);
  }
  const out: (Paragraph | Table)[] = [];
  if (t.caption) out.push(new Paragraph({ indent: { left }, keepNext: true, spacing: { after: 60 }, children: [run(t.caption, { italics: true })] }));
  out.push(
    new Table({
      width: { size: width, type: WidthType.DXA },
      columnWidths: widths,
      indent: { size: left, type: WidthType.DXA },
      rows: [
        new TableRow({ tableHeader: true, children: t.columns.map((c, i) => cell(c.header, i, true)) }),
        ...t.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((v, i) => cell(v, i, false)) })),
        ...(t.total ? [new TableRow({ cantSplit: true, children: t.total.map((v, i) => cell(v, i, true)) })] : []),
      ],
    }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  );
  return out;
}

/** Blocks at a given text indent (the left edge of text under the parent). */
function blocks(list: ParticularsBlock[], left: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const b of list) {
    switch (b.kind) {
      case "section":
        out.push(numbered(b.number, b.title, left + STEP, { bold: true, keepNext: true }));
        out.push(...blocks(b.blocks, left + STEP));
        if (b.amount) out.push(amountPara(b.amount, left + STEP));
        break;
      case "paragraph":
        out.push(
          b.label
            ? numbered(b.label, b.text, left + STEP, { keepNext: !!b.blocks?.length })
            : new Paragraph({ indent: { left }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 }, keepNext: !!b.blocks?.length, children: [run(b.text)] }),
        );
        if (b.blocks) out.push(...blocks(b.blocks, b.label ? left + STEP : left));
        break;
      case "calc":
        out.push(new Paragraph({ indent: { left: left + STEP }, spacing: { after: 80 }, children: [run(b.text)] }));
        break;
      case "table":
        out.push(...table(b, left));
        break;
      case "amount":
        out.push(amountPara(b, left));
        break;
    }
  }
  return out;
}

function courtHeading(h: CourtHeading): Paragraph[] {
  const out: Paragraph[] = [
    new Paragraph({ children: [run(h.court, { bold: true })] }),
    new Paragraph({ tabStops: rightTab, spacing: { after: 240 }, children: [run(h.registry ?? "", { bold: true }), run(`\t${h.actionNumber}`, { bold: true })] }),
    new Paragraph({ spacing: { after: 240 }, children: [run("BETWEEN")] }),
  ];
  h.parties.forEach((p, i) => {
    if (i) out.push(new Paragraph({ spacing: { after: 240 }, children: [run("and")] }));
    out.push(new Paragraph({ tabStops: rightTab, spacing: { after: 240 }, children: [run(p.name, { bold: true }), run(`\t${p.role}`)] }));
  });
  return out;
}

export async function renderParticulars(doc: ParticularsDocument): Promise<Uint8Array> {
  const body: (Paragraph | Table)[] = [...courtHeading(doc.heading)];

  doc.title.forEach((line, i, all) =>
    body.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: i ? 0 : 240, after: i === all.length - 1 ? 240 : 0 },
        border: { ...(i === 0 ? { top: rule } : {}), ...(i === all.length - 1 ? { bottom: rule } : {}) },
        children: [run(line, { bold: true })],
      }),
    ),
  );

  if (doc.details?.length) {
    const noB = { top: none, bottom: none, left: none, right: none };
    const cell = (v: string | string[], w: number) =>
      new TableCell({ borders: noB, width: { size: w, type: WidthType.DXA }, children: (Array.isArray(v) ? v : [v]).map((t) => new Paragraph({ children: [run(t)] })) });
    body.push(
      new Table({
        width: { size: TEXT_W, type: WidthType.DXA },
        columnWidths: [2800, TEXT_W - 2800],
        borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
        rows: doc.details.map((d) => new TableRow({ children: [cell(d.label, 2800), cell(d.value, TEXT_W - 2800)] })),
      }),
      new Paragraph({ children: [] }),
    );
  }

  body.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 240 }, children: [run(doc.intro)] }));

  for (const head of doc.heads) {
    body.push(numbered(`${head.number}.`, head.title.toUpperCase(), STEP, { bold: true, keepNext: true }));
    body.push(...blocks(head.blocks, STEP));
    if (head.amount) body.push(amountPara(head.amount, STEP));
  }

  // Summary: head and sub-items with right-aligned amounts, then a ruled total.
  const s = doc.summary;
  body.push(new Paragraph({ spacing: { before: 240, after: 120 }, keepNext: true, children: [run(s.heading ?? "SUMMARY", { bold: true })] }));
  for (const row of s.rows) {
    body.push(
      new Paragraph({
        tabStops: rightTab,
        indent: { left: (row.level ?? 0) * STEP },
        spacing: { after: 60 },
        keepNext: true,
        children: [run(row.label, { bold: (row.level ?? 0) === 0 }), ...(row.amount ? [run(`\t${row.amount}`)] : [])],
      }),
    );
  }
  const signature = doc.signature ?? [];
  const notes = s.notes ?? [];
  body.push(
    new Paragraph({
      tabStops: rightTab,
      border: { top: rule, bottom: rule },
      spacing: { before: 120, after: 240 },
      keepNext: notes.length + signature.length > 0,
      keepLines: true,
      children: [run(s.total.label, { bold: true }), run(`\t${s.total.amount}`, { bold: true })],
    }),
  );
  notes.forEach((n, i) =>
    body.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 240 }, keepNext: i < notes.length - 1 || signature.length > 0, keepLines: true, children: [run(n)] })),
  );
  signature.forEach((line, i) => body.push(new Paragraph({ keepNext: i < signature.length - 1, keepLines: true, children: [run(line)] })));

  const document = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        ...(doc.confidentialHeader
          ? { headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(doc.confidentialHeader, { bold: true })] })] }) } }
          : {}),
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ font: FONT, size: 20, children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES] })] })],
          }),
        },
        children: body,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
