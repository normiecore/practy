/**
 * Letters on the firm's own letterhead .docx (a tenant asset).
 *
 * Only the paragraphs inside <w:body> are replaced. The body-level <w:sectPr> is kept
 * verbatim, and with it the header/footer references, the page margins that leave room
 * for the logo, and every other part of the package (header, footer, media, styles).
 * Rebuilding a header by hand loses the embedded logo, so this never touches them.
 */
import { getDocumentXml, openDocx, saveDocx, setDocumentXml, xmlEscape } from "./docx.js";

export interface LetterSender {
  name: string;
  title: string;
  email: string;
  phone: string;
}

export interface SignOffStyle {
  /** The script sign-off text, usually the firm name. */
  text: string;
  font: string;
  /** Point size (the house style is 36pt). */
  sizePt: number;
  /** Hex colour without "#". */
  color: string;
}

/** Per-firm (or per-fee-earner) letter settings. Stored as tenant data, never in code. */
export interface LetterProfile {
  sender: LetterSender;
  signOff: SignOffStyle;
  /** Defaults to "Yours faithfully". */
  closing?: string;
  /** Body font; defaults to Times New Roman. */
  bodyFont?: string;
  /** Colour of the "|" between the sender's name and title (hex, no "#"). */
  accentColor?: string;
  /** Tab stop (twips) for the right-hand sender column; defaults to 6804. */
  rightColumnTwips?: number;
}

export interface Letter {
  /** As printed, e.g. "1 July 2026". */
  date: string;
  /** Practice management contact ref; omitted when blank. */
  contactRef?: string;
  /** Postal address lines, name first. */
  addressee: string[];
  byEmail?: string;
  /** Name after "Dear ". */
  salutation: string;
  /** Bold 14pt matter line, e.g. "[1456] Client – Matter description". */
  referenceLine?: string;
  /** One string per paragraph; justified. */
  body: string[];
  enclosure?: boolean;
}

export class LetterheadError extends Error {}

const rFonts = (font: string, cs = font) => `<w:rFonts w:ascii="${xmlEscape(font)}" w:eastAsia="Calibri" w:hAnsi="${xmlEscape(font)}" w:cs="${xmlEscape(cs)}"/>`;

/** Build the letter XML paragraphs (exported for tests and previews). */
export function letterBodyXml(letter: Letter, profile: LetterProfile): string {
  const font = profile.bodyFont ?? "Times New Roman";
  const BASE = `${rFonts(font)}<w:lang w:val="en-US"/>`;
  const BOLD = `${rFonts(font)}<w:b/><w:bCs/><w:lang w:val="en-US"/>`;
  const SMALLB = `${rFonts(font)}<w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US"/>`;
  const TABS = `<w:tabs><w:tab w:val="left" w:pos="${profile.rightColumnTwips ?? 6804}"/></w:tabs>`;
  const IND = '<w:ind w:left="720" w:hanging="720"/>';
  const t = (s: string) => `<w:t xml:space="preserve">${xmlEscape(s)}</w:t>`;
  const run = (s: string, rpr = BASE) => `<w:r><w:rPr>${rpr}</w:rPr>${t(s)}</w:r>`;
  const tab = `<w:r><w:rPr>${BASE}</w:rPr><w:tab/></w:r>`;
  const para = (ppr: string, runs: string) => `<w:p><w:pPr>${ppr}<w:rPr>${BASE}</w:rPr></w:pPr>${runs}</w:p>`;
  const blank = `<w:p><w:pPr><w:rPr>${SMALLB}</w:rPr></w:pPr></w:p>`;

  const { sender, signOff } = profile;
  const out: string[] = [blank];

  // Date, then the contact ref in the right column.
  const ref = letter.contactRef?.trim();
  out.push(para(TABS, run(letter.date) + tab + (ref ? run(`Contact Ref: ${ref}`, SMALLB) : "")), blank);

  // Sender name | title, right column.
  out.push(
    para(
      TABS + IND,
      `<w:r><w:rPr>${BASE}</w:rPr><w:tab/><w:tab/>${t(sender.name)}</w:r>` +
        run(" ", SMALLB) +
        `<w:r><w:rPr><w:b/><w:bCs/><w:color w:val="${xmlEscape(profile.accentColor ?? "746425")}"/></w:rPr>${t("| ")}</w:r>` +
        `<w:r><w:rPr>${rFonts(font, font)}<w:b/><w:bCs/><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>${t(sender.title)}</w:r>`,
    ),
  );
  // Addressee lines on the left interleaved with the sender's email and phone on the right.
  // (The original dropped the phone line for a one-line address; this keeps it.)
  const right = [sender.email, sender.phone].filter((s) => s.trim());
  const rows = Math.max(letter.addressee.length, right.length);
  for (let i = 0; i < rows; i++) {
    const left = letter.addressee[i] ?? "";
    out.push(para(TABS + IND, `<w:r><w:rPr>${BASE}</w:rPr><w:tab/>${t(left)}</w:r>` + (right[i] ? `<w:r><w:rPr>${BASE}</w:rPr><w:tab/>${t(right[i]!)}</w:r>` : "")));
  }
  out.push(blank);

  if (letter.byEmail?.trim()) {
    out.push(para(IND, tab + run("By email: ", BOLD) + run(letter.byEmail.trim())), blank);
  }
  out.push(para("", run(`Dear ${letter.salutation}`)), blank);
  if (letter.referenceLine?.trim()) {
    const REF = `${rFonts(font)}<w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/><w:lang w:val="en-US"/>`;
    out.push(para('<w:ind w:right="-113"/>', run(letter.referenceLine, REF)), blank);
  }
  for (const text of letter.body) out.push(para('<w:jc w:val="both"/>', run(text)), blank);
  out.push(para(IND, run(profile.closing ?? "Yours faithfully")), blank);

  const half = Math.round(signOff.sizePt * 2);
  const SIG = `${rFonts(signOff.font, font)}<w:bCs/><w:color w:val="${xmlEscape(signOff.color)}"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/><w:lang w:val="en-US"/>`;
  out.push(`<w:p><w:pPr>${IND}<w:rPr>${SIG}</w:rPr></w:pPr>${run(signOff.text, SIG)}</w:p>`);
  if (letter.enclosure) {
    out.push(blank, para(IND, run("Encl.", `${rFonts(font, "Arial")}<w:b/><w:bCs/><w:color w:val="000000"/><w:lang w:val="en-US" w:eastAsia="en-AU"/>`)));
  }
  return out.join("\n");
}

/**
 * Put a letter on the firm's letterhead. Everything outside the body paragraphs,
 * including the final section properties, is carried over unchanged.
 */
export function buildLetterOnLetterhead(letterheadBytes: Uint8Array, letter: Letter, profile: LetterProfile): Uint8Array {
  if (!letter.addressee.length) throw new LetterheadError("The letter needs an addressee");
  if (!letter.body.length) throw new LetterheadError("The letter has no body paragraphs");
  const zip = openDocx(letterheadBytes);
  const xml = getDocumentXml(zip);

  const open = /<w:body(\s[^>]*)?>/.exec(xml);
  const close = xml.lastIndexOf("</w:body>");
  if (!open || close === -1) throw new LetterheadError("Letterhead has no <w:body>");
  // The body-level sectPr is the last child of <w:body>; any earlier ones belong to
  // section breaks inside paragraphs.
  const sect = xml.lastIndexOf("<w:sectPr", close);
  if (sect === -1 || sect < open.index) throw new LetterheadError("Letterhead has no section properties (header/footer references)");
  const sectPr = xml.slice(sect, close);
  if (!/<\/w:sectPr>\s*$|<w:sectPr[^>]*\/>\s*$/.test(sectPr)) throw new LetterheadError("Letterhead section properties are not the last element of the body");

  const head = xml.slice(0, open.index + open[0].length);
  setDocumentXml(zip, `${head}\n${letterBodyXml(letter, profile)}\n${sectPr}${xml.slice(close)}`);
  return saveDocx(zip);
}
