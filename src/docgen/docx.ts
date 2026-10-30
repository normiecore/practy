/**
 * Shared .docx helpers: zip access, XML escaping, a tiny lossless XML tree for
 * WordprocessingML, tagged-template filling and split-run-safe token replacement.
 *
 * No XML library is a direct dependency, and OOXML parts are plain well-formed XML
 * (no DTDs or entities beyond the predefined five), so a small tokenizer is enough.
 * Text and attribute values are kept in their escaped form so untouched parts of a
 * document round-trip byte for byte.
 */
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

export const DOCUMENT_XML = "word/document.xml";

export function openDocx(bytes: Uint8Array): PizZip {
  try {
    return new PizZip(bytes);
  } catch (e) {
    throw new Error(`Not a readable .docx (zip): ${(e as Error).message}`);
  }
}

export function getPart(zip: PizZip, path: string): string | undefined {
  return zip.file(path)?.asText();
}

export function setPart(zip: PizZip, path: string, xml: string): void {
  zip.file(path, xml);
}

export function getDocumentXml(zip: PizZip): string {
  const xml = getPart(zip, DOCUMENT_XML);
  if (xml === undefined) throw new Error("Not a .docx: word/document.xml is missing");
  return xml;
}

export function setDocumentXml(zip: PizZip, xml: string): void {
  setPart(zip, DOCUMENT_XML, xml);
}

export function saveDocx(zip: PizZip): Uint8Array {
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function xmlUnescape(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

// ---------------------------------------------------------------------------
// Minimal lossless XML tree
// ---------------------------------------------------------------------------

export interface XmlElement {
  type: "element";
  name: string;
  /** Attribute values in escaped (serialised) form, in source order. */
  attrs: [string, string][];
  children: XmlNode[];
  parent: XmlElement | null;
}
/** Text in escaped form, exactly as it appeared. */
export interface XmlText {
  type: "text";
  raw: string;
  parent: XmlElement | null;
}
/** Declarations, comments, processing instructions and CDATA, passed through verbatim. */
export interface XmlOther {
  type: "other";
  raw: string;
  parent: XmlElement | null;
}
export type XmlNode = XmlElement | XmlText | XmlOther;

export interface XmlDocument {
  /** Nodes before and after the root element (declaration, whitespace). */
  prolog: XmlNode[];
  root: XmlElement;
  epilog: XmlNode[];
}

const ATTR = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function parseXml(xml: string): XmlDocument {
  const top: XmlNode[] = [];
  const stack: XmlElement[] = [];
  const add = (n: XmlNode) => {
    const parent = stack[stack.length - 1];
    if (parent) {
      n.parent = parent;
      parent.children.push(n);
    } else top.push(n);
  };
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      add({ type: "text", raw: xml.slice(i), parent: null });
      break;
    }
    if (lt > i) add({ type: "text", raw: xml.slice(i, lt), parent: null });
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      if (end === -1) throw new Error("Unterminated XML comment");
      add({ type: "other", raw: xml.slice(lt, end + 3), parent: null });
      i = end + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      if (end === -1) throw new Error("Unterminated CDATA");
      add({ type: "other", raw: xml.slice(lt, end + 3), parent: null });
      i = end + 3;
    } else if (xml[lt + 1] === "?" || xml[lt + 1] === "!") {
      const end = xml.indexOf(">", lt);
      add({ type: "other", raw: xml.slice(lt, end + 1), parent: null });
      i = end + 1;
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt);
      const name = xml.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`Mismatched XML close tag </${name}>`);
      i = end + 1;
    } else {
      // Attribute values cannot contain a raw ">" in well-formed OOXML... except they can,
      // so scan quoted sections to find the real end of the tag.
      let j = lt + 1;
      let quote = "";
      for (; j < xml.length; j++) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (j >= xml.length) throw new Error("Unterminated XML tag");
      const selfClosing = xml[j - 1] === "/";
      const body = xml.slice(lt + 1, selfClosing ? j - 1 : j);
      const nameEnd = body.search(/[\s/]|$/);
      const el: XmlElement = { type: "element", name: body.slice(0, nameEnd), attrs: [], children: [], parent: null };
      for (const m of body.slice(nameEnd).matchAll(ATTR)) el.attrs.push([m[1]!, m[3] ?? m[4] ?? ""]);
      add(el);
      if (!selfClosing) stack.push(el);
      i = j + 1;
    }
  }
  if (stack.length) throw new Error(`Unclosed XML element <${stack[stack.length - 1]!.name}>`);
  const rootIndex = top.findIndex((n) => n.type === "element");
  if (rootIndex === -1) throw new Error("XML has no root element");
  return { prolog: top.slice(0, rootIndex), root: top[rootIndex] as XmlElement, epilog: top.slice(rootIndex + 1) };
}

function serializeNode(n: XmlNode, out: string[]): void {
  if (n.type !== "element") {
    out.push(n.raw);
    return;
  }
  out.push("<", n.name);
  for (const [k, v] of n.attrs) out.push(" ", k, '="', v.replace(/"/g, "&quot;"), '"');
  if (n.children.length === 0) {
    out.push("/>");
    return;
  }
  out.push(">");
  for (const c of n.children) serializeNode(c, out);
  out.push("</", n.name, ">");
}

export function serializeXml(doc: XmlDocument): string {
  const out: string[] = [];
  for (const n of doc.prolog) serializeNode(n, out);
  serializeNode(doc.root, out);
  for (const n of doc.epilog) serializeNode(n, out);
  return out.join("");
}

export function serializeElement(el: XmlElement): string {
  const out: string[] = [];
  serializeNode(el, out);
  return out.join("");
}

export function el(name: string, attrs: Record<string, string> = {}, children: XmlNode[] = []): XmlElement {
  const e: XmlElement = { type: "element", name, attrs: Object.entries(attrs).map(([k, v]) => [k, xmlEscape(v)]), children: [], parent: null };
  for (const c of children) appendChild(e, c);
  return e;
}

export function textNode(text: string): XmlText {
  return { type: "text", raw: xmlEscape(text), parent: null };
}

export function appendChild(parent: XmlElement, child: XmlNode): void {
  child.parent = parent;
  parent.children.push(child);
}

export function removeNode(n: XmlNode): void {
  const p = n.parent;
  if (!p) return;
  const i = p.children.indexOf(n);
  if (i !== -1) p.children.splice(i, 1);
  n.parent = null;
}

/** Replace an element with its children (used to unwrap revision wrappers). */
export function unwrap(n: XmlElement): void {
  const p = n.parent;
  if (!p) return;
  const i = p.children.indexOf(n);
  for (const c of n.children) c.parent = p;
  p.children.splice(i, 1, ...n.children);
  n.children = [];
  n.parent = null;
}

export function getAttr(e: XmlElement, name: string): string | undefined {
  const a = e.attrs.find(([k]) => k === name);
  return a ? xmlUnescape(a[1]) : undefined;
}

export function setAttr(e: XmlElement, name: string, value: string): void {
  const a = e.attrs.find(([k]) => k === name);
  if (a) a[1] = xmlEscape(value);
  else e.attrs.push([name, xmlEscape(value)]);
}

/** Depth-first, document order. */
export function* descendants(root: XmlElement): Generator<XmlElement> {
  for (const c of root.children) {
    if (c.type !== "element") continue;
    yield c;
    yield* descendants(c);
  }
}

export function findAll(root: XmlElement, name: string): XmlElement[] {
  return [...descendants(root)].filter((e) => e.name === name);
}

export function childElements(e: XmlElement, name?: string): XmlElement[] {
  return e.children.filter((c): c is XmlElement => c.type === "element" && (name === undefined || c.name === name));
}

export function hasAncestor(n: XmlNode, names: ReadonlySet<string>): boolean {
  for (let p = n.parent; p; p = p.parent) if (names.has(p.name)) return true;
  return false;
}

/** Unescaped text of a w:t (or any text-only element). */
export function elementText(e: XmlElement): string {
  return e.children.map((c) => (c.type === "text" ? xmlUnescape(c.raw) : "")).join("");
}

export function setElementText(e: XmlElement, text: string): void {
  for (const c of e.children) c.parent = null;
  e.children = text ? [{ type: "text", raw: xmlEscape(text), parent: e }] : [];
  // Word drops leading/trailing spaces without this.
  if (/^\s|\s$/.test(text) || /\s\s/.test(text)) setAttr(e, "xml:space", "preserve");
}

// ---------------------------------------------------------------------------
// Tagged templates (firms whose templates use {{tags}})
// ---------------------------------------------------------------------------

export interface FillTaggedOptions {
  /** "error" (default) refuses to produce a document with unfilled tags; "blank" leaves them empty. */
  missing?: "error" | "blank";
}

/**
 * Render a template that uses {{tag}}, {{#loop}}…{{/loop}} and {{^cond}} sections.
 * paragraphLoop keeps loops that span whole paragraphs from leaving blank lines.
 */
export function fillTagged(templateBytes: Uint8Array, data: Record<string, unknown>, opts: FillTaggedOptions = {}): Uint8Array {
  const zip = openDocx(templateBytes);
  const missing: string[] = [];
  const templateError = (e: unknown) => {
    const err = e as { properties?: { errors?: { properties?: { explanation?: string } }[]; explanation?: string } };
    const detail = err.properties?.errors?.map((x) => x.properties?.explanation).filter(Boolean).join("; ") || err.properties?.explanation;
    return new Error(`Template error: ${detail || (e as Error).message}`);
  };
  let doc: Docxtemplater;
  try {
    // The constructor compiles the template, so syntax errors surface here.
    doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: (part: { value?: string; module?: string }) => {
        if (!part.module && part.value) missing.push(part.value);
        return "";
      },
    });
    doc.render(data);
  } catch (e) {
    throw templateError(e);
  }
  if (missing.length && (opts.missing ?? "error") === "error") {
    throw new Error(`Template tags with no value: ${[...new Set(missing)].join(", ")}`);
  }
  return doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" });
}

// ---------------------------------------------------------------------------
// Token replacement that survives Word splitting text across runs
// ---------------------------------------------------------------------------

interface TextSlot {
  node: XmlElement;
  text: string;
}

/** w:t nodes of a paragraph that belong to it (not to a nested text-box paragraph). */
function paragraphSlots(p: XmlElement): TextSlot[] {
  const slots: TextSlot[] = [];
  const walk = (e: XmlElement) => {
    for (const c of e.children) {
      if (c.type !== "element" || c.name === "w:p") continue;
      if (c.name === "w:t") slots.push({ node: c, text: elementText(c) });
      else walk(c);
    }
  };
  walk(p);
  return slots;
}

/** Paragraph-like containers to search: every w:p (headers/footers use them too). */
function paragraphs(root: XmlElement): XmlElement[] {
  const ps = findAll(root, "w:p");
  return ps.length ? ps : [root];
}

export type TextReplacer = string | ((match: RegExpExecArray) => string);

/**
 * Regex replace over the visible text of each paragraph, even when the match spans
 * several runs (Word splits "{{CLIENT_NAME}}" into "{{", "CLIENT_NAME", "}}" after
 * spell-check or an edit).
 *
 * Approach ("stitching" rather than merging runs): the paragraph's w:t texts are
 * concatenated, matches are found on that string, and each match is written back into
 * the w:t where it starts; the matched characters are removed from the following w:t
 * nodes. Every run keeps its own properties, so the replacement takes the formatting
 * of the run where the token began, and text around the token is untouched. Runs that
 * end up empty are left in place (harmless, and keeps bookmarks/fields intact).
 *
 * Returns the new XML and the number of replacements made.
 */
export function replaceTextPattern(xml: string, pattern: RegExp, replacement: TextReplacer, limit = Infinity): { xml: string; count: number } {
  const doc = parseXml(xml);
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  let count = 0;
  for (const p of paragraphs(doc.root)) {
    if (count >= limit) break;
    const slots = paragraphSlots(p);
    if (!slots.length) continue;
    let full = slots.map((s) => s.text).join("");
    const re = new RegExp(pattern.source, flags);
    const edits: { start: number; end: number; value: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(full)) && count + edits.length < limit) {
      if (m[0] === "") {
        re.lastIndex++;
        continue;
      }
      edits.push({ start: m.index, end: m.index + m[0].length, value: typeof replacement === "string" ? expand(replacement, m) : replacement(m) });
    }
    if (!edits.length) continue;
    // Apply right to left so earlier offsets stay valid.
    for (const edit of edits.reverse()) {
      let offset = 0;
      for (const s of slots) {
        const sStart = offset;
        const sEnd = offset + s.text.length;
        offset = sEnd;
        if (sEnd <= edit.start || sStart >= edit.end) continue;
        const from = Math.max(edit.start, sStart) - sStart;
        const to = Math.min(edit.end, sEnd) - sStart;
        const insert = sStart <= edit.start && edit.start < sEnd ? edit.value : "";
        s.text = s.text.slice(0, from) + insert + s.text.slice(to);
      }
      // Recompute positions for the next (earlier) edit.
      full = slots.map((s) => s.text).join("");
      count++;
    }
    for (const s of slots) if (s.text !== elementText(s.node)) setElementText(s.node, s.text);
  }
  return { xml: count ? serializeXml(doc) : xml, count };
}

function expand(template: string, m: RegExpExecArray): string {
  return template.replace(/\$(\$|&|\d{1,2})/g, (_, k: string) => (k === "$" ? "$" : k === "&" ? m[0] : (m[Number(k)] ?? "")));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replace literal tokens (e.g. "{{CLIENT_NAME}}") with plain-text values, coping with
 * tokens split across runs. Values are XML-escaped. Every occurrence is replaced.
 */
export function replaceTokens(xml: string, map: Record<string, string>): { xml: string; replaced: Record<string, number> } {
  const replaced: Record<string, number> = {};
  let out = xml;
  for (const [token, value] of Object.entries(map)) {
    const r = replaceTextPattern(out, new RegExp(escapeRegExp(token), "g"), () => value);
    replaced[token] = r.count;
    out = r.xml;
  }
  return { xml: out, replaced };
}

/** Visible text of a document part, one line per paragraph (for tests and checks). */
export function docxText(xml: string): string {
  const doc = parseXml(xml);
  return findAll(doc.root, "w:p")
    .map((p) =>
      [...descendants(p)]
        .filter((e) => (e.name === "w:t" || (e.name === "w:tab" && e.parent?.name === "w:r")) && nearestParagraph(e) === p)
        .map((e) => (e.name === "w:tab" ? "\t" : elementText(e)))
        .join(""),
    )
    .join("\n");
}

function nearestParagraph(n: XmlNode): XmlElement | null {
  for (let p = n.parent; p; p = p.parent) if (p.name === "w:p") return p;
  return null;
}
