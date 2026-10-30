import type { IsoDate } from "../core/calendar.js";
import type { Cents } from "./model.js";

/** RFC 4180-ish CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** Accepts 2026-10-31, 31/10/2026 and 31/10/26 (Australian day-first). */
export function parseAuDate(s: string): IsoDate {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (!m) throw new Error(`Unrecognised date: ${s}`);
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

/** "$1,234.50", "-12.3", "(45.00)" → cents. */
export function parseMoney(s: string): Cents {
  const t = s.trim();
  if (!t) return 0;
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  const digits = t.replace(/[()$,\s+-]/g, "");
  if (!/^\d*(\.\d{0,2})?$/.test(digits)) throw new Error(`Unrecognised amount: ${s}`);
  const [whole, frac = ""] = digits.split(".");
  const cents = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** Map header names (case-insensitive) to column indexes. */
export function headerIndex(header: string[], name: string | undefined): number | undefined {
  if (!name) return undefined;
  const i = header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  if (i < 0) throw new Error(`Column "${name}" not found in CSV header`);
  return i;
}
