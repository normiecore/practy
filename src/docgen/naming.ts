/**
 * Document naming convention engine.
 *
 * A firm's convention is a NamingProfile (labels, separators, abbreviations, date
 * format). SOUL_LEGAL_PROFILE is the default and reproduces the firm's written rules:
 *
 *   YYYY.MM.DD [SIER# –] Type [by Author to Recipient | – by Author] [– Profession] [– Practice] [– $Amount]
 *   YYYY.MM.DD EM to X [re …] / EM from X [re …] / EMC with X [re …] / EM from X to Y [re …]
 *
 * A space follows the date; an en dash (U+2013) separates later fields. Email names
 * never carry the fee earner: direction is always relative to the firm.
 */

export type DocKind = "report" | "ime" | "referral" | "letter" | "payslip" | "other";

/** ISO YYYY-MM-DD, or "Various" for a bundle spanning several dates. */
export type NameDate = string;

interface SpecBase {
  date: NameDate;
  /** "26", "SIER26" or "SIER 26"; rendered as SIER26. */
  sierNumber?: string;
}

export interface EmailNameSpec extends SpecBase {
  kind: "email";
  /** sent: firm → X; received: X → firm; chain: thread with X; external: X → Y, firm not a party. */
  direction: "sent" | "received" | "chain" | "external";
  externalParty: string;
  /** The recipient for direction "external". */
  otherParty?: string;
  re?: string;
}

export interface InvoiceNameSpec extends SpecBase {
  kind: "invoice";
  /** "Physiotherapy", "Medical", "IME". Omit for a generic Tax Invoice. */
  service?: string;
  practice: string;
  amountCents: number;
  /** Distinguishes several invoices on one date (never a "(1)" counter). */
  invoiceNumber?: string;
  practitioner?: string;
  /** "for": "Physiotherapy Invoice for Spark Physio"; "dash": "Tax Invoice – Spark Physio". */
  style?: "for" | "dash";
}

export interface AuthoredNameSpec extends SpecBase {
  kind: DocKind;
  /** Overrides the profile's label for the kind, e.g. "Medical Report". Required for "other". */
  description?: string;
  author?: string;
  profession?: string;
  practice?: string;
  recipient?: string;
}

export type DocumentNameSpec = EmailNameSpec | InvoiceNameSpec | AuthoredNameSpec;

export interface NamingProfile {
  id: string;
  name: string;
  dateFormat: "YYYY.MM.DD" | "YYYY-MM-DD" | "DD.MM.YYYY" | "YYYYMMDD";
  /** Between the date and the first field. */
  afterDate: string;
  /** Between later fields. */
  separator: string;
  sierPrefix: string;
  variousLabel: string;
  labels: Record<DocKind, string> & { invoice: string; invoices: string; genericInvoice: string };
  email: { single: string; chain: string; to: string; from: string; with: string; re: string };
  /** Whole-word replacements applied to every free-text field, in order. */
  abbreviations: [from: string, to: string][];
  currency: string;
  /** Names of the firm itself; never part of an email name. */
  firmNames: string[];
  defaultInvoiceStyle: "for" | "dash";
  /** Fully custom renderer for firms whose convention does not fit the fields above. */
  render?: (spec: DocumentNameSpec, profile: NamingProfile) => string;
}

export const SOUL_LEGAL_PROFILE: NamingProfile = {
  id: "soul-legal",
  name: "Soul Legal",
  dateFormat: "YYYY.MM.DD",
  afterDate: " ",
  separator: " – ",
  sierPrefix: "SIER",
  variousLabel: "Various",
  labels: {
    report: "Report",
    ime: "IME Report",
    referral: "Referral",
    letter: "LTR",
    payslip: "Payslip",
    other: "Document",
    invoice: "Invoice",
    invoices: "Invoices",
    genericInvoice: "Tax Invoice",
  },
  email: { single: "EM", chain: "EMC", to: "to", from: "from", with: "with", re: "re" },
  abbreviations: [
    ["Professor", "Prof"],
    ["Prof.", "Prof"],
    ["Doctor", "Dr"],
    ["Dr.", "Dr"],
    ["WorkCover", "WC"],
    ["Workcover", "WC"],
    ["District Court", "DC"],
    ["Supreme Court", "SC"],
  ],
  currency: "$",
  firmNames: ["Soul Legal"],
  defaultInvoiceStyle: "for",
};

export class NamingError extends Error {}

export interface FormatOptions {
  profile?: NamingProfile;
  /** Staff names; an email name that would contain one is refused. */
  feeEarnerNames?: string[];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Characters Windows and Box reject in file names, plus control characters. */
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Make a name safe for Box and Windows without changing its meaning. */
export function sanitiseFileName(name: string): string {
  let s = name
    .replace(/[\r\n\t]+/g, " ")
    .replace(/["]/g, "'")
    .replace(/[/\\|]/g, "-")
    .replace(/:/g, " -")
    .replace(ILLEGAL, "")
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
  if (!s || s === "." || s === "..") throw new NamingError("File name is empty after removing illegal characters");
  // Box allows 255 characters; leave room for an extension.
  return s.length > 240 ? s.slice(0, 240).trimEnd() : s;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function abbreviate(text: string, profile: NamingProfile): string {
  let s = text.trim().replace(/\s+/g, " ");
  for (const [from, to] of profile.abbreviations) {
    const tail = /\w$/.test(from) ? "\\b" : "(?=\\s|$)";
    s = s.replace(new RegExp(`\\b${escapeRegExp(from)}${tail}`, "g"), to);
  }
  return s;
}

export function formatNameDate(date: NameDate, profile: NamingProfile = SOUL_LEGAL_PROFILE): string {
  if (date === "Various" || date === profile.variousLabel) return profile.variousLabel;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new NamingError(`Date must be ISO YYYY-MM-DD or "Various": ${date}`);
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) throw new NamingError(`Not a calendar date: ${date}`);
  switch (profile.dateFormat) {
    case "YYYY.MM.DD":
      return `${y}.${mo}.${d}`;
    case "YYYY-MM-DD":
      return date;
    case "DD.MM.YYYY":
      return `${d}.${mo}.${y}`;
    case "YYYYMMDD":
      return `${y}${mo}${d}`;
  }
}

export function formatAmount(cents: number, currency = "$"): string {
  if (!Number.isInteger(cents)) throw new NamingError(`Amount must be integer cents: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-AU");
  return `${sign}${currency}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

function sier(raw: string | undefined, profile: NamingProfile): string | undefined {
  if (!raw?.trim()) return undefined;
  const digits = raw.replace(new RegExp(`^\\s*${escapeRegExp(profile.sierPrefix)}\\s*#?\\s*`, "i"), "").trim();
  if (!digits) return undefined;
  return `${profile.sierPrefix}${digits}`;
}

function containsName(text: string, names: string[]): string | undefined {
  const lower = text.toLowerCase();
  return names.find((n) => n.trim() && new RegExp(`\\b${escapeRegExp(n.trim().toLowerCase())}\\b`).test(lower));
}

function renderEmail(spec: EmailNameSpec, p: NamingProfile, opts: FormatOptions): string {
  const x = abbreviate(spec.externalParty, p);
  if (!x) throw new NamingError("Email names need the external party");
  const staff = [...(opts.feeEarnerNames ?? []), ...p.firmNames];
  for (const field of [spec.externalParty, spec.otherParty ?? ""]) {
    const hit = containsName(field, staff);
    if (hit) throw new NamingError(`Email names never name the firm or fee earner ("${hit}"); name only the external party`);
  }
  let core: string;
  switch (spec.direction) {
    case "sent":
      core = `${p.email.single} ${p.email.to} ${x}`;
      break;
    case "received":
      core = `${p.email.single} ${p.email.from} ${x}`;
      break;
    case "chain":
      core = `${p.email.chain} ${p.email.with} ${x}`;
      break;
    case "external": {
      if (!spec.otherParty?.trim()) throw new NamingError("An external-only email needs otherParty (the recipient)");
      core = `${p.email.single} ${p.email.from} ${x} ${p.email.to} ${abbreviate(spec.otherParty, p)}`;
      break;
    }
  }
  if (spec.re?.trim()) {
    let re = abbreviate(spec.re, p).replace(/^re:?\s+/i, "");
    // Strip a fee earner who slipped into the subject, e.g. "Kevin Wong's advice".
    const hit = containsName(re, staff);
    if (hit) re = re.replace(new RegExp(`\\b${escapeRegExp(hit)}('s)?\\s*`, "gi"), "").trim();
    if (re) core += ` ${p.email.re} ${re}`;
  }
  return core;
}

function renderInvoice(spec: InvoiceNameSpec, p: NamingProfile): string {
  const various = spec.date === "Various" || spec.date === p.variousLabel;
  const practice = abbreviate(spec.practice, p);
  if (!practice) throw new NamingError("Invoice names need the practice or company");
  const style = spec.style ?? (spec.service ? p.defaultInvoiceStyle : "dash");
  const noun = various ? p.labels.invoices : p.labels.invoice;
  const service = spec.service ? abbreviate(spec.service, p) : undefined;
  const fields: string[] = [];
  if (style === "for") {
    fields.push(`${service ? `${service} ` : ""}${noun} for ${practice}`);
  } else {
    fields.push(service ? `${service} ${noun}` : various ? p.labels.invoices : p.labels.genericInvoice, practice);
  }
  if (spec.practitioner?.trim()) fields.push(abbreviate(spec.practitioner, p));
  if (spec.invoiceNumber?.trim()) fields.push(`Inv ${spec.invoiceNumber.trim()}`);
  fields.push(formatAmount(spec.amountCents, p.currency));
  return fields.join(p.separator);
}

function renderAuthored(spec: AuthoredNameSpec, p: NamingProfile): string {
  const label = abbreviate(spec.description ?? (spec.kind === "other" ? "" : p.labels[spec.kind]), p);
  if (!label) throw new NamingError("Documents of kind 'other' need a description");
  const author = spec.author?.trim() ? abbreviate(spec.author, p) : undefined;
  const recipient = spec.recipient?.trim() ? abbreviate(spec.recipient, p) : undefined;
  const fields: string[] = [];
  // "Referral by A to B" reads as one clause, so a directional document keeps the
  // author inline; a report with no recipient gives the author its own field.
  if (recipient) fields.push(`${label}${author ? ` by ${author}` : ""} to ${recipient}`);
  else {
    fields.push(label);
    if (author) fields.push(`by ${author}`);
  }
  if (spec.profession?.trim()) fields.push(abbreviate(spec.profession, p));
  if (spec.practice?.trim()) fields.push(abbreviate(spec.practice, p));
  return fields.join(p.separator);
}

/** Build a document name (without extension) from a structured spec. */
export function formatDocumentName(spec: DocumentNameSpec, opts: FormatOptions = {}): string {
  const p = opts.profile ?? SOUL_LEGAL_PROFILE;
  if (p.render) return sanitiseFileName(p.render(spec, p));
  const date = formatNameDate(spec.date, p);
  let body: string;
  if (spec.kind === "email") body = renderEmail(spec, p, opts);
  else if (spec.kind === "invoice") body = renderInvoice(spec, p);
  else body = renderAuthored(spec, p);
  const s = sier(spec.sierNumber, p);
  return sanitiseFileName(`${date}${p.afterDate}${s ? `${s}${p.separator}` : ""}${body}`);
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

export type NamingIssueCode =
  | "date-missing"
  | "date-format"
  | "date-invalid"
  | "date-separator"
  | "hyphen-separator"
  | "em-dash"
  | "illegal-character"
  | "email-fee-earner"
  | "email-by"
  | "email-firm-name"
  | "email-direction"
  | "invoice-amount-missing"
  | "amount-format"
  | "placeholder"
  | "counter"
  | "abbreviation"
  | "sier-format"
  | "whitespace";

export interface NamingIssue {
  code: NamingIssueCode;
  severity: "error" | "warning";
  message: string;
}

export interface CheckOptions {
  profile?: NamingProfile;
  feeEarnerNames?: string[];
}

const EXT = /\.(pdf|docx?|xlsx?|msg|eml|jpe?g|png|tiff?|heic|txt|rtf|zip)$/i;

/**
 * Check a name against the profile's rules. Rules for the default profile; a custom
 * profile's separators, date format and abbreviations are respected.
 */
export function checkDocumentName(name: string, opts: CheckOptions = {}): NamingIssue[] {
  const p = opts.profile ?? SOUL_LEGAL_PROFILE;
  const issues: NamingIssue[] = [];
  const add = (code: NamingIssueCode, severity: NamingIssue["severity"], message: string) => issues.push({ code, severity, message });
  const n = name.replace(EXT, "");
  const sep = p.separator.trim();

  if (/[<>:"/\\|?*\u0000-\u001f]/.test(n)) add("illegal-character", "error", "Contains characters Box or Windows will reject (< > : \" / \\ | ? *)");
  if (/\s{2,}/.test(n) || n !== n.trim()) add("whitespace", "warning", "Contains double or leading/trailing spaces");

  // Date
  const datePattern = { "YYYY.MM.DD": /^(\d{4})\.(\d{2})\.(\d{2})/, "YYYY-MM-DD": /^(\d{4})-(\d{2})-(\d{2})/, "DD.MM.YYYY": /^(\d{2})\.(\d{2})\.(\d{4})/, YYYYMMDD: /^(\d{4})(\d{2})(\d{2})/ }[p.dateFormat];
  const dm = datePattern.exec(n);
  let rest = n;
  if (dm) {
    const [y, mo, d] = p.dateFormat === "DD.MM.YYYY" ? [dm[3]!, dm[2]!, dm[1]!] : [dm[1]!, dm[2]!, dm[3]!];
    const dt = new Date(Date.UTC(+y, +mo - 1, +d));
    if (dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) add("date-invalid", "error", `${dm[0]} is not a calendar date`);
    rest = n.slice(dm[0].length);
  } else if (n.startsWith(p.variousLabel)) {
    rest = n.slice(p.variousLabel.length);
  } else if (/^(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|\d{8})/.test(n)) {
    add("date-format", "error", `Date must be ${p.dateFormat} (e.g. ${formatNameDate("2024-08-20", p)})`);
    rest = n.replace(/^(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|\d{8})/, "");
  } else {
    add("date-missing", "error", `Must start with the document's own date (${p.dateFormat}), or "${p.variousLabel}" for a bundle`);
  }
  if (dm || n.startsWith(p.variousLabel)) {
    if (/^\s*[–—-]\s/.test(rest)) add("date-separator", "error", "Use only a space after the date, not a dash");
    else if (!rest.startsWith(p.afterDate) && rest.length) add("date-separator", "error", "The date must be followed by a single space");
  }
  const body = rest.replace(/^\s*[–—-]?\s*/, "");

  if (/\s-\s/.test(body) && sep !== "-") add("hyphen-separator", "error", `Separate fields with an en dash "${p.separator.trim()}", not a hyphen`);
  if (/—/.test(body) && sep !== "—") add("em-dash", "warning", `Use the en dash "${sep}" (U+2013), not an em dash`);

  // SIER
  const sm = new RegExp(`\\b${escapeRegExp(p.sierPrefix)}\\b`, "i").exec(body);
  if (sm || /\bSIER\s*[#\s]\s*\d/i.test(body)) {
    if (!new RegExp(`^${escapeRegExp(p.sierPrefix)}\\d+\\s${escapeRegExp(sep)}\\s`).test(body)) {
      add("sier-format", "warning", `Write the SIER number as ${p.sierPrefix}26 straight after the date, followed by "${p.separator.trim()}"`);
    }
  }
  const afterSier = body.replace(new RegExp(`^${escapeRegExp(p.sierPrefix)}\\s*#?\\d+\\s*[–—-]?\\s*`, "i"), "");

  // Emails
  const em = new RegExp(`^(${escapeRegExp(p.email.single)}|${escapeRegExp(p.email.chain)})\\b(.*)$`).exec(afterSier);
  if (em) {
    const tail = em[2]!.trim();
    const staff = opts.feeEarnerNames ?? [];
    if (/^by\b/i.test(tail)) add("email-by", "error", `Email names do not use "by"; write "${em[1]} to X" or "${em[1]} from X"`);
    const hit = containsName(tail, staff);
    if (hit) add("email-fee-earner", "error", `Email names must not name the fee earner (${hit}); name only the external party`);
    const firm = containsName(tail, p.firmNames);
    if (firm) add("email-firm-name", "error", `Email names must not name the firm (${firm}); direction is relative to the firm`);
    const directions = em[1] === p.email.chain ? [p.email.with] : [p.email.to, p.email.from];
    const withoutBy = tail.replace(/^by\s+.*?\s+(?=(to|from|with)\b)/i, "");
    if (!directions.some((d) => new RegExp(`^${escapeRegExp(d)}\\b`).test(withoutBy))) {
      add("email-direction", "error", `Write "${directions.map((d) => `${em[1]} ${d} X`).join('" or "')}"`);
    }
  }

  // Invoices
  // An email "re outstanding invoice" is not itself an invoice.
  if (!em && /\binvoices?\b/i.test(afterSier)) {
    if (!/\$\s?[\d,]+/.test(afterSier)) add("invoice-amount-missing", "error", `Invoices must end with the amount, e.g. "${p.separator.trim()} ${formatAmount(22000, p.currency)}"`);
    else if (!/\$\d{1,3}(,\d{3})*\.\d{2}$/.test(afterSier)) add("amount-format", "warning", 'Write the amount as $1,234.56 at the end of the name');
  }

  if (/\b(N\/A|n\/a|Unknown|unknown|TBA|TBC)\b/.test(afterSier)) add("placeholder", "warning", "Omit fields that are not known instead of writing N/A or Unknown");
  if (/\(\d+\)\s*$/.test(afterSier) || /\bcopy\s*\d*$/i.test(afterSier)) add("counter", "warning", "Distinguish documents by detail (service, invoice number, practitioner), not a counter");

  for (const [from, to] of p.abbreviations) {
    const tailRe = /\w$/.test(from) ? "\\b" : "(?=\\s|$)";
    if (new RegExp(`\\b${escapeRegExp(from)}${tailRe}`).test(afterSier)) add("abbreviation", "warning", `Abbreviate "${from}" as "${to}"`);
  }
  return issues;
}

/** Apply the mechanical fixes for the issues checkDocumentName finds (date format, dashes, abbreviations, fee earner in emails). */
export function fixDocumentName(name: string, opts: CheckOptions = {}): string {
  const p = opts.profile ?? SOUL_LEGAL_PROFILE;
  const ext = EXT.exec(name)?.[0] ?? "";
  let n = name.slice(0, name.length - ext.length).trim().replace(/\s+/g, " ");
  // Dates: 2024-08-20, 20/08/2024, 20.08.2024 → profile format.
  n = n.replace(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/, (m, y1, m1, d1, d2, m2, y2) => {
    const y = y1 ?? y2;
    const mo = (m1 ?? m2).padStart(2, "0");
    const d = (d1 ?? d2).padStart(2, "0");
    try {
      return formatNameDate(`${y}-${mo}-${d}`, p);
    } catch {
      return m;
    }
  });
  n = n.replace(/^(\S+)\s*[–—-]\s+/, "$1 ");
  n = n.replace(/\s[-—]\s/g, p.separator);
  n = n.replace(/^(\S+ )SIER\s*#?\s*(\d+)\s*[–—-]?\s*(?=\S)/i, `$1${p.sierPrefix}$2${p.separator}`);
  // Emails: drop "by <fee earner>" and any firm/fee-earner name.
  n = n.replace(/\b(EMC?) by .+?\s(?=(to|from|with)\b)/, "$1 ");
  for (const name of [...(opts.feeEarnerNames ?? []), ...p.firmNames]) {
    if (/\bEMC?\b/.test(n)) n = n.replace(new RegExp(`\\s*\\b(by\\s+)?${escapeRegExp(name)}\\b`, "gi"), "");
  }
  n = abbreviate(n, p);
  return sanitiseFileName(n) + ext;
}
