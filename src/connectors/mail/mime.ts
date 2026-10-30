import { randomUUID } from "node:crypto";
import type { MailAddress, OutgoingMail } from "../types.js";

/** Decodes bytes in a MIME charset; unknown charsets fall back to UTF-8 rather than failing a message. */
export function decodeText(bytes: Uint8Array, charset = "utf-8"): string {
  const label = charset.trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Reads a parameter (e.g. charset, name) from a structured header value. */
export function headerParam(value: string | undefined, param: string): string | undefined {
  if (!value) return undefined;
  const m = new RegExp(`(?:^|;)\\s*${param}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^;\\s]+))`, "i").exec(value);
  return m ? (m[1] ?? m[2])?.replace(/\\(.)/g, "$1") : undefined;
}

/** RFC 2047 encoded-words (`=?UTF-8?B?…?=`, `=?ISO-8859-1?Q?…?=`), joining adjacent words. */
export function decodeEncodedWords(s: string): string {
  return s
    .replace(/(=\?[^?]+\?[bqBQ]\?[^?]*\?=)\s+(?==\?[^?]+\?[bqBQ]\?[^?]*\?=)/g, "$1")
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bqBQ])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) => {
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(
              text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
              "latin1",
            );
      return decodeText(bytes, charset);
    });
}

/** Quoted-printable body decoding (soft line breaks, =XX octets), then charset decoding. */
export function decodeQuotedPrintable(s: string, charset = "utf-8"): string {
  const octets = s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  return decodeText(Buffer.from(octets, "latin1"), charset);
}

/**
 * Parses an address-list header: `"Priestley, Toni" <toni@example.com>, bob@example.com`.
 * Commas inside quotes or angle brackets do not split; group syntax names are dropped.
 */
export function parseAddressList(header: string | undefined): MailAddress[] {
  if (!header) return [];
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  for (let i = 0; i < header.length; i++) {
    const c = header[i]!;
    if (c === "\\" && quoted) {
      cur += c + (header[++i] ?? "");
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "<") angle++;
    else if (!quoted && c === ">") angle = Math.max(0, angle - 1);
    if (!quoted && angle === 0 && (c === "," || c === ";")) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  return parts.flatMap((p) => {
    const t = p.replace(/^[^"<]*?:\s*/, (m) => (m.includes("@") ? m : "")).trim();
    if (!t) return [];
    const m = /^(.*?)\s*<([^>]*)>\s*$/.exec(t);
    const email = (m ? m[2]! : t).trim();
    if (!email.includes("@")) return [];
    const rawName = m?.[1]?.trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1");
    const name = rawName ? decodeEncodedWords(rawName).trim() : "";
    return [name ? { name, email } : { email }];
  });
}

/** Plain-text rendering of an HTML body for search and previews; not a faithful layout. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------- building

const ASCII = /^[\x20-\x7e]*$/;

/** RFC 2047 B-encoding for non-ASCII header text, split so each encoded-word stays short. */
export function encodeHeader(s: string): string {
  if (ASCII.test(s)) return s;
  const words: string[] = [];
  let chunk = "";
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}

export function formatAddress(a: MailAddress): string {
  if (!a.name) return a.email;
  const name = ASCII.test(a.name)
    ? /[()<>[\]:;@\\,."]/.test(a.name) ? `"${a.name.replace(/(["\\])/g, "\\$1")}"` : a.name
    : encodeHeader(a.name);
  return `${name} <${a.email}>`;
}

const base64Lines = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64").replace(/.{1,76}/g, "$&\r\n");

/** RFC 2231 filename parameter, so non-ASCII names survive. */
function filenameParam(name: string): string {
  if (ASCII.test(name)) return `filename="${name.replace(/(["\\])/g, "\\$1")}"`;
  return `filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

export interface MimeOptions {
  from?: MailAddress;
  inReplyTo?: string;
  references?: string;
  date?: Date;
  /** Fixed boundary prefix for reproducible output in tests. */
  boundary?: string;
}

/**
 * RFC 822 message: text (plus HTML as multipart/alternative), wrapped in
 * multipart/mixed when there are attachments. Every part is base64 so line length and
 * 8-bit content are never a concern.
 */
export function buildMime(mail: OutgoingMail, opts: MimeOptions = {}): string {
  const boundary = opts.boundary ?? `practy-${randomUUID()}`;
  const headers = [
    ...(opts.from ? [`From: ${formatAddress(opts.from)}`] : []),
    `To: ${mail.to.map(formatAddress).join(", ")}`,
    ...(mail.cc?.length ? [`Cc: ${mail.cc.map(formatAddress).join(", ")}`] : []),
    `Subject: ${encodeHeader(mail.subject)}`,
    ...(opts.date ? [`Date: ${opts.date.toUTCString().replace("GMT", "+0000")}`] : []),
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    "MIME-Version: 1.0",
  ];

  const textPart = (type: string, content: string) =>
    `Content-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(Buffer.from(content))}`;

  let body = textPart("text/plain", mail.text);
  if (mail.html !== undefined) {
    const alt = `${boundary}-alt`;
    body =
      `Content-Type: multipart/alternative; boundary="${alt}"\r\n\r\n` +
      `--${alt}\r\n${textPart("text/plain", mail.text)}--${alt}\r\n${textPart("text/html", mail.html)}--${alt}--\r\n`;
  }
  if (mail.attachments?.length) {
    const mixed = `${boundary}-mixed`;
    const atts = mail.attachments.map(
      (a) =>
        `--${mixed}\r\nContent-Type: ${a.contentType}; name="${encodeHeader(a.filename).replace(/"/g, "")}"\r\n` +
        `Content-Disposition: attachment; ${filenameParam(a.filename)}\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
        base64Lines(a.bytes),
    );
    body = `Content-Type: multipart/mixed; boundary="${mixed}"\r\n\r\n--${mixed}\r\n${body}${atts.join("")}--${mixed}--\r\n`;
  }
  return `${headers.join("\r\n")}\r\n${body}`;
}
