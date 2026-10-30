import {
  addDays,
  addWorkingDays,
  endOfMonth,
  workingDaysBetween,
  type IsoDate,
  type WorkingCalendar,
} from "../core/calendar.js";
import type { BankStatement, CashbookEntry, Cents, StatementLine } from "./model.js";

/**
 * Shadow three-way reconciliation of a general trust account under the Legal Profession
 * Uniform General Rules (as applied in WA). Rule references in messages are from the
 * LPBWA external examiner materials and are on the verification register.
 */

export interface OpeningBalances {
  /** Day before the first cashbook entry Practy reads. */
  asAt: IsoDate;
  cashbook: Cents;
  clientLedgers: Record<string, Cents>;
}

export interface Issue {
  severity: "breach" | "warning";
  code:
    | "cashbook_bank_mismatch"
    | "cashbook_ledger_mismatch"
    | "ledger_overdrawn"
    | "ledger_overdrawn_intra_period"
    | "unattributed_entry"
    | "unknown_matter"
    | "late_posting"
    | "unposted_statement_line"
    | "aml_private_receipt"
    | "reconciliation_overdue"
    | "not_month_end";
  message: string;
  ref?: string;
}

export interface Reconciliation {
  periodEnd: IsoDate;
  preparedAsAt: IsoDate;
  dueBy: IsoDate;
  bankClosing: Cents;
  outstanding: { deposits: CashbookEntry[]; payments: CashbookEntry[] };
  adjustedBank: Cents;
  cashbookBalance: Cents;
  clientLedgerTotal: Cents;
  clientLedgers: { matterRef: string; balance: Cents }[];
  unpostedStatementLines: StatementLine[];
  issues: Issue[];
  reconciled: boolean;
}

export const POSTING_LIMIT_WORKING_DAYS = 5;
export const RECONCILIATION_LIMIT_WORKING_DAYS = 15;
const MATCH_WINDOW_DAYS = 5;

const fmt = (c: Cents) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;

/** One-to-one match of cashbook entries to statement lines on exact amount within a date window. */
export function matchToStatement(entries: CashbookEntry[], lines: StatementLine[]) {
  const used = new Set<string>();
  const matched = new Map<string, string>();
  const byDate = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of byDate) {
    const candidates = lines
      .filter((l) => !used.has(l.id) && l.amount === e.amount && l.date >= addDays(e.date, -MATCH_WINDOW_DAYS) && l.date <= addDays(e.date, MATCH_WINDOW_DAYS))
      .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(e.date)) - Math.abs(Date.parse(b.date) - Date.parse(e.date)));
    const hit = candidates[0];
    if (hit) {
      used.add(hit.id);
      matched.set(e.sourceId, hit.id);
    }
  }
  return {
    unmatchedEntries: entries.filter((e) => !matched.has(e.sourceId)),
    unmatchedLines: lines.filter((l) => !used.has(l.id)),
  };
}

export function reconcile(args: {
  periodEnd: IsoDate;
  asAt: IsoDate;
  opening: OpeningBalances;
  entries: CashbookEntry[];
  statement: BankStatement;
  knownMatters: Set<string>;
  calendar: WorkingCalendar;
}): Reconciliation {
  const { periodEnd, asAt, opening, statement, knownMatters, calendar } = args;
  const issues: Issue[] = [];
  if (periodEnd !== endOfMonth(periodEnd)) {
    issues.push({ severity: "warning", code: "not_month_end", message: `${periodEnd} is not a month end` });
  }
  if (statement.closingDate !== periodEnd) {
    throw new Error(`Bank statement closes ${statement.closingDate}, expected ${periodEnd}`);
  }

  const entries = args.entries
    .filter((e) => e.date > opening.asAt && e.date <= periodEnd)
    .sort((a, b) => a.date.localeCompare(b.date) || a.sourceId.localeCompare(b.sourceId));

  // Client ledgers, including the running balance check: a ledger must never go into debit.
  const ledgers = new Map<string, Cents>(Object.entries(opening.clientLedgers));
  const flaggedIntra = new Set<string>();
  for (const e of entries) {
    if (!e.matterRef) {
      issues.push({
        severity: "breach",
        code: "unattributed_entry",
        message: `${e.date} ${fmt(e.amount)} (${e.payerOrPayee || e.reference || e.sourceId}) is not attributed to a client ledger`,
        ref: e.sourceId,
      });
      continue;
    }
    if (!knownMatters.has(e.matterRef)) {
      issues.push({ severity: "warning", code: "unknown_matter", message: `Entry ${e.sourceId} refers to unknown matter ${e.matterRef}`, ref: e.sourceId });
    }
    const bal = (ledgers.get(e.matterRef) ?? 0) + e.amount;
    ledgers.set(e.matterRef, bal);
    if (bal < 0 && !flaggedIntra.has(e.matterRef)) {
      flaggedIntra.add(e.matterRef);
      issues.push({
        severity: "breach",
        code: "ledger_overdrawn_intra_period",
        message: `Client ledger ${e.matterRef} went into debit (${fmt(bal)}) on ${e.date}`,
        ref: e.matterRef,
      });
    }
    if (e.amount > 0 && e.amlBasis === "private") {
      issues.push({
        severity: "warning",
        code: "aml_private_receipt",
        message: `Receipt ${fmt(e.amount)} from "${e.payerOrPayee}" on ${e.matterRef} is not from an insurer, government body or court. Check AML/CTF designated-service status.`,
        ref: e.sourceId,
      });
    }
  }
  for (const [ref, bal] of ledgers) {
    if (bal < 0) {
      issues.push({ severity: "breach", code: "ledger_overdrawn", message: `Client ledger ${ref} is in debit at period end (${fmt(bal)})`, ref });
    }
  }

  const cashbookBalance = opening.cashbook + entries.reduce((s, e) => s + e.amount, 0);
  const clientLedgerTotal = [...ledgers.values()].reduce((s, v) => s + v, 0);
  const unattributedTotal = entries.filter((e) => !e.matterRef).reduce((s, e) => s + e.amount, 0);

  const statementLines = statement.lines.filter((l) => l.date > opening.asAt && l.date <= periodEnd);
  const { unmatchedEntries, unmatchedLines } = matchToStatement(entries, statementLines);
  const outstanding = {
    deposits: unmatchedEntries.filter((e) => e.amount > 0),
    payments: unmatchedEntries.filter((e) => e.amount < 0),
  };
  const adjustedBank = statement.closingBalance + unmatchedEntries.reduce((s, e) => s + e.amount, 0);

  for (const l of unmatchedLines) {
    const age = workingDaysBetween(calendar, l.date, asAt);
    const late = age > POSTING_LIMIT_WORKING_DAYS;
    issues.push({
      severity: late ? "breach" : "warning",
      code: late ? "late_posting" : "unposted_statement_line",
      message: `Bank line ${l.date} ${fmt(l.amount)} "${l.description}" is not in the trust cashbook${late ? ` after ${age} working days (limit ${POSTING_LIMIT_WORKING_DAYS})` : ""}`,
      ref: l.id,
    });
  }

  if (adjustedBank !== cashbookBalance) {
    issues.push({
      severity: "breach",
      code: "cashbook_bank_mismatch",
      message: `Adjusted bank balance ${fmt(adjustedBank)} ≠ cashbook ${fmt(cashbookBalance)} (difference ${fmt(adjustedBank - cashbookBalance)})`,
    });
  }
  if (clientLedgerTotal !== cashbookBalance) {
    issues.push({
      severity: "breach",
      code: "cashbook_ledger_mismatch",
      message: `Client ledgers total ${fmt(clientLedgerTotal)} ≠ cashbook ${fmt(cashbookBalance)}${unattributedTotal ? ` (${fmt(unattributedTotal)} unattributed)` : ""}`,
    });
  }

  const dueBy = addWorkingDays(calendar, periodEnd, RECONCILIATION_LIMIT_WORKING_DAYS);
  if (asAt > dueBy) {
    issues.push({ severity: "breach", code: "reconciliation_overdue", message: `Reconciliation for ${periodEnd} was due by ${dueBy}` });
  }

  return {
    periodEnd,
    preparedAsAt: asAt,
    dueBy,
    bankClosing: statement.closingBalance,
    outstanding,
    adjustedBank,
    cashbookBalance,
    clientLedgerTotal,
    clientLedgers: [...ledgers].map(([matterRef, balance]) => ({ matterRef, balance })).sort((a, b) => a.matterRef.localeCompare(b.matterRef)),
    unpostedStatementLines: unmatchedLines,
    issues,
    reconciled: !issues.some((i) => i.severity === "breach"),
  };
}
