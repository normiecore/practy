/**
 * Tracked changes → static markup, for e-filing portals that reject documents with
 * revisions but still need amendments to show.
 *
 *   insertion (w:ins, w:moveTo)      → text kept, coloured single underline
 *   deletion  (w:del, w:moveFrom)    → text kept (delText → t), coloured strikethrough
 *   inserted then deleted            → dropped (net churn)
 *   format-only (*PrChange)          → accepted (current formatting kept)
 *   move/custom-XML range markers    → removed
 *   paragraph-mark revisions         → removed; the paragraph break is kept
 *
 * Afterwards no revision element remains; this is verified and a residue throws.
 */
import {
  childElements,
  descendants,
  el,
  getPart,
  openDocx,
  parseXml,
  removeNode,
  saveDocx,
  serializeXml,
  setAttr,
  setPart,
  unwrap,
  type XmlElement,
} from "./docx.js";

const INSERT = new Set(["w:ins", "w:moveTo"]);
const DELETE = new Set(["w:del", "w:moveFrom"]);
const RANGE_MARKERS = new Set([
  "w:moveFromRangeStart",
  "w:moveFromRangeEnd",
  "w:moveToRangeStart",
  "w:moveToRangeEnd",
  "w:customXmlInsRangeStart",
  "w:customXmlInsRangeEnd",
  "w:customXmlDelRangeStart",
  "w:customXmlDelRangeEnd",
  "w:customXmlMoveFromRangeStart",
  "w:customXmlMoveFromRangeEnd",
  "w:customXmlMoveToRangeStart",
  "w:customXmlMoveToRangeEnd",
]);
const FORMAT_CHANGES = new Set(["w:rPrChange", "w:pPrChange", "w:tblPrChange", "w:trPrChange", "w:tcPrChange", "w:sectPrChange", "w:tblGridChange", "w:numberingChange", "w:tblPrExChange"]);

/** Every element name that counts as live revision tracking. */
export const REVISION_ELEMENTS: ReadonlySet<string> = new Set([...INSERT, ...DELETE, ...RANGE_MARKERS, ...FORMAT_CHANGES, "w:delText", "w:delInstrText"]);

// Schema order of <w:rPr> children (EG_RPrBase), so inserted properties validate.
const RPR_ORDER = [
  "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof",
  "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd",
  "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath",
];
const order = (name: string) => {
  const i = RPR_ORDER.indexOf(name.replace(/^w:/, ""));
  return i === -1 ? RPR_ORDER.length : i;
};

function ensureRPr(run: XmlElement): XmlElement {
  let rpr = childElements(run, "w:rPr")[0];
  if (!rpr) {
    rpr = el("w:rPr");
    rpr.parent = run;
    run.children.unshift(rpr); // rPr must be the run's first child
  }
  return rpr;
}

function setProp(rpr: XmlElement, name: string, attrs: Record<string, string> = {}): void {
  for (const existing of childElements(rpr, name)) removeNode(existing);
  const prop = el(name);
  for (const [k, v] of Object.entries(attrs)) setAttr(prop, k, v);
  prop.parent = rpr;
  const target = order(name);
  const idx = rpr.children.findIndex((c) => c.type === "element" && order(c.name) > target);
  if (idx === -1) rpr.children.push(prop);
  else rpr.children.splice(idx, 0, prop);
}

export interface MarkupOptions {
  /** Hex colour without "#"; default FF0000. */
  color?: string;
  /** Also remove comments (anchors, references and the comment parts). */
  stripComments?: boolean;
}

export interface MarkupReport {
  insertionsStyled: number;
  deletionsStyled: number;
  churnRunsDropped: number;
  formatChangesAccepted: number;
  trackChangesSettingRemoved: number;
  commentMarkersRemoved: number;
  commentPartsDropped: number;
}

export class MarkupError extends Error {}

/** Convert the revisions in one XML part (document, header, footer, footnotes…). */
export function tracksToMarkupXml(xml: string, color = "FF0000"): { xml: string; report: Pick<MarkupReport, "insertionsStyled" | "deletionsStyled" | "churnRunsDropped" | "formatChangesAccepted"> } {
  const doc = parseXml(xml);
  const all = () => [...descendants(doc.root)];

  for (const e of all()) if (RANGE_MARKERS.has(e.name)) removeNode(e);
  let formatChangesAccepted = 0;
  for (const e of all()) {
    if (FORMAT_CHANGES.has(e.name)) {
      removeNode(e);
      formatChangesAccepted++;
    }
  }
  // A w:ins/w:del inside rPr marks the paragraph mark (or a run's own mark) as
  // revised; removing it keeps the paragraph break, as Word's "keep" would.
  for (const e of all()) if ((INSERT.has(e.name) || DELETE.has(e.name)) && e.parent?.name === "w:rPr") removeNode(e);

  let insertionsStyled = 0;
  let deletionsStyled = 0;
  let churnRunsDropped = 0;
  for (const run of all().filter((e) => e.name === "w:r")) {
    let ins = false;
    let del = false;
    for (let p = run.parent; p; p = p.parent) {
      if (INSERT.has(p.name)) ins = true;
      else if (DELETE.has(p.name)) del = true;
    }
    if (ins && del) {
      removeNode(run);
      churnRunsDropped++;
    } else if (del) {
      for (const c of childElements(run)) {
        if (c.name === "w:delText") c.name = "w:t";
        else if (c.name === "w:delInstrText") c.name = "w:instrText";
      }
      const rpr = ensureRPr(run);
      setProp(rpr, "w:color", { "w:val": color });
      setProp(rpr, "w:strike");
      deletionsStyled++;
    } else if (ins) {
      const rpr = ensureRPr(run);
      setProp(rpr, "w:color", { "w:val": color });
      setProp(rpr, "w:u", { "w:val": "single" });
      insertionsStyled++;
    }
  }
  // Unwrap wrappers innermost-first until none remain.
  for (;;) {
    const wrappers = all().filter((e) => INSERT.has(e.name) || DELETE.has(e.name));
    if (!wrappers.length) break;
    for (const w of wrappers.reverse()) unwrap(w);
  }
  return { xml: serializeXml(doc), report: { insertionsStyled, deletionsStyled, churnRunsDropped, formatChangesAccepted } };
}

/** Names of revision elements still present in an XML part (empty when clean). */
export function residualRevisions(xml: string): string[] {
  const doc = parseXml(xml);
  return [...new Set([...descendants(doc.root)].filter((e) => REVISION_ELEMENTS.has(e.name)).map((e) => e.name))].sort();
}

const COMMENT_PARTS = ["word/comments.xml", "word/commentsExtended.xml", "word/commentsIds.xml", "word/commentsExtensible.xml", "word/people.xml"];

function stripCommentMarkers(xml: string): { xml: string; removed: number } {
  const doc = parseXml(xml);
  let removed = 0;
  for (const e of [...descendants(doc.root)]) {
    if (e.name === "w:commentRangeStart" || e.name === "w:commentRangeEnd") {
      removeNode(e);
      removed++;
    } else if (e.name === "w:r" && childElements(e, "w:commentReference").length) {
      removeNode(e);
      removed++;
    }
  }
  return { xml: removed ? serializeXml(doc) : xml, removed };
}

/** Parts whose content can carry revisions. */
const STORY_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

/**
 * Convert every tracked change in a .docx to static coloured markup and strip all
 * revision metadata. Throws if any revision element survives.
 */
export function tracksToMarkup(docxBytes: Uint8Array, opts: MarkupOptions = {}): { bytes: Uint8Array; report: MarkupReport } {
  const color = (opts.color ?? "FF0000").replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(color)) throw new MarkupError(`Invalid colour "${opts.color}"; use 6-digit hex like FF0000`);
  const zip = openDocx(docxBytes);
  if (!zip.file("word/document.xml")) throw new MarkupError("Not a .docx: word/document.xml is missing");

  const report: MarkupReport = { insertionsStyled: 0, deletionsStyled: 0, churnRunsDropped: 0, formatChangesAccepted: 0, trackChangesSettingRemoved: 0, commentMarkersRemoved: 0, commentPartsDropped: 0 };
  const stories = Object.keys(zip.files).filter((p) => STORY_PART.test(p) && !(opts.stripComments && COMMENT_PARTS.includes(p)));
  for (const path of stories) {
    const out = tracksToMarkupXml(getPart(zip, path)!, color);
    report.insertionsStyled += out.report.insertionsStyled;
    report.deletionsStyled += out.report.deletionsStyled;
    report.churnRunsDropped += out.report.churnRunsDropped;
    report.formatChangesAccepted += out.report.formatChangesAccepted;
    setPart(zip, path, out.xml);
  }

  // Stop the file reopening in tracking mode.
  const settings = getPart(zip, "word/settings.xml");
  if (settings) {
    const doc = parseXml(settings);
    for (const e of [...descendants(doc.root)]) {
      if (e.name === "w:trackChanges") {
        removeNode(e);
        report.trackChangesSettingRemoved++;
      }
    }
    if (report.trackChangesSettingRemoved) setPart(zip, "word/settings.xml", serializeXml(doc));
  }

  if (opts.stripComments) {
    for (const path of stories) {
      const out = stripCommentMarkers(getPart(zip, path)!);
      report.commentMarkersRemoved += out.removed;
      if (out.removed) setPart(zip, path, out.xml);
    }
    const dropped = COMMENT_PARTS.filter((p) => zip.file(p));
    for (const p of dropped) zip.remove(p);
    report.commentPartsDropped = dropped.length;
    // Unlike the original script, also drop the relationships and content-type
    // overrides that pointed at the removed parts, so Word does not report damage.
    if (dropped.length) {
      const names = new Set(dropped.map((p) => p.replace(/^word\//, "")));
      const rels = getPart(zip, "word/_rels/document.xml.rels");
      if (rels) {
        const doc = parseXml(rels);
        for (const r of childElements(doc.root, "Relationship")) {
          const target = r.attrs.find(([k]) => k === "Target")?.[1] ?? "";
          if (names.has(target.replace(/^\.?\/?(word\/)?/, ""))) removeNode(r);
        }
        setPart(zip, "word/_rels/document.xml.rels", serializeXml(doc));
      }
      const types = getPart(zip, "[Content_Types].xml");
      if (types) {
        const doc = parseXml(types);
        for (const o of childElements(doc.root, "Override")) {
          const part = o.attrs.find(([k]) => k === "PartName")?.[1] ?? "";
          if (dropped.includes(part.replace(/^\//, ""))) removeNode(o);
        }
        setPart(zip, "[Content_Types].xml", serializeXml(doc));
      }
    }
  }

  for (const path of stories.filter((p) => zip.file(p))) {
    const residual = residualRevisions(getPart(zip, path)!);
    if (residual.length) throw new MarkupError(`Revision elements remain in ${path}: ${residual.join(", ")}`);
  }
  return { bytes: saveDocx(zip), report };
}
