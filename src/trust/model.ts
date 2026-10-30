import type { IsoDate } from "../core/calendar.js";

/** Money is integer cents throughout. */
export type Cents = number;

/**
 * Basis on which trust money is excluded from AML/CTF "designated service" item 3
 * (Law Council Guidance Note 4). "private" receipts trigger an AML drift alert.
 */
export type AmlBasis = "insurer_or_government" | "court_order" | "fees_disbursements" | "private" | "unknown";

/** One line of the trust cashbook as reported by the firm's current system (Xero or an add-on). */
export interface CashbookEntry {
  /** Stable id in the source system, prefixed with the source kind. */
  sourceId: string;
  date: IsoDate;
  /** Positive = receipt into trust, negative = payment out of trust. */
  amount: Cents;
  /** Matter number the source attributes the entry to; null if it cannot be attributed. */
  matterRef: string | null;
  payerOrPayee: string;
  reference: string;
  kind: "receipt" | "payment" | "transfer_out" | "transfer_in";
  amlBasis: AmlBasis;
}

/** A line from the trust bank statement: the independent side of the reconciliation. */
export interface StatementLine {
  id: string;
  date: IsoDate;
  amount: Cents;
  description: string;
}

export interface BankStatement {
  accountName: string;
  lines: StatementLine[];
  /** Closing balance as printed by the bank for `closingDate`. */
  closingBalance: Cents;
  closingDate: IsoDate;
}

export interface TrustSourceInfo {
  kind: "xero" | "addon_csv";
  label: string;
}

/**
 * Where the firm's existing trust records live. Practy supports both pilot cases:
 * the trust account kept directly in Xero, or in a trust add-on that exports a cashbook.
 * Read-only: Practy never writes to the source's trust records during the shadow phase.
 */
export interface TrustSource {
  info: TrustSourceInfo;
  fetchCashbook(range: { from: IsoDate; to: IsoDate }): Promise<CashbookEntry[]>;
}
