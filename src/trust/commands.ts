import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson, sha256 } from "../core/audit.js";
import { WA_CALENDAR, type IsoDate, type WorkingCalendar } from "../core/calendar.js";
import { conflict, invalid, notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import type { InvocationContext, Role } from "../core/types.js";
import type { Store } from "../domain/store.js";
import type { CashbookEntry, Cents, TrustSource } from "./model.js";
import { reconcile, type OpeningBalances, type Reconciliation } from "./reconcile.js";
import { parseBankStatementCsv, type StatementCsvMapping } from "./sources/addon-csv.js";

/**
 * Shadow trust ledger (pilot step 1). Reads the firm's existing trust records from
 * Xero or a trust add-on and checks them against the Uniform Law controls. Practy is
 * NOT the trust ledger of record in this mode and never writes to the source.
 */
export interface TrustTenantConfig {
  source: TrustSource;
  opening: OpeningBalances;
  statementMapping: StatementCsvMapping;
  accountName: string;
}

export interface StoredReconciliation extends Reconciliation {
  id: string;
  tenantId: string;
  sourceKind: string;
  /** Content hash: the prepared reconciliation is immutable; sign-off references this hash. */
  hash: string;
  signedOffBy?: string;
  signedOffAt?: string;
}

export interface PaymentAuthority {
  id: string;
  tenantId: string;
  matterRef: string;
  payee: string;
  amount: Cents;
  purpose: string;
  status: "authorised";
  authorisedAt: string;
}

export class TrustService {
  readonly configs = new Map<string, TrustTenantConfig>();
  readonly reconciliations;
  readonly paymentAuthorities;
  private readonly cache = new Map<string, CashbookEntry[]>();

  constructor(
    private readonly store: Store,
    private readonly calendar: WorkingCalendar = WA_CALENDAR,
    private readonly today: () => IsoDate = () => new Date().toISOString().slice(0, 10),
  ) {
    this.reconciliations = store.collection<StoredReconciliation>("trust_reconciliation");
    this.paymentAuthorities = store.collection<PaymentAuthority>("trust_payment_authority");
  }

  config(tenantId: string): TrustTenantConfig {
    const cfg = this.configs.get(tenantId);
    if (!cfg) throw invalid("No trust source configured for this firm");
    return cfg;
  }

  async sync(tenantId: string): Promise<CashbookEntry[]> {
    const cfg = this.config(tenantId);
    const entries = await cfg.source.fetchCashbook({ from: cfg.opening.asAt, to: this.today() });
    this.cache.set(tenantId, entries);
    return entries;
  }

  async entries(tenantId: string): Promise<CashbookEntry[]> {
    return this.cache.get(tenantId) ?? this.sync(tenantId);
  }

  async ledgerBalances(tenantId: string): Promise<Map<string, Cents>> {
    const cfg = this.config(tenantId);
    const balances = new Map<string, Cents>(Object.entries(cfg.opening.clientLedgers));
    for (const e of await this.entries(tenantId)) {
      if (e.matterRef && e.date > cfg.opening.asAt) balances.set(e.matterRef, (balances.get(e.matterRef) ?? 0) + e.amount);
    }
    return balances;
  }

  /** Pending (approved-but-not-yet-synced) payment authorities reduce the available balance. */
  async availableBalance(tenantId: string, matterRef: string): Promise<Cents> {
    const held = (await this.ledgerBalances(tenantId)).get(matterRef) ?? 0;
    const committed = this.paymentAuthorities
      .list(tenantId, (p) => p.matterRef === matterRef)
      .reduce((s, p) => s + p.amount, 0);
    return held - committed;
  }

  async prepareReconciliation(tenantId: string, periodEnd: IsoDate, statementCsv: string, closingBalance: Cents) {
    const cfg = this.config(tenantId);
    const statement = parseBankStatementCsv(statementCsv, cfg.statementMapping, {
      accountName: cfg.accountName,
      closingBalance,
      closingDate: periodEnd,
    });
    const rec = reconcile({
      periodEnd,
      asAt: this.today(),
      opening: cfg.opening,
      entries: await this.sync(tenantId),
      statement,
      knownMatters: new Set(this.store.mattersFor(tenantId).map((m) => m.number)),
      calendar: this.calendar,
    });
    const stored: StoredReconciliation = Object.freeze({
      ...rec,
      id: randomUUID(),
      tenantId,
      sourceKind: cfg.source.info.kind,
      hash: sha256(canonicalJson(rec)),
    });
    return this.reconciliations.set(stored);
  }
}

const TRUST_STAFF: Role[] = ["principal", "accounts", "trust_authoriser"];

function matterRefFor(store: Store, ctx: InvocationContext, matterId: string): string {
  const m = store.matters.get(matterId);
  if (!m || m.tenantId !== ctx.actor.tenantId) throw notFound(`Matter ${matterId}`);
  return m.number;
}

export function trustCommands(store: Store, trust: TrustService) {
  return [
    defineCommand({
      name: "get_trust_balance",
      title: "Trust balance (shadow)",
      description:
        "Client trust ledger balance and entries for a matter, read from the firm's current trust records (Xero or trust add-on). Shadow figures, not the ledger of record.",
      tier: 0,
      input: z.object({ matterId: z.string() }),
      matterIds: (i) => [i.matterId],
      handler: async ({ matterId }, ctx) => {
        const ref = matterRefFor(store, ctx, matterId);
        const tenantId = ctx.actor.tenantId;
        const entries = (await trust.entries(tenantId)).filter((e) => e.matterRef === ref);
        return {
          matterRef: ref,
          source: trust.config(tenantId).source.info.label,
          balance: (await trust.ledgerBalances(tenantId)).get(ref) ?? 0,
          available: await trust.availableBalance(tenantId, ref),
          entries,
          note: "Shadow ledger during the pilot. Amounts in cents.",
        };
      },
    }),

    defineCommand({
      name: "sync_trust_records",
      title: "Sync trust records",
      description: "Re-read the trust cashbook from Xero or the trust add-on (read-only).",
      tier: 1,
      roles: TRUST_STAFF,
      input: z.object({}),
      handler: async (_i, ctx) => {
        const entries = await trust.sync(ctx.actor.tenantId);
        return { entries: entries.length, unattributed: entries.filter((e) => !e.matterRef).length };
      },
    }),

    defineCommand({
      name: "prepare_trust_reconciliation",
      title: "Prepare trust reconciliation",
      description:
        "Prepare the month-end three-way reconciliation (bank statement vs cashbook vs client ledgers) and run the Uniform Law checks: ledgers in debit, unattributed entries, late postings, AML drift and the 15-working-day deadline. The prepared report is immutable.",
      tier: 1,
      roles: TRUST_STAFF,
      input: z.object({
        periodEnd: z.iso.date(),
        statementCsv: z.string().min(1).describe("The trust account bank statement export (CSV) for the period"),
        closingBalanceCents: z.number().int().describe("Closing balance printed on the bank statement, in cents"),
      }),
      handler: async ({ periodEnd, statementCsv, closingBalanceCents }, ctx) =>
        trust.prepareReconciliation(ctx.actor.tenantId, periodEnd, statementCsv, closingBalanceCents),
    }),

    defineCommand({
      name: "list_trust_reconciliations",
      title: "List trust reconciliations",
      description: "Prepared reconciliations with status, issues and sign-off.",
      tier: 0,
      roles: TRUST_STAFF,
      input: z.object({}),
      handler: (_i, ctx) => trust.reconciliations.list(ctx.actor.tenantId),
    }),

    defineCommand({
      name: "sign_off_trust_reconciliation",
      title: "Sign off trust reconciliation",
      description: "Principal sign-off of a prepared reconciliation. Requires approval in Practy.",
      tier: 2,
      roles: TRUST_STAFF,
      approverRoles: ["principal"],
      input: z.object({ reconciliationId: z.string() }),
      handler: ({ reconciliationId }, ctx) => {
        const rec = trust.reconciliations.find(ctx.actor.tenantId, reconciliationId);
        if (!rec) throw notFound("Reconciliation");
        if (rec.signedOffBy) throw conflict("Already signed off");
        if (!rec.reconciled) throw conflict("Cannot sign off a reconciliation with unresolved breaches");
        return trust.reconciliations.set(Object.freeze({ ...rec, signedOffBy: ctx.actor.userId, signedOffAt: new Date().toISOString() }));
      },
    }),

    defineCommand({
      name: "prepare_trust_payment",
      title: "Prepare trust payment authority",
      description:
        "Prepare an authority to pay from a client's trust ledger (e.g. Medicare charge, client distribution). Always requires two trust authorisers in Practy; it can never be executed from chat. Blocks any payment that would put the ledger in debit.",
      tier: 3,
      roles: ["principal", "solicitor", "accounts", "trust_authoriser"],
      input: z.object({
        matterId: z.string(),
        payee: z.string().min(1),
        amountCents: z.number().int().positive(),
        purpose: z.string().min(1),
      }),
      matterIds: (i) => [i.matterId],
      handler: async ({ matterId, payee, amountCents, purpose }, ctx) => {
        const ref = matterRefFor(store, ctx, matterId);
        const available = await trust.availableBalance(ctx.actor.tenantId, ref);
        if (amountCents > available) {
          throw conflict(`Payment of ${amountCents}c exceeds the available trust balance of ${available}c on ${ref}; a client ledger may not go into debit`);
        }
        const pa: PaymentAuthority = {
          id: randomUUID(),
          tenantId: ctx.actor.tenantId,
          matterRef: ref,
          payee,
          amount: amountCents,
          purpose,
          status: "authorised",
          authorisedAt: new Date().toISOString(),
        };
        return trust.paymentAuthorities.set(pa);
      },
    }),
  ];
}

