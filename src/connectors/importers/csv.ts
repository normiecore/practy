import { headerIndex, parseAuDate, parseCsv } from "../../trust/csv.js";
import type { ImportedMatter, MatterImporter } from "../types.js";
import { schemeFromMatterType, statusFromText } from "./matter-type.js";

/**
 * Matter import from a spreadsheet export (any practice management system, or a firm's
 * own matter list). Columns are named by header text, case-insensitively.
 */
export interface CsvMatterColumns {
  number: string;
  clientName: string;
  /** Defaults to `csv:<number>`. */
  externalId?: string;
  /** Defaults to `<number> - <client>`. */
  title?: string;
  matterType?: string;
  status?: string;
  openedOn?: string;
  injuryDate?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientDateOfBirth?: string;
  clientAddress?: string;
  responsibleStaff?: string;
  notes?: string;
  /** e.g. `[{ column: "Insurer", role: "insurer" }, { column: "Employer", role: "employer" }]` */
  otherParties?: { column: string; role: string }[];
}

export interface CsvMatterImporterOptions {
  text: string;
  columns: CsvMatterColumns;
}

export class CsvMatterImporter implements MatterImporter {
  readonly kind = "csv" as const;

  constructor(private readonly opts: CsvMatterImporterOptions) {}

  async listMatters(): Promise<ImportedMatter[]> {
    return parseMatterCsv(this.opts.text, this.opts.columns);
  }
}

/** Rows without a matter number are skipped; a bad date fails with its row number. */
export function parseMatterCsv(text: string, columns: CsvMatterColumns): ImportedMatter[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return [];
  const col = (name: string | undefined) => headerIndex(header, name);
  const idx = {
    number: col(columns.number)!,
    clientName: col(columns.clientName)!,
    externalId: col(columns.externalId),
    title: col(columns.title),
    matterType: col(columns.matterType),
    status: col(columns.status),
    openedOn: col(columns.openedOn),
    injuryDate: col(columns.injuryDate),
    clientEmail: col(columns.clientEmail),
    clientPhone: col(columns.clientPhone),
    clientDateOfBirth: col(columns.clientDateOfBirth),
    clientAddress: col(columns.clientAddress),
    responsibleStaff: col(columns.responsibleStaff),
    notes: col(columns.notes),
  };
  const parties = (columns.otherParties ?? []).map((p) => ({ i: col(p.column)!, role: p.role }));

  return rows.flatMap((row, r) => {
    const cell = (i: number | undefined) => (i === undefined ? undefined : row[i]?.trim() || undefined);
    const date = (i: number | undefined, what: string) => {
      const v = cell(i);
      if (!v) return undefined;
      let iso: string | undefined;
      try {
        iso = parseAuDate(v);
      } catch {
        /* reported below */
      }
      // parseAuDate checks the shape only; reject impossible dates such as 31/31/2025.
      const ms = iso ? Date.parse(`${iso}T00:00:00Z`) : NaN;
      if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== iso) {
        throw new Error(`Row ${r + 2}: unrecognised ${what} "${v}"`);
      }
      return iso;
    };
    const number = cell(idx.number);
    if (!number) return [];
    const clientName = cell(idx.clientName) ?? "";
    const matterType = cell(idx.matterType);
    const scheme = schemeFromMatterType(matterType);
    const client: ImportedMatter["client"] = { name: clientName };
    const set = <K extends keyof ImportedMatter["client"]>(k: K, v: ImportedMatter["client"][K] | undefined) => {
      if (v !== undefined) client[k] = v;
    };
    set("email", cell(idx.clientEmail));
    set("phone", cell(idx.clientPhone));
    set("dateOfBirth", date(idx.clientDateOfBirth, "client date of birth"));
    set("address", cell(idx.clientAddress));

    const m: ImportedMatter = {
      externalId: cell(idx.externalId) ?? `csv:${number}`,
      number,
      title: cell(idx.title) ?? `${number} - ${clientName}`,
      status: statusFromText(cell(idx.status)),
      client,
      otherParties: parties.flatMap((p) => {
        const name = cell(p.i);
        return name ? [{ name, role: p.role }] : [];
      }),
    };
    if (matterType) m.matterType = matterType;
    if (scheme) m.scheme = scheme;
    const openedOn = date(idx.openedOn, "open date");
    if (openedOn) m.openedOn = openedOn;
    const injuryDate = date(idx.injuryDate, "injury date");
    if (injuryDate) m.injuryDate = injuryDate;
    const staff = cell(idx.responsibleStaff);
    if (staff) m.responsibleStaff = staff;
    const notes = cell(idx.notes);
    if (notes) m.notes = notes;
    return [m];
  });
}
