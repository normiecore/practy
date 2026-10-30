import type { IsoDate } from "../../core/calendar.js";
import { classifyAml, type ClassifierConfig } from "../classify.js";
import type { CashbookEntry, TrustSource } from "../model.js";

/**
 * Read-only Xero source for firms that keep the trust bank account directly in Xero.
 * Uses the Xero Accounting API (OAuth 2.0; scope accounting.transactions.read).
 *
 * Matter attribution, in order: a tracking category on the line items (e.g. "Matter"),
 * then a pattern applied to the reference. Anything else is reported as unattributed,
 * which the reconciliation treats as a breach to resolve.
 *
 * Bank transfers (e.g. trust → office after a bill) appear as SPEND-TRANSFER /
 * RECEIVE-TRANSFER bank transactions and carry no tracking, so they rely on the reference.
 */
export interface XeroTrustConfig {
  xeroTenantId: string;
  trustBankAccountId: string;
  getAccessToken: () => Promise<string>;
  trackingCategoryName?: string;
  /** First capture group is the matter number, e.g. /\b(SL-\d+)\b/. */
  referencePattern?: RegExp;
  classifier?: ClassifierConfig;
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface XeroLineItem {
  Description?: string;
  LineAmount?: number;
  Tracking?: { Name: string; Option: string }[];
}

export interface XeroBankTransaction {
  BankTransactionID: string;
  Type: string;
  Status: string;
  DateString?: string;
  Date?: string;
  Reference?: string;
  Total: number;
  Contact?: { Name?: string };
  LineItems?: XeroLineItem[];
}

const toCents = (n: number) => Math.round(n * 100);

function xeroDate(t: XeroBankTransaction): IsoDate {
  if (t.DateString) return t.DateString.slice(0, 10);
  const ms = /\/Date\((\d+)/.exec(t.Date ?? "")?.[1];
  if (!ms) throw new Error(`Xero transaction ${t.BankTransactionID} has no date`);
  return new Date(Number(ms)).toISOString().slice(0, 10);
}

const dt = (d: IsoDate) => `DateTime(${d.replaceAll("-", ",")})`;

export class XeroTrustSource implements TrustSource {
  readonly info = { kind: "xero" as const, label: "Xero (trust account kept in Xero)" };

  constructor(private readonly cfg: XeroTrustConfig) {}

  async fetchCashbook(range: { from: IsoDate; to: IsoDate }): Promise<CashbookEntry[]> {
    const doFetch = this.cfg.fetch ?? fetch;
    const base = this.cfg.baseUrl ?? "https://api.xero.com/api.xro/2.0";
    const where = `BankAccount.AccountID==guid("${this.cfg.trustBankAccountId}") AND Date>=${dt(range.from)} AND Date<=${dt(range.to)}`;
    const all: XeroBankTransaction[] = [];
    for (let page = 1; ; page++) {
      const url = `${base}/BankTransactions?where=${encodeURIComponent(where)}&page=${page}&pageSize=1000`;
      const res = await doFetch(url, {
        headers: {
          Authorization: `Bearer ${await this.cfg.getAccessToken()}`,
          "xero-tenant-id": this.cfg.xeroTenantId,
          Accept: "application/json",
        },
      });
      if (!res.ok) throw new Error(`Xero BankTransactions page ${page} failed: HTTP ${res.status}`);
      const body = (await res.json()) as { BankTransactions?: XeroBankTransaction[] };
      const batch = body.BankTransactions ?? [];
      all.push(...batch);
      if (batch.length < 1000) break;
    }
    return all.flatMap((t) => this.toEntries(t));
  }

  toEntries(t: XeroBankTransaction): CashbookEntry[] {
    if (t.Status !== "AUTHORISED") return [];
    const inbound = t.Type.startsWith("RECEIVE");
    const kind: CashbookEntry["kind"] = t.Type.endsWith("TRANSFER")
      ? inbound ? "transfer_in" : "transfer_out"
      : inbound ? "receipt" : "payment";
    const sign = inbound ? 1 : -1;
    const base = {
      date: xeroDate(t),
      payerOrPayee: t.Contact?.Name ?? "",
      reference: t.Reference ?? "",
      kind,
    };
    const fromRef = this.refMatter(t.Reference);
    const lines = t.LineItems ?? [];
    const tracked = lines.map((l) => this.trackedMatter(l));
    const lineTotal = lines.reduce((s, l) => s + toCents(l.LineAmount ?? 0), 0);
    const splitByLine =
      lines.length > 1 && tracked.every(Boolean) && new Set(tracked).size > 1 && lineTotal === toCents(t.Total);

    const mk = (sourceId: string, amount: number, matterRef: string | null): CashbookEntry => {
      const e = { ...base, sourceId, amount, matterRef };
      return { ...e, amlBasis: classifyAml(e, this.cfg.classifier) };
    };
    if (splitByLine) {
      return lines.map((l, i) => mk(`xero:${t.BankTransactionID}:${i}`, sign * toCents(l.LineAmount ?? 0), tracked[i]!));
    }
    const single = tracked.find(Boolean) ?? fromRef;
    return [mk(`xero:${t.BankTransactionID}`, sign * toCents(t.Total), single ?? null)];
  }

  private trackedMatter(l: XeroLineItem): string | undefined {
    const name = this.cfg.trackingCategoryName;
    if (!name) return undefined;
    return l.Tracking?.find((tr) => tr.Name.toLowerCase() === name.toLowerCase())?.Option || undefined;
  }

  private refMatter(ref: string | undefined): string | undefined {
    if (!ref || !this.cfg.referencePattern) return undefined;
    return this.cfg.referencePattern.exec(ref)?.[1];
  }
}
