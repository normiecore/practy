import type { MailAddress, MailMessage } from "../connectors/types.js";

/**
 * Email file names under the firm naming convention:
 *   YYYY.MM.DD EM to X [re subject] / EM from X [re subject] / EM from X to Y [re subject]
 * The fee earner is never named; X is the external party.
 */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]+/g;

export function cleanSubject(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw)\s*[:-]\s*/i, "").trim();
    if (next === s) break;
    s = next;
  }
  // Drop a leading "1998 - Surname, First -" practice-management prefix: the file already sits in the matter.
  s = s.replace(/^\[?\d{3,5}\]?\s*[-–]\s*[^,:]+,\s*[^-–:]+(?:[-–]\s*[A-Za-z]{1,10}\s*)?[:\-–]\s*/, "");
  s = s.replace(/^\[?\d{3,5}\]?\s*[-–:]\s*/, "");
  return s.length > 70 ? `${s.slice(0, 67).trimEnd()}…` : s;
}

const who = (a: MailAddress) => {
  const name = a.name?.replace(/^["']|["']$/g, "").trim();
  return name && !name.includes("@") ? name : a.email;
};

export function isFirmAddress(email: string, firmDomains: string[]): boolean {
  return firmDomains.includes(email.toLowerCase().split("@")[1] ?? "");
}

export function emailBaseName(m: Pick<MailMessage, "date" | "from" | "to" | "cc" | "subject">, firmDomains: string[]): string {
  const date = m.date.slice(0, 10).replaceAll("-", ".");
  const fromFirm = isFirmAddress(m.from.email, firmDomains);
  const recipients = [...m.to, ...m.cc];
  const externalRecipients = recipients.filter((a) => !isFirmAddress(a.email, firmDomains));
  const anyFirmRecipient = recipients.some((a) => isFirmAddress(a.email, firmDomains));
  let core: string;
  if (fromFirm) core = `EM to ${externalRecipients[0] ? who(externalRecipients[0]) : "internal"}`;
  else if (anyFirmRecipient || !recipients.length) core = `EM from ${who(m.from)}`;
  else core = `EM from ${who(m.from)} to ${recipients[0] ? who(recipients[0]) : "unknown"}`;
  const re = cleanSubject(m.subject);
  return `${date} ${core}${re ? ` re ${re}` : ""}`.replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
}

export function attachmentName(emailDate: string, filename: string): string {
  const date = emailDate.slice(0, 10).replaceAll("-", ".");
  const base = filename.replace(/^ATT\d+\s*-\s*/i, "").replace(ILLEGAL, " ").trim() || "attachment";
  return /^\d{4}\.\d{2}\.\d{2}\s/.test(base) ? base : `${date} ${base}`;
}
