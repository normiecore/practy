/**
 * PDF bundles and renders with pdf-lib: master books (house-style affidavit with
 * annexures, court-form affidavit, book with cover and contents), email-to-PDF, and
 * per-page text extraction.
 *
 * Every page number an index cites is derived from the actual page positions, and the
 * stamps use the same numbers, so the index and the stamps cannot disagree.
 */
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFPage,
  PDFRef,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type RGB,
} from "pdf-lib";
import { extractText } from "unpdf";

export const A4: [number, number] = [595.28, 841.89];
const [W, H] = A4;
const CM = 28.3465;
const MARGIN = 2 * CM;

// ---------------------------------------------------------------------------
// Fonts and text
// ---------------------------------------------------------------------------

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
}

// Letters NFKD does not decompose.
const FOLD: Record<string, string> = { "\u0141": "L", "\u0142": "l", "\u0110": "D", "\u0111": "d", "\u0131": "i", "\u0126": "H", "\u0127": "h", "\u2212": "-", "\u2010": "-", "\u2011": "-" };

const charsets = new WeakMap<PDFFont, Set<number>>();

/**
 * The standard fonts only encode WinAnsi (cp1252). Without a font-embedding dependency
 * we fold other characters to their closest WinAnsi form (accents stripped) and
 * replace the rest with "?", rather than failing the whole bundle.
 */
export function winAnsiSafe(text: string, font: PDFFont): string {
  let set = charsets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsets.set(font, set);
  }
  let out = "";
  for (const ch of text.replace(/\t/g, "    ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")) {
    const cp = ch.codePointAt(0)!;
    if (set.has(cp)) {
      out += ch;
      continue;
    }
    const folded = (FOLD[ch] ?? ch).normalize("NFKD").replace(/\p{M}/gu, "");
    out += [...folded].every((c) => set!.has(c.codePointAt(0)!)) && folded ? folded : ch === " " ? " " : "?";
  }
  return out;
}

const width = (text: string, font: PDFFont, size: number) => font.widthOfTextAtSize(winAnsiSafe(text, font), size);

/** Greedy word wrap; words longer than the line are broken by character. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const part of text.split("\n")) {
    let line = "";
    for (const word of part.split(/(?<=\s)(?=\S)/)) {
      const trial = line + word;
      if (!line || width(trial.trimEnd(), font, size) <= maxWidth) {
        line = trial;
        // A single word too wide for an empty line: hard-break it.
        while (width(line.trimEnd(), font, size) > maxWidth && line.trim().length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && width(line.slice(0, cut), font, size) > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        lines.push(line.trimEnd());
        line = word;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.length ? lines : [""];
}

interface Seg {
  text: string;
  font: PDFFont;
  underline?: boolean;
}

/** Word-wrap mixed-style runs; returns lines of segments drawn left to right. */
function wrapSegs(runs: Seg[], size: number, maxWidth: number): Seg[][] {
  const lines: Seg[][] = [];
  let cur: Seg[] = [];
  let curW = 0;
  for (const r of runs) {
    for (let tok of r.text.match(/\S+\s*|\s+/g) ?? []) {
      if (cur.length && curW + width(tok.trimEnd(), r.font, size) > maxWidth) {
        lines.push(cur);
        cur = [];
        curW = 0;
        tok = tok.trimStart();
        if (!tok) continue;
      }
      const last = cur[cur.length - 1];
      if (last && last.font === r.font && !!last.underline === !!r.underline) last.text += tok;
      else cur.push({ text: tok, font: r.font, underline: r.underline });
      curW += width(tok, r.font, size);
    }
  }
  if (cur.length) lines.push(cur);
  return lines.length ? lines : [[]];
}

function drawSegs(page: PDFPage, segs: Seg[], x: number, y: number, size: number, color: RGB = rgb(0, 0, 0)): void {
  let xx = x;
  for (const s of segs) {
    const t = winAnsiSafe(s.text, s.font);
    page.drawText(t, { x: xx, y, size, font: s.font, color });
    const w = s.font.widthOfTextAtSize(t, size);
    if (s.underline && t.trim()) page.drawLine({ start: { x: xx, y: y - 1.2 }, end: { x: xx + s.font.widthOfTextAtSize(t.trimEnd(), size), y: y - 1.2 }, thickness: 0.5, color });
    xx += w;
  }
}

// ---------------------------------------------------------------------------
// Links and bookmarks (pdf-lib has no high-level API for either)
// ---------------------------------------------------------------------------

function addLink(doc: PDFDocument, page: PDFPage, rect: [number, number, number, number], target: PDFPage): void {
  const ctx = doc.context;
  const annot = ctx.obj({ Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0], Dest: [target.ref, "XYZ", null, null, null] });
  page.node.addAnnot(ctx.register(annot));
}

function addOutline(doc: PDFDocument, items: { title: string; page: PDFPage }[]): void {
  if (!items.length) return;
  const ctx = doc.context;
  const root = ctx.nextRef();
  const refs: PDFRef[] = items.map(() => ctx.nextRef());
  items.forEach((it, i) => {
    const dict = ctx.obj({ Title: PDFHexString.fromText(it.title), Parent: root, Dest: [it.page.ref, "XYZ", null, null, null] });
    if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]!);
    if (i < refs.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]!);
    ctx.assign(refs[i]!, dict);
  });
  ctx.assign(root, ctx.obj({ Type: "Outlines", First: refs[0]!, Last: refs[refs.length - 1]!, Count: refs.length }));
  doc.catalog.set(PDFName.of("Outlines"), root);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}

// ---------------------------------------------------------------------------
// Page-number stamps
// ---------------------------------------------------------------------------

export type NumberPosition = "bottom-center" | "top-right";

/**
 * Stamp a page number on a white chip, in the page's visible (crop box, rotated)
 * coordinate space, so it is upright and on-page for cropped and rotated pages.
 */
function stampPageNumber(page: PDFPage, label: string, position: NumberPosition, font: PDFFont): void {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const [vw, vh] = rot === 90 || rot === 270 ? [box.height, box.width] : [box.width, box.height];
  const size = 9;
  const lw = font.widthOfTextAtSize(label, size);
  const [tx, ty] = position === "top-right" ? [vw - 1.5 * CM - lw, vh - 1.5 * CM] : [vw / 2 - lw / 2, 1.0 * CM];
  const pad = 3;
  // Visual → content coordinates for each /Rotate value.
  const map = (x: number, y: number): [number, number] => {
    const [cx, cy] = rot === 90 ? [box.width - y, x] : rot === 180 ? [box.width - x, box.height - y] : rot === 270 ? [y, box.height - x] : [x, y];
    return [cx + box.x, cy + box.y];
  };
  const angle = degrees(rot);
  const [rx, ry] = map(tx - pad, ty - pad);
  page.drawRectangle({ x: rx, y: ry, width: lw + 2 * pad, height: size + 2 * pad, color: rgb(1, 1, 1), rotate: angle });
  const [px, py] = map(tx, ty);
  page.drawText(label, { x: px, y: py, size, font, color: rgb(0.4, 0.4, 0.4), rotate: angle });
}

// ---------------------------------------------------------------------------
// Index table (court INDEX DETAILS / book TABLE OF CONTENTS)
// ---------------------------------------------------------------------------

export interface CourtForm {
  court?: string;
  heldAt?: string;
  fileNumber?: string;
  formTitle?: string;
  parties?: { name: string; role?: string }[];
  personMaking?: string;
  dateMade?: string;
  purpose?: string;
  filedBy?: string;
  /** Row padding in cm (default 0.30): the court's own forms use airy rows. */
  rowPadCm?: number;
}

interface IndexEntry {
  label: string;
  /** 0-based within the content section. */
  startInContent: number;
}

type Numbering = "continuous" | "absolute" | "absolute-content" | "none";

interface IndexLink {
  indexPage: number;
  rect: [number, number, number, number];
  targetPage: number;
}

const COURT_SIZE = 10;
const LEADING = 0.46 * CM;

function entryLabel(e: IndexEntry, prefix: number, numbering: Numbering, start: number): string {
  if (numbering === "absolute" || numbering === "absolute-content") return String(start + prefix + e.startInContent);
  if (numbering === "none") return "";
  return String(start + e.startInContent);
}

/** "Attachment OM70 – …": the identifier prints bold, as in filed court indexes. */
function attachmentRuns(text: string, fonts: Fonts, bold: boolean): Seg[] {
  const m = /^(Attachments?\s+)([A-Z]{1,3}\d{1,4}(?:\s*[-–]\s*[A-Z]{0,3}\d{1,4})?)([^]*)$/.exec(text);
  if (!m || bold) return [{ text, font: bold ? fonts.bold : fonts.regular }];
  return [{ text: m[1]!, font: fonts.regular }, { text: m[2]!, font: fonts.bold }, ...(m[3] ? [{ text: m[3], font: fonts.regular }] : [])];
}

type CellLine = Seg[] | { left: string; right?: string; font: PDFFont };
interface Cell {
  x: number;
  w: number;
  lines: CellLine[];
}

async function renderIndex(form: CourtForm | undefined, entries: IndexEntry[], prefix: number, numbering: Numbering, start: number, headerText: string): Promise<{ bytes: Uint8Array; pages: number; links: IndexLink[] }> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const cf = form ?? {};
  const x0 = MARGIN;
  const x1 = W - MARGIN;
  const tableW = x1 - x0;
  const labelW = 3.4 * CM;
  const CP = (cf.rowPadCm ?? 0.3) * CM;
  const maxLinesPage = Math.max(1, Math.floor((H - 2 * MARGIN - 2 * CP) / LEADING));
  const links: IndexLink[] = [];
  let page = doc.addPage(A4);
  let pageIdx = 0;
  let y = H - MARGIN;

  const newPage = () => {
    page = doc.addPage(A4);
    pageIdx++;
    y = H - MARGIN;
  };
  const wrapCell = (pairs: [string, boolean][], maxW: number): CellLine[] =>
    pairs.flatMap(([text, bold]) => wrapText(text, bold ? fonts.bold : fonts.regular, COURT_SIZE, maxW).map((l) => ({ left: l, font: bold ? fonts.bold : fonts.regular })));

  // Rows move to the next page when they do not fit; rows taller than a page are
  // split into chunks. Nothing is drawn below the bottom margin.
  const drawRow = (cells: Cell[], linkTarget?: number) => {
    const remaining = cells.map((c) => [...c.lines]);
    let first = true;
    while (first || remaining.some((r) => r.length)) {
      const nLines = Math.max(...remaining.map((r) => r.length), 1);
      let avail = Math.floor((y - MARGIN - 2 * CP) / LEADING);
      if (avail < Math.min(nLines, 3)) {
        newPage();
        avail = maxLinesPage;
      }
      const take = Math.min(nLines, avail, maxLinesPage);
      const rh = take * LEADING + 2 * CP;
      cells.forEach((cell, i) => {
        const chunk = remaining[i]!.splice(0, take);
        page.drawRectangle({ x: cell.x, y: y - rh, width: cell.w, height: rh, borderColor: rgb(0, 0, 0), borderWidth: 0.6 });
        let yy = y - CP - COURT_SIZE;
        for (const ln of chunk) {
          if (Array.isArray(ln)) drawSegs(page, ln, cell.x + CP, yy, COURT_SIZE);
          else {
            if (ln.left) drawSegs(page, [{ text: ln.left, font: ln.font }], cell.x + CP, yy, COURT_SIZE);
            if (ln.right) drawSegs(page, [{ text: ln.right, font: fonts.regular }], cell.x + cell.w - CP - width(ln.right, fonts.regular, COURT_SIZE), yy, COURT_SIZE);
          }
          yy -= LEADING;
        }
      });
      if (first && linkTarget !== undefined) links.push({ indexPage: pageIdx, rect: [x0, y - rh, x1, y], targetPage: linkTarget });
      y -= rh;
      first = false;
    }
  };
  const labelled = (label: string, value: string | undefined, bold = false) => {
    if (!value) return;
    drawRow([
      { x: x0, w: labelW, lines: wrapCell([[label, false]], labelW - 2 * CP) },
      { x: x0 + labelW, w: tableW - labelW, lines: wrapCell([[value, bold]], tableW - labelW - 2 * CP) },
    ]);
  };

  // Header block: court and registry left, file number and form title right.
  const courtPairs: [string, boolean][] = [cf.court, cf.heldAt ? `Held at ${cf.heldAt}` : undefined].filter((t): t is string => !!t).map((t) => [t, false]);
  const rightPairs: [string, boolean][] = [];
  if (cf.fileNumber) rightPairs.push([cf.fileNumber, true]);
  if (cf.formTitle) {
    if (rightPairs.length) rightPairs.push(["", false]);
    rightPairs.push([cf.formTitle, true]);
  }
  if (courtPairs.length || rightPairs.length) {
    const lw = tableW * 0.55;
    drawRow([
      { x: x0, w: lw, lines: wrapCell(courtPairs, lw - 2 * CP) },
      { x: x0 + lw, w: tableW - lw, lines: wrapCell(rightPairs, tableW - lw - 2 * CP) },
    ]);
  }
  if (cf.parties?.length) {
    const cellW = tableW - labelW - 2 * CP;
    const lines: CellLine[] = [];
    cf.parties.forEach((p, i) => {
      if (i) lines.push({ left: "", font: fonts.regular });
      const role = p.role ?? "";
      const roleW = role ? width(role, fonts.regular, COURT_SIZE) + 0.5 * CM : 0;
      if (role && roleW > cellW * 0.5) {
        for (const l of wrapText(p.name, fonts.bold, COURT_SIZE, cellW)) lines.push({ left: l, font: fonts.bold });
        lines.push({ left: "", right: role, font: fonts.regular });
      } else {
        wrapText(p.name, fonts.bold, COURT_SIZE, cellW - roleW).forEach((l, j) => lines.push({ left: l, ...(j === 0 && role ? { right: role } : {}), font: fonts.bold }));
      }
    });
    drawRow([
      { x: x0, w: labelW, lines: wrapCell([["Parties", false]], labelW - 2 * CP) },
      { x: x0 + labelW, w: tableW - labelW, lines },
    ]);
  }
  labelled("Person making affidavit", cf.personMaking, true);
  labelled("Date made", cf.dateMade);
  labelled("Purpose", cf.purpose, true);
  labelled("Filed by", cf.filedBy);
  if (form) y -= 0.5 * CM;

  const numW = 1.2 * CM;
  const pageW = 1.8 * CM;
  const descW = tableW - numW - pageW;
  const indexRow = (num: string, desc: string, pageLabel: string, bold: boolean, linkTarget?: number) => {
    const small = bold ? fonts.bold : fonts.regular;
    drawRow(
      [
        { x: x0, w: numW, lines: num ? [{ left: num, font: small }] : [] },
        { x: x0 + numW, w: descW, lines: wrapSegs(attachmentRuns(desc, fonts, bold), COURT_SIZE, descW - 2 * CP) },
        { x: x0 + numW + descW, w: pageW, lines: pageLabel ? [{ left: pageLabel, font: small }] : [] },
      ],
      linkTarget,
    );
  };
  indexRow("", headerText, "PAGE", true);
  entries.forEach((e, i) => indexRow(String(i + 1), e.label, entryLabel(e, prefix, numbering, start), false, prefix + e.startInContent));

  return { bytes: await doc.save(), pages: doc.getPageCount(), links };
}

async function renderCover(title: string, subtitle: string | undefined, author: string | undefined, date: string | undefined): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const page = doc.addPage(A4);
  const centred = (text: string, font: PDFFont, size: number, y: number, color: RGB) => {
    const lines = wrapText(text, font, size, W - 4 * CM);
    const gap = size * 1.25;
    const startY = y + (gap * lines.length) / 2 - gap / 2;
    lines.forEach((l, i) => page.drawText(winAnsiSafe(l, font), { x: W / 2 - width(l, font, size) / 2, y: startY - i * gap, size, font, color }));
  };
  centred(title, fonts.bold, 28, H * 0.62, rgb(0.067, 0.067, 0.067));
  if (subtitle) centred(subtitle, fonts.regular, 14, H * 0.55, rgb(0.267, 0.267, 0.267));
  const grey = rgb(0.4, 0.4, 0.4);
  if (author) centred(author, fonts.regular, 10, MARGIN + 0.6 * CM, grey);
  if (date) centred(date, fonts.regular, 10, MARGIN, grey);
  page.drawLine({ start: { x: MARGIN, y: MARGIN + 1.4 * CM }, end: { x: W - MARGIN, y: MARGIN + 1.4 * CM }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
  return doc.save();
}

// ---------------------------------------------------------------------------
// Master book
// ---------------------------------------------------------------------------

export interface BookDocument {
  bytes: Uint8Array;
  displayName: string;
  /** Several index rows pointing into one PDF (page is 1-based within it); [] binds it with no row. */
  tocEntries?: { label: string; page: number }[];
}

export interface BookInput {
  mode: "book";
  title: string;
  subtitle?: string;
  author?: string;
  /** Printed on the cover. Never defaulted: a sworn or filed document needs its real date. */
  date?: string;
  includeCover?: boolean;
  documents: BookDocument[];
  numbering?: Numbering;
  numberStart?: number;
  numberPosition?: NumberPosition;
}

export interface CourtInput {
  mode: "court";
  courtForm: CourtForm;
  /** The deponent's affidavit is normally first, e.g. "Affidavit of <name>". */
  documents: BookDocument[];
  title?: string;
  numbering?: Numbering;
  numberStart?: number;
  numberPosition?: NumberPosition;
}

export interface AnnexureSource {
  bytes: Uint8Array;
  /**
   * "document" (default) pages are scaled (first page 0.84, later 0.92) so the label
   * and number never cover content. "house-email" pages were printed with the top
   * 4.2 cm clear (see emailToPdf) and are used as they are.
   */
  layout?: "document" | "house-email";
}

export interface Annexure {
  /** e.g. "KW8"; generated from markPrefix/firstMarkNumber when omitted. */
  mark?: string;
  /** Index wording. */
  description: string;
  sources: AnnexureSource[];
}

export interface HouseIndexRow {
  no: number;
  annexure: string;
  document: string;
  /** "5 to 8", or "5" for a single page. */
  pages: string;
}

export interface HousePlan {
  affidavitPages: number;
  totalPages: number;
  annexures: { mark: string; description: string; first: number; last: number; pages: string }[];
  indexRows: HouseIndexRow[];
}

/** Renders the deponent's affidavit with its INDEX filled from the plan. */
export type AffidavitRenderer = (rows: HouseIndexRow[]) => Uint8Array | Promise<Uint8Array>;

export interface HouseAffidavitInput {
  mode: "house";
  /** The affidavit as drafted (index already filled), or a renderer that fills the index. */
  affidavit: Uint8Array | AffidavitRenderer;
  /** Index wording for row 1; default "Affidavit". */
  affidavitTitle?: string;
  /** True (default) when the affidavit prints its own top-right page numbers. */
  affidavitNumbered?: boolean;
  /** Deponent initials, e.g. "KW". Marks continue from earlier affidavits via firstMarkNumber. */
  markPrefix?: string;
  firstMarkNumber?: number;
  /** Label on each annexure's first page; "{mark}" is substituted. */
  label?: string;
  annexures: Annexure[];
}

export type MasterBookInput = BookInput | CourtInput | HouseAffidavitInput;

export interface MasterBookResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Index rows with the page each cites (absolute in book/court, as printed). */
  entries: { label: string; page: string }[];
  plan?: HousePlan;
}

export class MasterBookError extends Error {}

async function load(bytes: Uint8Array, what: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (e) {
    // pdf-lib errors carry no file name; a 40-annexure build must say which one.
    throw new MasterBookError(`Cannot read PDF for ${what}: ${(e as Error).message}`);
  }
}

const pagesStr = (a: number, b: number) => (a === b ? String(a) : `${a} to ${b}`);

export async function buildMasterBook(input: MasterBookInput): Promise<MasterBookResult> {
  return input.mode === "house" ? buildHouse(input) : buildIndexed(input);
}

async function buildIndexed(input: BookInput | CourtInput): Promise<MasterBookResult> {
  if (!input.documents.length) throw new MasterBookError("No documents: nothing to build");
  const court = input.mode === "court";
  if (court && !["court", "fileNumber", "formTitle", "parties", "personMaking"].some((k) => (input.courtForm as Record<string, unknown>)[k])) {
    throw new MasterBookError("A court-form index needs at least one of court, fileNumber, formTitle, parties or personMaking");
  }
  const numbering: Numbering = input.numbering ?? (court ? "absolute" : "absolute-content");
  const position: NumberPosition = input.numberPosition ?? (court ? "top-right" : "bottom-center");
  const start = input.numberStart ?? 1;
  const includeCover = !court && (input as BookInput).includeCover !== false;

  const sources = await Promise.all(input.documents.map((d) => load(d.bytes, `"${d.displayName}"`)));
  const offsets: number[] = [];
  let running = 0;
  for (const s of sources) {
    offsets.push(running);
    running += s.getPageCount();
  }
  const totalContent = running;

  const entries: IndexEntry[] = [];
  input.documents.forEach((d, i) => {
    const count = sources[i]!.getPageCount();
    const rows = d.tocEntries ?? [{ label: d.displayName, page: 1 }];
    if (rows.length && count === 0) throw new MasterBookError(`"${d.displayName}" has no pages; it cannot be bound or indexed`);
    for (const row of rows) {
      if (!(row.page >= 1 && row.page <= count)) throw new MasterBookError(`Index page ${row.page} for "${row.label}" is outside 1..${count} in "${d.displayName}"`);
      entries.push({ label: row.label || d.displayName, startInContent: offsets[i]! + row.page - 1 });
    }
  });

  // The index's own length shifts every absolute page number, so iterate to a fixed point.
  const cover = includeCover ? 1 : 0;
  const header = court ? "INDEX DETAILS" : "TABLE OF CONTENTS";
  let assumed = Math.max(1, Math.floor(entries.length / 35) + 1);
  let index = await renderIndex(court ? input.courtForm : undefined, entries, cover + assumed, numbering, start, header);
  for (let i = 0; i < 4 && index.pages !== assumed; i++) {
    assumed = index.pages;
    index = await renderIndex(court ? input.courtForm : undefined, entries, cover + assumed, numbering, start, header);
  }
  if (index.pages !== assumed) throw new MasterBookError("Index page count did not settle");
  const prefix = cover + assumed;

  const out = await PDFDocument.create();
  const fonts = await embedFonts(out);
  if (includeCover) {
    const b = input as BookInput;
    const coverDoc = await PDFDocument.load(await renderCover(b.title, b.subtitle, b.author, b.date));
    for (const p of await out.copyPages(coverDoc, [0])) out.addPage(p);
  }
  const indexDoc = await PDFDocument.load(index.bytes);
  for (const p of await out.copyPages(indexDoc, indexDoc.getPageIndices())) out.addPage(p);
  for (const [i, s] of sources.entries()) {
    try {
      for (const p of await out.copyPages(s, s.getPageIndices())) out.addPage(p);
    } catch (e) {
      throw new MasterBookError(`Cannot merge PDF for "${input.documents[i]!.displayName}": ${(e as Error).message}`);
    }
  }

  const pages = out.getPages();
  if (numbering === "continuous") for (let o = 0; o < totalContent; o++) stampPageNumber(pages[prefix + o]!, String(start + o), position, fonts.regular);
  else if (numbering === "absolute") for (let a = 1; a < pages.length; a++) stampPageNumber(pages[a]!, String(start + a), position, fonts.regular);
  else if (numbering === "absolute-content") for (let o = 0; o < totalContent; o++) stampPageNumber(pages[prefix + o]!, String(start + prefix + o), position, fonts.regular);

  addOutline(out, entries.map((e) => ({ title: e.label, page: pages[prefix + e.startInContent]! })));
  for (const l of index.links) addLink(out, pages[cover + l.indexPage]!, l.rect, pages[l.targetPage]!);

  const title = court ? (input.title ?? input.courtForm.formTitle ?? "Index") : input.title;
  out.setTitle(title, { showInWindowTitleBar: false });
  if (!court && input.author) out.setAuthor(input.author);
  if (!court && input.subtitle) out.setSubject(input.subtitle);
  out.setCreator("Practy");

  const bytes = await out.save();
  return { bytes, pageCount: pages.length, entries: entries.map((e) => ({ label: e.label, page: entryLabel(e, prefix, numbering, start) })) };
}

/** Page ranges for the house-style affidavit's INDEX, before anything is built. */
export function planHouseAffidavit(affidavitPages: number, annexures: { mark: string; description: string; pages: number }[], affidavitTitle = "Affidavit"): HousePlan {
  let n = affidavitPages;
  const planned = annexures.map((a) => {
    const first = n + 1;
    n += a.pages;
    return { mark: a.mark, description: a.description, first, last: n, pages: pagesStr(first, n) };
  });
  return {
    affidavitPages,
    totalPages: n,
    annexures: planned,
    indexRows: [
      { no: 1, annexure: "", document: affidavitTitle, pages: pagesStr(1, affidavitPages) },
      ...planned.map((a, i) => ({ no: i + 2, annexure: a.mark, document: a.description, pages: a.pages })),
    ],
  };
}

async function buildHouse(input: HouseAffidavitInput): Promise<MasterBookResult> {
  const prefix = input.markPrefix ?? "";
  const firstNo = input.firstMarkNumber ?? 1;
  const marks = input.annexures.map((a, i) => a.mark ?? `${prefix}${firstNo + i}`);
  if (marks.some((m) => !m.trim())) throw new MasterBookError("Each annexure needs a mark, or set markPrefix");
  const labelFmt = input.label ?? 'Annexure "{mark}"';

  const loaded = await Promise.all(
    input.annexures.map(async (a, i) => {
      if (!a.sources.length) throw new MasterBookError(`Annexure ${marks[i]} has no documents`);
      return Promise.all(a.sources.map(async (s, j) => ({ doc: await load(s.bytes, `annexure ${marks[i]} document ${j + 1}`), layout: s.layout ?? "document" })));
    }),
  );
  const counts = loaded.map((docs) => docs.reduce((n, d) => n + d.doc.getPageCount(), 0));
  const title = input.affidavitTitle ?? "Affidavit";
  const plan = (affPages: number) => planHouseAffidavit(affPages, input.annexures.map((a, i) => ({ mark: marks[i]!, description: a.description, pages: counts[i]! })), title);

  // A renderer is re-run until the affidavit's page count matches the plan it was
  // rendered from (filling the index can push it onto another page).
  let affidavit: PDFDocument;
  let result: HousePlan;
  if (typeof input.affidavit === "function") {
    let guess = 1;
    for (let i = 0; ; i++) {
      result = plan(guess);
      affidavit = await load(await input.affidavit(result.indexRows), "the affidavit");
      if (affidavit.getPageCount() === guess) break;
      if (i >= 5) throw new MasterBookError("The affidavit's page count did not settle after filling the index");
      guess = affidavit.getPageCount();
    }
  } else {
    affidavit = await load(input.affidavit, "the affidavit");
    result = plan(affidavit.getPageCount());
  }

  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const helvBold = await out.embedFont(StandardFonts.HelveticaBold);
  const number = (page: PDFPage, n: number) => {
    const { width: pw, height: ph } = page.getSize();
    const t = String(n);
    page.drawText(t, { x: pw - 72 - helv.widthOfTextAtSize(t, 10), y: ph - 1.25 * CM - 10, size: 10, font: helv });
  };
  const stampLabel = (page: PDFPage, label: string) => {
    const { height: ph } = page.getSize();
    const text = winAnsiSafe(label, helvBold);
    const tw = helvBold.widthOfTextAtSize(text, 12);
    const x = 2 * CM;
    const y = ph - 3.3 * CM;
    page.drawRectangle({ x: x - 6, y: y - 6, width: tw + 12, height: 22, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
    page.drawText(text, { x, y, size: 12, font: helvBold });
  };

  let pageNo = 0;
  for (const p of await out.copyPages(affidavit, affidavit.getPageIndices())) {
    out.addPage(p);
    pageNo++;
    if (input.affidavitNumbered === false) number(p, pageNo);
  }
  const outline: { title: string; page: PDFPage }[] = [{ title, page: out.getPage(0) }];
  for (const [i, docs] of loaded.entries()) {
    let first = true;
    for (const { doc, layout } of docs) {
      if (layout === "house-email") {
        for (const p of await out.copyPages(doc, doc.getPageIndices())) {
          out.addPage(p);
          pageNo++;
          if (first) {
            stampLabel(p, labelFmt.replace("{mark}", marks[i]!));
            outline.push({ title: `${marks[i]} ${input.annexures[i]!.description}`, page: p });
          }
          number(p, pageNo);
          first = false;
        }
        continue;
      }
      const embedded = await out.embedPages(doc.getPages());
      for (const e of embedded) {
        const page = out.addPage(A4);
        pageNo++;
        const s = Math.min(W / e.width, H / e.height) * (first ? 0.84 : 0.92);
        page.drawPage(e, { x: (W - e.width * s) / 2, y: 0.6 * CM, xScale: s, yScale: s });
        if (first) {
          stampLabel(page, labelFmt.replace("{mark}", marks[i]!));
          outline.push({ title: `${marks[i]} ${input.annexures[i]!.description}`, page });
        }
        number(page, pageNo);
        first = false;
      }
    }
  }
  addOutline(out, outline);
  out.setCreator("Practy");
  const bytes = await out.save();
  return { bytes, pageCount: pageNo, entries: result.indexRows.map((r) => ({ label: r.annexure ? `${r.annexure} ${r.document}` : r.document, page: r.pages })), plan: result };
}

/**
 * A plain house-style INDEX page (No. | Annexure | Document | Pages), usable as an
 * AffidavitRenderer front page when the affidavit itself is rendered elsewhere.
 */
export async function renderHouseIndex(rows: HouseIndexRow[], heading: string[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  let page = doc.addPage(A4);
  let y = H - MARGIN - 1.5 * CM;
  for (const line of heading) {
    page.drawText(winAnsiSafe(line, fonts.bold), { x: MARGIN, y, size: 12, font: fonts.bold });
    y -= 16;
  }
  const title = "INDEX";
  y -= 8;
  page.drawText(title, { x: W / 2 - width(title, fonts.bold, 12) / 2, y, size: 12, font: fonts.bold });
  y -= 10;
  const cols = [1.4 * CM, 2.6 * CM, W - 2 * MARGIN - 1.4 * CM - 2.6 * CM - 2.6 * CM, 2.6 * CM];
  const pad = 4;
  const draw = (cells: string[], bold: boolean) => {
    const font = bold ? fonts.bold : fonts.regular;
    const wrapped = cells.map((c, i) => wrapText(c, font, 10, cols[i]! - 2 * pad));
    const h = Math.max(...wrapped.map((w) => w.length)) * 12 + 2 * pad;
    if (y - h < MARGIN) {
      page = doc.addPage(A4);
      y = H - MARGIN;
    }
    let x = MARGIN;
    wrapped.forEach((lines, i) => {
      page.drawRectangle({ x, y: y - h, width: cols[i]!, height: h, borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
      lines.forEach((l, j) => page.drawText(winAnsiSafe(l, font), { x: x + pad, y: y - pad - 9 - j * 12, size: 10, font }));
      x += cols[i]!;
    });
    y -= h;
  };
  draw(["No.", "Annexure", "Document", "Pages"], true);
  for (const r of rows) draw([String(r.no), r.annexure, r.document, r.pages], false);
  return doc.save();
}

// ---------------------------------------------------------------------------
// Email to PDF
// ---------------------------------------------------------------------------

export interface EmailMessage {
  from: string;
  to?: string | string[];
  cc?: string | string[];
  /** A Date or an ISO timestamp with offset is shown in timeZone; any other string is printed as is. */
  sent?: Date | string;
  subject?: string;
  attachments?: string[];
  /** Plain text body; used only when there is no HTML (HTML keeps Outlook's list numbering). */
  text?: string;
  html?: string;
  /** IANA zone for the Sent line; default Australia/Perth. */
  timeZone?: string;
}

const TOP_CLEAR = 4.2 * CM;

/** "Monday, 3 March 2025 10:05 am (AWST)": truncated to the minute, like the firm's file names. */
export function formatSent(sent: Date | string, timeZone = "Australia/Perth"): string {
  const d = typeof sent === "string" ? (/^\d{4}-\d{2}-\d{2}T/.test(sent) ? new Date(sent) : undefined) : sent;
  if (!d || Number.isNaN(d.getTime())) return String(sent);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const label = timeZone === "Australia/Perth" ? "AWST" : parts.timeZoneName;
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute} ${String(parts.dayPeriod ?? "").toLowerCase()}${label ? ` (${label})` : ""}`;
}

interface Block {
  indent: number;
  bullet?: string;
  runs: { text: string; b: boolean; i: boolean; u: boolean }[];
}

const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", copy: "©", reg: "®", bull: "•" };
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });

const roman = (n: number) => {
  let out = "";
  for (const [v, r] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) {
    while (n >= v) {
      out += r;
      n -= v;
    }
  }
  return out;
};
const alpha = (n: number) => {
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(97 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};
const marker = (n: number, type: string) =>
  type === "a" ? `${alpha(n)}.` : type === "A" ? `${alpha(n).toUpperCase()}.` : type === "i" ? `${roman(n)}.` : type === "I" ? `${roman(n).toUpperCase()}.` : `${n}.`;

const BLOCK_TAGS = new Set(["p", "div", "li", "tr", "table", "tbody", "thead", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "hr", "ol", "ul", "pre", "center"]);
const SKIP_TAGS = new Set(["head", "style", "script", "title", "xml"]);
const VOID_TAGS = new Set(["br", "img", "hr", "meta", "link", "input", "col", "area", "base", "wbr"]);

function hiddenStyle(style: string): boolean {
  const st = style.replace(/\s/g, "").toLowerCase();
  if (st.includes("display:none") || st.includes("visibility:hidden") || st.includes("mso-hide:all")) return true;
  const m = /font-size:([\d.]+)pt/.exec(st);
  return !!m && parseFloat(m[1]!) <= 1.5;
}

/**
 * HTML email → blocks, keeping what the reader saw: Outlook writes each numbered
 * paragraph as its own <ol start="N">, so list numbering must come from the HTML
 * (the plain-text alternative restarts every list at 1). Hidden preview text and
 * banners, link targets and repeated blank lines are dropped; wording is not changed.
 */
export function htmlToBlocks(html: string): Block[] {
  const src = html.replace(/ZjQcmQRYFpfptBannerStart[^]*?ZjQcmQRYFpfptBannerEnd/g, "").replace(/<!--[^]*?-->/g, "");
  const blocks: Block[] = [];
  let cur: Block["runs"] = [];
  let bullet: string | undefined;
  const stack: { tag: string; hidden: boolean }[] = [];
  const lists: { type: string; n: number }[] = [];
  let quote = 0;
  let skip = 0;
  let hidden = 0;
  const fmt = { b: 0, i: 0, u: 0 };
  const indent = () => 18 * lists.length + 14 * quote;
  const flush = () => {
    const raw = cur.map((r) => r.text).join("");
    const blank = !raw.replace(/ /g, "").trim();
    if (!blank || bullet) {
      // Collapse whitespace across runs, trimming the block's ends.
      const runs = cur.map((r) => ({ ...r, text: r.text.replace(/[ \t\r\n ]+/g, " ") })).filter((r) => r.text);
      if (runs.length) {
        runs[0]!.text = runs[0]!.text.trimStart();
        runs[runs.length - 1]!.text = runs[runs.length - 1]!.text.trimEnd();
      }
      for (const r of runs) r.text = r.text.replace(/<https?:\/\/[^>\s]*>/g, "");
      blocks.push({ indent: indent(), bullet, runs: runs.filter((r) => r.text) });
    } else if (blocks.length && !(blocks[blocks.length - 1]!.runs.length === 0 && !blocks[blocks.length - 1]!.bullet)) {
      blocks.push({ indent: 0, runs: [] });
    }
    cur = [];
    bullet = undefined;
  };
  const tokens = src.match(/<\/?[a-zA-Z][^>]*>|<![^>]*>|[^<]+|</g) ?? [];
  for (const tok of tokens) {
    if (tok.startsWith("<!")) continue;
    const tm = /^<(\/?)([a-zA-Z][a-zA-Z0-9:]*)([^>]*)>$/.exec(tok);
    if (!tm) {
      if (!skip && !hidden) cur.push({ text: decodeEntities(tok), b: fmt.b > 0, i: fmt.i > 0, u: fmt.u > 0 });
      continue;
    }
    const closing = tm[1] === "/";
    const tag = tm[2]!.toLowerCase();
    if (SKIP_TAGS.has(tag)) {
      skip = closing ? Math.max(0, skip - 1) : skip + (tm[3]!.trim().endsWith("/") ? 0 : 1);
      continue;
    }
    if (!closing) {
      const attrs = tm[3]!;
      const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
      const a = (name: string) => {
        const m = attr(name);
        return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : undefined;
      };
      const hid = hiddenStyle(a("style") ?? "");
      const selfClosing = VOID_TAGS.has(tag) || attrs.trim().endsWith("/");
      if (!selfClosing) {
        stack.push({ tag, hidden: hid });
        if (hid) hidden++;
      }
      if (skip || hidden) continue;
      if (BLOCK_TAGS.has(tag) || tag === "br") flush();
      if (tag === "blockquote") quote++;
      else if (tag === "ol") lists.push({ type: a("type") || "1", n: (parseInt(a("start") ?? "1", 10) || 1) - 1 });
      else if (tag === "ul") lists.push({ type: "ul", n: 0 });
      else if (tag === "li") {
        const l = lists[lists.length - 1];
        if (l) {
          l.n++;
          bullet = l.type === "ul" ? "•" : marker(l.n, l.type);
        } else bullet = "•";
      } else if (tag === "b" || tag === "strong") fmt.b++;
      else if (tag === "i" || tag === "em") fmt.i++;
      else if (tag === "u") fmt.u++;
      else if (tag === "td") cur.push({ text: " ", b: false, i: false, u: false });
      continue;
    }
    if (VOID_TAGS.has(tag)) continue;
    let wasHidden = false;
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k]!.tag !== tag) continue;
      for (const s of stack.slice(k)) {
        if (s.hidden) {
          hidden--;
          wasHidden ||= s.tag === tag;
        }
      }
      stack.length = k;
      break;
    }
    if (skip || hidden || wasHidden) continue;
    if (tag === "b" || tag === "strong") fmt.b = Math.max(0, fmt.b - 1);
    else if (tag === "i" || tag === "em") fmt.i = Math.max(0, fmt.i - 1);
    else if (tag === "u") fmt.u = Math.max(0, fmt.u - 1);
    if (BLOCK_TAGS.has(tag)) flush();
    if (tag === "blockquote") quote = Math.max(0, quote - 1);
    else if ((tag === "ol" || tag === "ul") && lists.length) lists.pop();
  }
  flush();
  while (blocks.length && !blocks[blocks.length - 1]!.runs.length && !blocks[blocks.length - 1]!.bullet) blocks.pop();
  while (blocks.length && !blocks[0]!.runs.length && !blocks[0]!.bullet) blocks.shift();
  return blocks;
}

/** Plain-text clean-up: banners, bare link targets, runs of blank or ">"-only lines. */
function cleanPlain(body: string): string {
  const s = body
    .replace(/\r\n/g, "\n")
    .replace(/ZjQcmQRYFpfptBannerStart[^]*?ZjQcmQRYFpfptBannerEnd\n?/g, "")
    .replace(/<https?:\/\/[^>\s]*>/g, "")
    .replace(/<\+\d[^>]*>/g, "");
  const out: string[] = [];
  let prevEmpty = false;
  for (const ln of s.split("\n")) {
    const empty = /^[>\s]*$/.test(ln);
    if (empty && prevEmpty) continue;
    out.push(empty ? "" : ln);
    prevEmpty = empty;
  }
  return out.join("\n").trim();
}

/**
 * Print an email in the house annexure layout: header block (From, Sent, To, Cc,
 * Subject, Attachments), a rule, then the whole body including the quoted chain.
 * The top 4.2 cm of every page is left clear for an annexure label and page number.
 */
export async function emailToPdf(message: EmailMessage): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const left = 2 * CM;
  const right = W - 2 * CM;
  const bottom = 2 * CM;
  const size = 9.5;
  let page = doc.addPage(A4);
  let y = H - TOP_CLEAR;
  const ensure = (h: number) => {
    if (y - h < bottom) {
      page = doc.addPage(A4);
      y = H - TOP_CLEAR;
    }
  };
  const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : (v ?? ""));
  const header: [string, string][] = [
    ["From:", message.from],
    ["Sent:", message.sent ? formatSent(message.sent, message.timeZone) : ""],
    ["To:", list(message.to)],
    ["Cc:", list(message.cc)],
    ["Subject:", (message.subject ?? "").replace(/\s+/g, " ").trim()],
    ["Attachments:", (message.attachments ?? []).join("; ")],
  ];
  const labelW = 2.6 * CM;
  const headLead = 12;
  for (const [k, v] of header) {
    if (!v) continue;
    const lines = wrapText(v, fonts.regular, size, right - left - labelW - 4);
    ensure(lines.length * headLead + 3);
    y -= 1;
    drawSegs(page, [{ text: k, font: fonts.bold }], left, y - size, size);
    lines.forEach((l, i) => drawSegs(page, [{ text: l, font: fonts.regular }], left + labelW, y - size - i * headLead, size));
    y -= lines.length * headLead + 2;
  }
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.8, color: rgb(0, 0, 0) });
  y -= 10;

  const lead = 12.5;
  const blocks: Block[] = message.html?.trim()
    ? htmlToBlocks(message.html)
    : cleanPlain(message.text ?? "")
        .split("\n")
        .map((l) => ({ indent: 0, runs: l.trim() ? [{ text: l, b: false, i: false, u: false }] : [] }));
  const fontFor = (r: Block["runs"][number]) => (r.b && r.i ? fonts.boldItalic : r.b ? fonts.bold : r.i ? fonts.italic : fonts.regular);
  for (const b of blocks) {
    const textX = left + (b.bullet ? b.indent + 4 : b.indent);
    const lines = b.runs.length ? wrapSegs(b.runs.map((r) => ({ text: r.text, font: fontFor(r), underline: r.u })), size, right - textX) : [[]];
    lines.forEach((segs, i) => {
      ensure(lead);
      y -= lead;
      if (i === 0 && b.bullet) drawSegs(page, [{ text: b.bullet, font: fonts.regular }], left + Math.max(0, b.indent - 16), y + 3, size);
      drawSegs(page, segs, textX, y + 3, size);
    });
  }
  doc.setTitle(message.subject ?? "Email", { showInWindowTitleBar: false });
  doc.setCreator("Practy");
  return doc.save();
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/** Text of each page, in page order (index 0 = page 1), for citation checks. */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  // pdf.js may transfer (detach) the buffer it is given, so pass a copy.
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
  return text;
}
