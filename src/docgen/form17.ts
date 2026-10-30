/**
 * WA List of Documents (Form No. 17, RSC 1971 O. 26) as a .docx.
 *
 * The court form is fixed, so the layout rules are not options: Times New Roman 11pt
 * (12pt Part headings), no shading, thin black single borders, A4 with 1-inch margins,
 * a header row whose left cell is wider than the body label column, a Part 1A table
 * numbered continuously across categories with the column-header row only after the
 * first category, then Parts 1B, 2A, 2B and the Notes.
 */
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } from "docx";

export interface Form17Item {
  description: string;
  /** DD.MM.YYYY, "Various" or "Undated". */
  date?: string;
}

export interface Form17Category {
  name: string;
  items: Form17Item[];
}

export interface Form17Config {
  /** The discovering party; default "plaintiff". */
  party?: "plaintiff" | "defendant" | (string & {});
  court?: { nameLines?: string[]; actionNumber?: string };
  parties: { name: string; role: string }[];
  to?: string;
  from?: string;
  firmName?: string;
  inspectionAddress?: string;
  rulesCitation?: string;
  categories: Form17Category[];
  part1bObjections?: { ref: string; grounds: string }[];
  part2a?: { no: string | number; description: string }[];
  part2b?: { no: string | number; date?: string; becomeOf?: string; whoHas?: string }[];
}

const FONT = "Times New Roman";
const SZ = 22;
const SZH = 24;
const line = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const borders = { top: line, bottom: line, left: line, right: line };

interface RunOpts {
  size?: number;
  bold?: boolean;
  italics?: boolean;
  sup?: boolean;
}
const run = (text: string, o: RunOpts = {}) => new TextRun({ text, font: FONT, size: o.size ?? SZ, bold: !!o.bold, italics: !!o.italics, superScript: !!o.sup });

interface ParaOpts {
  before?: number;
  after?: number;
  indent?: { left: number };
}
const para = (children: TextRun | TextRun[], o: ParaOpts = {}) =>
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: o.before ?? 0, after: o.after ?? 0 },
    ...(o.indent ? { indent: o.indent } : {}),
    children: Array.isArray(children) ? children : [children],
  });

const cell = (width: number, children: Paragraph[], o: { span?: number; rowSpan?: number } = {}) =>
  new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    ...(o.span ? { columnSpan: o.span } : {}),
    ...(o.rowSpan ? { rowSpan: o.rowSpan } : {}),
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    children,
  });

const bullet = (text: string) => para(run(`• ${text}`), { indent: { left: 240 } });

export const PRIVILEGED_ITEMS = (party: string): Form17Item[] => [
  {
    description: `Confidential correspondence and copy correspondence passing between the ${party}'s solicitor and the ${party}, for the dominant purpose of obtaining or giving legal advice.`,
    date: "Various",
  },
  {
    description: `Notes, memoranda and other documents, including witness statements, and photographs, made by or obtained by the ${party}, the ${party}'s solicitors for the dominant purpose of obtaining or giving legal advice in these proceedings, or were made for the purpose of conducting these proceedings.`,
    date: "Various",
  },
];

/** Count of itemised documents in Part 1A. */
export const form17ItemCount = (config: Form17Config) => config.categories.reduce((n, c) => n + c.items.length, 0);

export async function buildListOfDocuments(config: Form17Config): Promise<Uint8Array> {
  const party = config.party || "plaintiff";
  const courtNameLines = config.court?.nameLines ?? ["District Court of Western Australia", "Held at Perth"];
  const actionNumber = config.court?.actionNumber ?? "";
  const parties = config.parties ?? [];
  const toLine = config.to ?? "The Defendants and their practitioners.";
  const fromLine = config.from ?? "The Plaintiff";
  const rulesCitation = config.rulesCitation ?? "This list is served in compliance with the Rules of the Supreme Court 1971 Order 26 rule 1(3).";
  const firmName = config.firmName ?? "";
  const inspectionAddress = config.inspectionAddress ?? "";
  const part1bObjections = config.part1bObjections ?? [
    {
      ref: "1 – 2",
      grounds: `The ${party} objects to producing these documents on the grounds of legal professional privilege on the basis that the documents are confidential and were obtained or created in anticipation of, or for the purpose of, the litigation, and/or with the dominant purpose of giving or obtaining legal advice.`,
    },
  ];
  const part2a = config.part2a ?? [];
  const part2b = config.part2b ?? [];

  // Header info table: a 4-column grid so the header row's left cell (2 grid columns)
  // is wider than the body label column (1 grid column).
  const GA = 2300, GB = 3300, GC = 1760, GD = 2000;
  const LBL = GA;
  const CONTENT = GB + GC + GD;
  const HDR_L = GA + GB;
  const HDR_R = GC + GD;
  const CERT_C = GB + GC;

  const infoRow = (label: string, content: Paragraph[]) => new TableRow({ children: [cell(LBL, [para(run(label, { bold: true }))]), cell(CONTENT, content, { span: 3 })] });

  const partiesContent: Paragraph[] = [];
  parties.forEach((pt, i) => {
    partiesContent.push(new Paragraph({ spacing: { after: 0 }, children: [run(pt.name, { bold: true })] }));
    partiesContent.push(new Paragraph({ spacing: { after: i === parties.length - 1 ? 0 : 60 }, indent: { left: 2880 }, children: [run(pt.role)] }));
  });
  if (!partiesContent.length) partiesContent.push(para(run("")));

  const infoTable = new Table({
    width: { size: GA + GB + GC + GD, type: WidthType.DXA },
    columnWidths: [GA, GB, GC, GD],
    rows: [
      new TableRow({ children: [cell(HDR_L, courtNameLines.map((l) => para(run(l))), { rowSpan: 2, span: 2 }), cell(HDR_R, [para(run(`No: ${actionNumber}`))], { span: 2 })] }),
      new TableRow({ children: [cell(HDR_R, [para(run("List of documents", { bold: true }))], { span: 2 })] }),
      infoRow("Parties", partiesContent),
      infoRow("To", [para(run(toLine))]),
      infoRow("From", [para(run(fromLine))]),
      infoRow("General", [para(run(rulesCitation))]),
      new TableRow({
        children: [
          cell(LBL, [para(run("Documents in possession", { bold: true })), para(run("(Part 1)", { bold: true }))]),
          cell(
            CONTENT,
            [
              para(run(`Part 1A of this list lists the documents relating to the matters in question in this action that are in the possession, custody or power of the ${party}.`), { after: 100 }),
              para(run(`Part 1B of this list lists each of those documents listed in Part 1A that the ${party} objects to producing and the grounds for objecting.`)),
            ],
            { span: 3 },
          ),
        ],
      }),
      new TableRow({
        children: [
          cell(LBL, [para(run("Documents no longer in possession", { bold: true })), para(run("(Part 2)", { bold: true }))]),
          cell(
            CONTENT,
            [
              para(run(`Part 2A of this list lists the documents relating to the matters in question in this action that were, but no longer are, in the possession, custody or power of the ${party}.`), { after: 100 }),
              para(run("Part 2B of this list, for each document listed in Part 2A, states —")),
              bullet(`the date on which it was last in the ${party}’s possession, custody or power; and`),
              bullet("what has become of it; and"),
              bullet("who currently has possession or custody of or power over it."),
            ],
            { span: 3 },
          ),
        ],
      }),
      infoRow("Declarations", [
        para(run(`The ${party} has made all reasonable enquiries, including of its employees and agents, to identify all documents of any description whatever relating to any matter in question in this action that are or were in its possession, custody or power.`), { after: 100 }),
        para(run(`Neither the ${party}, nor its practitioner, nor any other person on its behalf, has now, or ever had, possession or custody of or power over any document of any description whatever relating to any matter in question in this action, other than the documents listed in Parts 1A and 2A of this list.`)),
      ]),
      new TableRow({
        children: [
          cell(LBL, [para(run("Inspection of documents")), para([run("1", { sup: true })])]),
          cell(
            CONTENT,
            [
              para(run("The documents in this list, other than those listed in Parts 1B and 2A, may be inspected at —")),
              para(run(inspectionAddress)),
              para(run("on Monday to Friday between the hours of 9:00 am to 5:00 pm as may be mutually agreed.")),
            ],
            { span: 3 },
          ),
        ],
      }),
      new TableRow({
        children: [
          cell(LBL, [para(run("Certificate by party giving discovery or its practitioner", { bold: true })), para([run("2", { sup: true })])]),
          cell(CERT_C, [para(run("I certify that the statements in this document are true."), { after: 160 }), para(run(firmName))], { span: 2 }),
          cell(GD, [para(run("Date:"))]),
        ],
      }),
      new TableRow({
        children: [
          cell(LBL, [para(run("Service details", { bold: true }))]),
          cell(
            CONTENT,
            [
              para(run(`This list and its attachments were served on the ${party === "plaintiff" ? "defendants" : "plaintiff"} on ____________ by the ${party}.`), { after: 200 }),
              para([run("Signed: ______________________     "), run("Date: ______________")]),
            ],
            { span: 3 },
          ),
        ],
      }),
    ],
  });

  // Part 1A: No. | Description | Date, numbered continuously across categories.
  const N = 760, DESC = 7000, DT = 1600, FULL1A = N + DESC + DT;
  const rows1a: TableRow[] = [
    new TableRow({
      children: [
        cell(
          FULL1A,
          [
            para(run("List of documents — Part 1A", { bold: true, size: SZH })),
            para([run(`The documents relating to the matters in question in this action that are in the possession, custody or power of the ${party} are as follows —`)], { before: 40 }),
          ],
          { span: 3 },
        ),
      ],
    }),
  ];
  const colHeader = () => new TableRow({ tableHeader: true, children: [cell(N, [para(run("No.", { bold: true }))]), cell(DESC, [para(run("Description of document", { bold: true }))]), cell(DT, [para(run("Date", { bold: true }))])] });
  let counter = 0;
  config.categories.forEach((cat, i) => {
    rows1a.push(new TableRow({ children: [cell(FULL1A, [para(run(cat.name, { bold: true }))], { span: 3 })] }));
    if (i === 0) rows1a.push(colHeader());
    for (const it of cat.items) {
      counter++;
      rows1a.push(new TableRow({ children: [cell(N, [para(run(`${counter}.`))]), cell(DESC, [para(run(it.description))]), cell(DT, [para(run(it.date ?? ""))])] }));
    }
  });
  const part1a = new Table({ width: { size: FULL1A, type: WidthType.DXA }, columnWidths: [N, DESC, DT], rows: rows1a });

  // Part 1B
  const B_NO = 1400, B_GR = 7960;
  const rows1b: TableRow[] = [
    new TableRow({
      children: [
        cell(
          B_NO + B_GR,
          [
            para(run("List of documents — Part 1B", { bold: true, size: SZH })),
            para(run(`Of the documents listed in Part 1A the ${party} objects to producing the following on the following grounds.`), { before: 40 }),
          ],
          { span: 2 },
        ),
      ],
    }),
    new TableRow({ tableHeader: true, children: [cell(B_NO, [para(run("No. in Part 1A", { bold: true }))]), cell(B_GR, [para(run("Grounds for objecting to producing the document", { bold: true }))])] }),
    ...(part1bObjections.length
      ? part1bObjections.map((o) => new TableRow({ children: [cell(B_NO, [para(run(o.ref))]), cell(B_GR, [para(run(o.grounds))])] }))
      : [new TableRow({ children: [cell(B_NO, [para(run("Nil"))]), cell(B_GR, [para(run(""))])] })]),
  ];
  const part1b = new Table({ width: { size: B_NO + B_GR, type: WidthType.DXA }, columnWidths: [B_NO, B_GR], rows: rows1b });

  // Part 2A
  const A2_NO = 760, A2_D = 8600;
  const rows2a: TableRow[] = [
    new TableRow({
      children: [
        cell(
          A2_NO + A2_D,
          [
            para(run("List of documents — Part 2A", { bold: true, size: SZH })),
            para(run(`The documents relating to the matters in question in this action that were, but no longer are, in the possession, custody or power of the ${party} are as follows —`), { before: 40 }),
          ],
          { span: 2 },
        ),
      ],
    }),
    new TableRow({ tableHeader: true, children: [cell(A2_NO, [para(run("No.", { bold: true }))]), cell(A2_D, [para(run("Description of document", { bold: true }))])] }),
    ...(part2a.length
      ? part2a.map((d) => new TableRow({ children: [cell(A2_NO, [para(run(String(d.no)))]), cell(A2_D, [para(run(d.description))])] }))
      : [new TableRow({ children: [cell(A2_NO, [para(run("Nil"))]), cell(A2_D, [para(run(""))])] })]),
  ];
  const part2aTable = new Table({ width: { size: A2_NO + A2_D, type: WidthType.DXA }, columnWidths: [A2_NO, A2_D], rows: rows2a });

  // Part 2B
  const c1 = 1400, c2 = 1500, c3 = 2860, c4 = 3600;
  const rows2b: TableRow[] = [
    new TableRow({
      children: [
        cell(
          c1 + c2 + c3 + c4,
          [
            para(run("List of documents — Part 2B", { bold: true, size: SZH })),
            para(run("For each document listed in Part 2A, the following states —"), { before: 40 }),
            bullet(`the date on which it was last in the possession, custody or power of the ${party}; and`),
            bullet("what has become of it; and"),
            bullet("who currently has possession or custody of or power over it."),
          ],
          { span: 4 },
        ),
      ],
    }),
    new TableRow({
      tableHeader: true,
      children: [
        cell(c1, [para(run("No. in Part 2A", { bold: true }))]),
        cell(c2, [para(run("Date", { bold: true }))]),
        cell(c3, [para(run("What has become of it", { bold: true }))]),
        cell(c4, [para(run("Who currently has possession or custody of or power over it", { bold: true }))]),
      ],
    }),
    ...(part2b.length
      ? part2b.map(
          (d) =>
            new TableRow({
              children: [cell(c1, [para(run(String(d.no)))]), cell(c2, [para(run(d.date ?? ""))]), cell(c3, [para(run(d.becomeOf ?? ""))]), cell(c4, [para(run(d.whoHas ?? ""))])],
            }),
        )
      : [new TableRow({ children: [cell(c1, [para(run("Nil"))]), cell(c2, [para(run(""))]), cell(c3, [para(run(""))]), cell(c4, [para(run(""))])] })]),
  ];
  const part2bTable = new Table({ width: { size: c1 + c2 + c3 + c4, type: WidthType.DXA }, columnWidths: [c1, c2, c3, c4], rows: rows2b });

  const notes = [
    para(run("Notes to Form No. 17 —", { bold: true }), { before: 240, after: 40 }),
    para(run("1.  This notice must comply with O. 26 r. 8.")),
    para(run("2.  Do not complete this if this list is being verified by an affidavit. This certificate may be signed by a person listed in O. 26 r. 4(4) or the practitioner of the party giving discovery.")),
    para(run("3.  This Part must begin on a new sheet of paper and be attached to the main document.")),
    para([run("[Form 17 inserted in Gazette 28 Jul 2010 p. 3472-5.]", { italics: true })], { before: 120 }),
  ];
  const spacer = () => new Paragraph({ spacing: { after: 240 }, children: [] });

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SZ } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
        children: [infoTable, spacer(), part1a, spacer(), part1b, spacer(), part2aTable, spacer(), part2bTable, ...notes],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

// ---------------------------------------------------------------------------
// Categorising a matter's files
// ---------------------------------------------------------------------------

export const FORM17_CATEGORY_ORDER = [
  "Privileged Documents",
  "Court Documents and Correspondence",
  "Medical Reports",
  "Progress Medical Certificates",
  "Mental Health Records",
  "Hospital and Clinical Records",
  "Workers' Compensation Documents",
  "Vocational Rehabilitation",
  "Economic Loss",
  "Liability",
  "Other",
] as const;

export interface MatterFile {
  /** File name, ideally following the naming convention ("2023.03.08 CT scan – MED Radiology.pdf"). */
  name: string;
  /** Folder path or name inside the matter ("Medical Reports", "Tax Documents"). */
  folder?: string;
  /** ISO date when known from metadata; otherwise read from the name. */
  date?: string;
}

export interface CategoriseOptions {
  party?: string;
  /** For the generic court-documents entry, e.g. "District Court of Western Australia". */
  courtName?: string;
  actionNumber?: string;
  /** Wording for the opponent in the correspondence entry; default "defendants". */
  opponents?: string;
}

export interface CategorisedFiles {
  categories: Form17Category[];
  /** Files left out of Part 1A, with the reason (covered by a generic entry, duplicate). */
  excluded: { file: MatterFile; reason: string }[];
}

type Rule = { category: (typeof FORM17_CATEGORY_ORDER)[number] | "exclude-correspondence" | "exclude-court"; name?: RegExp; folder?: RegExp };

// First match wins (name rules, then folder rules), so specific kinds come before the
// broad "report" rule.
const RULES: Rule[] = [
  { category: "Other", name: /\b(invoices?|receipts?|statement of account|quote)\b/i },
  { category: "exclude-court", folder: /court/i },
  { category: "exclude-court", name: /\b(writ|statement of claim|defen[cs]e|summons|orders?|affidavit|pleading|notice of (intention|discontinuance|change|appearance|motion|appeal|address)|list of documents|subpoena)\b/i },
  { category: "exclude-correspondence", name: /^(EMC?|LTR|Letter|File ?note)\b|\b(EMC?|LTR) (to|from|with|by)\b/ },
  { category: "exclude-correspondence", folder: /\b(emails?|correspondence)\b/i },
  { category: "Progress Medical Certificates", name: /certificate of capacity|medical certificate|progress (medical )?certificate|\bPMC\b|\bCoC\b|first certificate|final certificate/i },
  { category: "Progress Medical Certificates", folder: /certificate/i },
  { category: "Mental Health Records", name: /\b(psycholog\w*|psychiatr\w*|counsell\w*|mental health)\b.*\b(records|notes)\b|\b(records|notes)\b.*\b(psycholog\w*|psychiatr\w*|counsell\w*|mental health)\b/i },
  { category: "Hospital and Clinical Records", name: /\b(hospital|clinical (records|notes)|discharge|emergency department|ED notes|GP (records|notes)|medical records)\b/i },
  { category: "Hospital and Clinical Records", folder: /hospital|clinical/i },
  { category: "Mental Health Records", folder: /mental health/i },
  { category: "Vocational Rehabilitation", name: /vocational|rehabilitation provider|return to work|\bRTW\b|work ?trial|functional capacity/i },
  { category: "Vocational Rehabilitation", folder: /vocational|rehab/i },
  { category: "Economic Loss", name: /payslips?|tax return|notice of assessment|income statement|centrelink|PAYG|group certificate|\bwages?\b|employment (contract|records)|separation certificate|superannuation/i },
  { category: "Economic Loss", folder: /tax|payslip|employment|income|financial/i },
  { category: "Workers' Compensation Documents", name: /workers'? comp|\bWC\b|claim form|weekly payments|claims history|insurer|schedule of payments/i },
  { category: "Workers' Compensation Documents", folder: /workers'? comp|\bWC\b|insurer/i },
  { category: "Liability", name: /\b(incident|crash|accident|police|collision|CCTV|photographs?|scene|motor vehicle)\b/i },
  { category: "Liability", folder: /liability|incident|police/i },
  { category: "Medical Reports", name: /\b(report|IME|referral|scan|x-?ray|MRI|CT|ultrasound|radiolog\w*|imaging|pathology|opinion|assessment)\b/i },
  { category: "Medical Reports", folder: /medical/i },
];

const EXT = /\.([a-z0-9]{1,5})$/i;
const PREFERRED_EXT = ["pdf", "docx", "doc", "msg", "eml", "xlsx", "jpg", "jpeg", "png", "tif", "tiff", "heic"];

function splitName(name: string): { base: string; ext: string } {
  const m = EXT.exec(name);
  return m ? { base: name.slice(0, m.index), ext: m[1]!.toLowerCase() } : { base: name, ext: "" };
}

/** ISO date from metadata or a leading YYYY.MM.DD / YYYY-MM-DD / DD.MM.YYYY. */
function fileDate(f: MatterFile, base: string): string | "Various" | undefined {
  if (f.date && /^\d{4}-\d{2}-\d{2}/.test(f.date)) return f.date.slice(0, 10);
  if (/^Various\b/.test(base)) return "Various";
  let m = /^(\d{4})[.-](\d{2})[.-](\d{2})\b/.exec(base);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})[./](\d{2})[./](\d{4})\b/.exec(base);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}

/** Description: the name without its date, SIER number or extension. */
function describe(base: string): string {
  return base
    .replace(/^(\d{4}[.-]\d{2}[.-]\d{2}|\d{2}[./]\d{2}[./]\d{4}|Various)\s*(\d{4}\s+)?/, "")
    .replace(/^SIER\s*#?\d+\s*[–-]?\s*/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Heuristic first pass at Part 1A from a matter's files, for a person to review.
 * Correspondence and court documents are covered by the generic "common to the
 * parties" entries rather than itemised. Duplicates (the same scan as .pdf and .jpg,
 * or the same name in two folders) are kept once, preferring the PDF.
 */
export function categoriseForForm17(files: MatterFile[], opts: CategoriseOptions = {}): CategorisedFiles {
  const party = opts.party ?? "plaintiff";
  const excluded: CategorisedFiles["excluded"] = [];

  // De-duplicate by normalised base name.
  const byBase = new Map<string, { file: MatterFile; ext: string }>();
  for (const file of files) {
    const { base, ext } = splitName(file.name.trim());
    const key = base.toLowerCase().replace(/[\s_]+/g, " ").trim();
    const prev = byBase.get(key);
    if (!prev) {
      byBase.set(key, { file, ext });
      continue;
    }
    const rank = (e: string) => (PREFERRED_EXT.indexOf(e) === -1 ? 99 : PREFERRED_EXT.indexOf(e));
    if (rank(ext) < rank(prev.ext)) {
      excluded.push({ file: prev.file, reason: `duplicate of ${file.name}` });
      byBase.set(key, { file, ext });
    } else excluded.push({ file, reason: `duplicate of ${prev.file.name}` });
  }

  const buckets = new Map<string, { iso?: string | "Various"; item: Form17Item }[]>();
  for (const { file } of byBase.values()) {
    const { base } = splitName(file.name.trim());
    // The name decides first; the folder only when the name says nothing.
    const rule = RULES.find((r) => r.name?.test(base)) ?? (file.folder ? RULES.find((r) => r.folder?.test(file.folder!)) : undefined);
    const category = rule?.category ?? "Other";
    if (category === "exclude-correspondence") {
      excluded.push({ file, reason: "correspondence (covered by the generic correspondence entry or privileged)" });
      continue;
    }
    if (category === "exclude-court") {
      excluded.push({ file, reason: "court document (covered by the generic court documents entry)" });
      continue;
    }
    const iso = fileDate(file, base);
    const date = iso === undefined ? "Undated" : iso === "Various" ? "Various" : `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    const list = buckets.get(category) ?? [];
    list.push({ iso, item: { description: describe(base) || base, date } });
    buckets.set(category, list);
  }

  const opponents = opts.opponents ?? (party === "plaintiff" ? "defendants" : "plaintiff");
  const court = opts.courtName ?? "District Court of Western Australia";
  const categories: Form17Category[] = [
    { name: "Privileged Documents", items: PRIVILEGED_ITEMS(party) },
    {
      name: `Court Documents and Correspondence between the ${party} and the ${opponents}' solicitors`,
      items: [
        { description: `Court documents in the ${court}${opts.actionNumber ? ` Action No. ${opts.actionNumber}` : ""} common to the parties.`, date: "Various" },
        { description: `Correspondence and copy correspondence passing between the solicitors for the ${party} and the solicitors for the ${opponents}, common to the parties.`, date: "Various" },
      ],
    },
  ];
  // Chronological within each category; Various then Undated go last.
  const sortKey = (iso: string | undefined) => (iso === undefined ? "9999-99-99" : iso === "Various" ? "9999-99-98" : iso);
  for (const name of FORM17_CATEGORY_ORDER.slice(2)) {
    const list = buckets.get(name);
    if (!list?.length) continue;
    list.sort((a, b) => sortKey(a.iso).localeCompare(sortKey(b.iso)) || a.item.description.localeCompare(b.item.description));
    categories.push({ name, items: list.map((x) => x.item) });
  }
  return { categories, excluded };
}
