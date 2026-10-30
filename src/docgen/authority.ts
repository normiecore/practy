/**
 * Authority to Settle: fills a firm's own form (a tenant asset uploaded at onboarding).
 *
 * The figures come from the settlement calculator (src/damages/settlement.ts,
 * computeAuthority) as display strings; this module only places them. It ports the
 * firm's positional filler: tokens for the header fields, two inline blanks, then an
 * anchored walk that finds each row label and writes the value into the next `$`/`E$`
 * cell after it.
 */
import {
  descendants,
  elementText,
  getDocumentXml,
  openDocx,
  parseXml,
  replaceTextPattern,
  replaceTokens,
  saveDocx,
  serializeXml,
  setDocumentXml,
  setElementText,
  type XmlElement,
} from "./docx.js";

/**
 * Row labels of the firm form, in document order, as matched by the filler. A label is
 * a substring of the row's text, so the walk tolerates the form's own wording around it
 * ("Medicare Australia [10% advance payment, …]"). The calculator emits one cell per
 * label, in this order.
 */
export const ATS_LABELS = [
  // A. Terms of Total Offer ("$")
  "settlement offer",
  "contribution towards legal costs",
  "contribution towards disbursements",
  "contribution towards medical accounts",
  "contribution towards Medicare Australia",
  "TOTAL OFFER",
  // B. Deductions from Total Offer ("E$")
  "workers compensation refund",
  "medical/other accounts",
  "Medicare Australia [10%",
  "Tax (if applicable)",
  "Centrelink refund",
  "Legal Aid Refund",
  "barrister",
  "other debts",
  "outstanding disbursements to be paid",
  "Soul Legal fees",
  // C. Net "In Hand" ("E$")
  "estimated net in hand",
  "plus Medicare/other benefits",
  "plus residual balance held in trust",
  "total",
] as const;

export type AtsLabel = (typeof ATS_LABELS)[number];

export interface AuthorityCell {
  /** Text that identifies the row (see ATS_LABELS). */
  label: string;
  /** What goes in the value cell: "$75,030.00", "E$7,503.00", "Nil", "N/A", "by me", "E$ – to be ascertained". */
  display: string;
}

/** Everything the form needs, already formatted for display. */
export interface AuthorityFigures {
  clientName: string;
  /** As printed after "sustained on or about", e.g. "29/10/2024". */
  injuryDate: string;
  solicitor: string;
  /** A(f) free text; keep to one short line so the authority stays on one page. */
  otherTerms: string;
  /** Value cells in form order (one per ATS_LABELS entry for the firm form). */
  cells: AuthorityCell[];
  /** Fills the "(including disbursements of $____)" blank in B(j): "Nil" or "2,530.00". */
  disbursementsNote: string;
}

export interface AuthorityFormOptions {
  /** Token text in the template; defaults match the firm form. */
  tokens?: { clientName?: string; injuryDate?: string; solicitor?: string };
}

export class AuthorityFormError extends Error {}

const VALUE_CELL = /^\s*E?\$\s*$/;

/**
 * Fill the firm's Authority to Settle form. Bank details, the DATED line and the
 * signatures are left blank for the client.
 */
export function fillFirmAuthorityForm(templateBytes: Uint8Array, figures: AuthorityFigures, opts: AuthorityFormOptions = {}): Uint8Array {
  if (!figures.clientName.trim()) throw new AuthorityFormError("clientName is required");
  if (!figures.injuryDate.trim()) throw new AuthorityFormError("injuryDate is required");
  if (!figures.cells.length) throw new AuthorityFormError("No value cells to fill");

  const zip = openDocx(templateBytes);
  let xml = getDocumentXml(zip);

  // Tokens (every occurrence: the client name also sits under the signature line).
  const t = { clientName: "{{CLIENT_NAME}}", injuryDate: "{{INJURY_DATE}}", solicitor: "{{SOLICITOR}}", ...opts.tokens };
  const tok = replaceTokens(xml, {
    [t.clientName]: figures.clientName,
    [t.injuryDate]: figures.injuryDate,
    [t.solicitor]: figures.solicitor,
  });
  for (const [token, n] of Object.entries(tok.replaced)) {
    if (n === 0) throw new AuthorityFormError(`Template token ${token} not found; is this the firm's Authority to Settle form?`);
  }
  xml = tok.xml;

  // Inline blanks: "other terms: ______" and "disbursements of $______".
  const other = replaceTextPattern(xml, /(other terms:)\s*_+/, (m) => `${m[1]} ${figures.otherTerms.trim()}`, 1);
  if (other.count === 0) throw new AuthorityFormError('Could not find the "other terms: ____" blank');
  const disb = replaceTextPattern(other.xml, /(disbursements of \$)_+/, (m) => `${m[1]}${figures.disbursementsNote}`, 1);
  if (disb.count === 0) throw new AuthorityFormError('Could not find the "disbursements of $____" blank');
  xml = disb.xml;

  setDocumentXml(zip, fillValueCells(xml, figures.cells));
  return saveDocx(zip);
}

/**
 * The anchored positional walk. Text nodes are visited in document order with a
 * cursor; for each cell the label is searched from the cursor, then the first w:t
 * after it whose whole content is "$" or "E$" receives the value, and the cursor
 * moves past it. The original searched raw XML; walking text nodes means a label
 * can never match inside markup, and a label split across runs is still found.
 */
function fillValueCells(xml: string, cells: AuthorityCell[]): string {
  const doc = parseXml(xml);
  const nodes: { node: XmlElement; start: number; text: string }[] = [];
  let full = "";
  for (const e of descendants(doc.root)) {
    if (e.name !== "w:t") continue;
    const text = elementText(e);
    nodes.push({ node: e, start: full.length, text });
    full += text;
  }
  let cursor = 0;
  for (const { label, display } of cells) {
    const li = full.indexOf(label, cursor);
    if (li === -1) {
      const anywhere = full.indexOf(label) !== -1;
      throw new AuthorityFormError(
        anywhere
          ? `Label "${label}" appears only before the previous cell; cells must be in form order`
          : `Label "${label}" not found in the form`,
      );
    }
    // The label's own node never qualifies (its text is not just "$"), so start >= li suffices.
    const target = nodes.find((n) => n.start >= li && VALUE_CELL.test(n.text));
    if (!target) throw new AuthorityFormError(`No "$" or "E$" value cell after label "${label}"`);
    setElementText(target.node, display);
    cursor = target.start + target.text.length;
  }
  return serializeXml(doc);
}
