import type { IsoDate } from "../../core/calendar.js";
import { classifyAml, type ClassifierConfig } from "../classify.js";
import { headerIndex, parseAuDate, parseCsv, parseMoney } from "../csv.js";
import type { BankStatement, CashbookEntry, TrustSource } from "../model.js";

/**
 * Source for firms whose trust records live in a dedicated trust add-on that
 * integrates with Xero (e.g. InTouch) rather than in Xero itself. Add-ons differ, so
 * the cashbook export is mapped by column name per tenant. A direct API adapter can
 * replace this per vendor without changing the shadow ledger.
 */
export interface CashbookCsvMapping {
  date: string;
  matter: string;
  party: string;
  reference?: string;
  /** Either a signed amount column, or separate receipt/payment columns. */
  amount?: string;
  receipt?: string;
  payment?: string;
  /** Optional column whose value marks transfers to office (matched case-insensitively). */
  type?: string;
  transferPattern?: RegExp;
}

export function parseCashbookCsv(text: string, map: CashbookCsvMapping, classifier?: ClassifierConfig): CashbookEntry[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const col = (name?: string) => headerIndex(header, name);
  const ix = {
    date: col(map.date)!,
    matter: col(map.matter)!,
    party: col(map.party)!,
    reference: col(map.reference),
    amount: col(map.amount),
    receipt: col(map.receipt),
    payment: col(map.payment),
    type: col(map.type),
  };
  if (ix.amount === undefined && (ix.receipt === undefined || ix.payment === undefined)) {
    throw new Error("Mapping needs an amount column or both receipt and payment columns");
  }
  const transfer = map.transferPattern ?? /transfer|office|costs/i;
  return rows.map((r, n) => {
    const cell = (i?: number) => (i === undefined ? "" : (r[i] ?? "").trim());
    const amount =
      ix.amount !== undefined ? parseMoney(cell(ix.amount)) : parseMoney(cell(ix.receipt)) - Math.abs(parseMoney(cell(ix.payment)));
    const isTransfer = ix.type !== undefined && transfer.test(cell(ix.type));
    const kind: CashbookEntry["kind"] = isTransfer
      ? amount < 0 ? "transfer_out" : "transfer_in"
      : amount < 0 ? "payment" : "receipt";
    const base = {
      sourceId: `addon:${n + 2}`,
      date: parseAuDate(cell(ix.date)),
      amount,
      matterRef: cell(ix.matter) || null,
      payerOrPayee: cell(ix.party),
      reference: cell(ix.reference),
      kind,
    };
    return { ...base, amlBasis: classifyAml(base, classifier) };
  });
}

export class AddOnCsvTrustSource implements TrustSource {
  readonly info = { kind: "addon_csv" as const, label: "Trust add-on (cashbook export)" };

  constructor(
    private readonly loadCsv: () => Promise<string>,
    private readonly mapping: CashbookCsvMapping,
    private readonly classifier?: ClassifierConfig,
  ) {}

  async fetchCashbook(range: { from: IsoDate; to: IsoDate }): Promise<CashbookEntry[]> {
    return parseCashbookCsv(await this.loadCsv(), this.mapping, this.classifier).filter(
      (e) => e.date >= range.from && e.date <= range.to,
    );
  }
}

export interface StatementCsvMapping {
  date: string;
  amount?: string;
  credit?: string;
  debit?: string;
  description: string;
}

/**
 * The bank statement is the independent side of the three-way reconciliation, so it is
 * taken from the bank's own export, never from Xero or the add-on.
 */
export function parseBankStatementCsv(
  text: string,
  map: StatementCsvMapping,
  meta: { accountName: string; closingBalance: number; closingDate: IsoDate },
): BankStatement {
  const [header, ...rows] = parseCsv(text);
  if (!header) return { ...meta, lines: [] };
  const col = (name?: string) => headerIndex(header, name);
  const ix = { date: col(map.date)!, amount: col(map.amount), credit: col(map.credit), debit: col(map.debit), desc: col(map.description)! };
  const lines = rows.map((r, n) => {
    const cell = (i?: number) => (i === undefined ? "" : (r[i] ?? "").trim());
    const amount =
      ix.amount !== undefined ? parseMoney(cell(ix.amount)) : parseMoney(cell(ix.credit)) - Math.abs(parseMoney(cell(ix.debit)));
    return { id: `stmt:${n + 2}`, date: parseAuDate(cell(ix.date)), amount, description: cell(ix.desc) };
  });
  return { ...meta, lines };
}
