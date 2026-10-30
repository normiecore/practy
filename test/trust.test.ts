import { describe, expect, it } from "vitest";
import { parseAuDate, parseMoney } from "../src/trust/csv.js";
import { AddOnCsvTrustSource, parseCashbookCsv } from "../src/trust/sources/addon-csv.js";
import { XeroTrustSource, type XeroBankTransaction } from "../src/trust/sources/xero.js";
import type { TrustSource } from "../src/trust/model.js";
import { as, openMatter, setup, TENANT, users } from "./helpers.js";

const TRUST_ACCOUNT = "11111111-2222-3333-4444-555555555555";

const tracking = (matter: string) => [{ Name: "Matter", Option: matter }];
const XERO_OCTOBER: XeroBankTransaction[] = [
  { BankTransactionID: "bt1", Type: "RECEIVE", Status: "AUTHORISED", DateString: "2026-10-05T00:00:00", Reference: "SL-1998 settlement", Total: 100000, Contact: { Name: "Insurance Commission of Western Australia" }, LineItems: [{ LineAmount: 100000, Tracking: tracking("SL-1998") }] },
  { BankTransactionID: "bt2", Type: "SPEND", Status: "AUTHORISED", DateString: "2026-10-08T00:00:00", Reference: "Medicare charge", Total: 3000, Contact: { Name: "Services Australia" }, LineItems: [{ LineAmount: 3000, Tracking: tracking("SL-1998") }] },
  { BankTransactionID: "bt3", Type: "SPEND-TRANSFER", Status: "AUTHORISED", Date: "/Date(1791763200000+0000)/", Reference: "SL-1998 costs inv 101", Total: 20000 },
  { BankTransactionID: "bt4", Type: "RECEIVE", Status: "AUTHORISED", DateString: "2026-10-20T00:00:00", Reference: "", Total: 1000, Contact: { Name: "John Citizen" }, LineItems: [{ LineAmount: 1000, Tracking: tracking("SL-2001") }] },
  { BankTransactionID: "bt5", Type: "SPEND", Status: "AUTHORISED", DateString: "2026-10-30T00:00:00", Reference: "Settlement distribution", Total: 50000, Contact: { Name: "Toni Priestley" }, LineItems: [{ LineAmount: 50000, Tracking: tracking("SL-1998") }] },
  { BankTransactionID: "bt6", Type: "RECEIVE", Status: "DELETED", DateString: "2026-10-21T00:00:00", Total: 999, LineItems: [] },
];

const STATEMENT = `Date,Amount,Description
05/10/2026,"100,000.00",ICWA PAYMENT
09/10/2026,-3000.00,MEDICARE RECOVERY
12/10/2026,-20000.00,TFR TO OFFICE
21/10/2026,1000.00,J CITIZEN
`;
const CLOSING = 8_300_000;

function xeroSource(transactions = XERO_OCTOBER) {
  const calls: string[] = [];
  const source = new XeroTrustSource({
    xeroTenantId: "xero-tenant",
    trustBankAccountId: TRUST_ACCOUNT,
    getAccessToken: async () => "token",
    trackingCategoryName: "Matter",
    referencePattern: /\b(SL-\d+)\b/,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>)["xero-tenant-id"]).toBe("xero-tenant");
      return new Response(JSON.stringify({ BankTransactions: transactions }), { status: 200 });
    }) as typeof fetch,
  });
  return { source, calls };
}

const ADDON_CSV = `Date,Matter,Name,Reference,Type,Receipt,Payment
5/10/2026,SL-1998,Insurance Commission of Western Australia,SL-1998 settlement,Receipt,"100,000.00",
8/10/2026,SL-1998,Services Australia,Medicare charge,Payment,,3000.00
12/10/2026,SL-1998,Soul Legal office account,Inv 101,Transfer to office,,20000.00
20/10/2026,SL-2001,John Citizen,,Receipt,1000.00,
30/10/2026,SL-1998,Toni Priestley,Settlement distribution,Payment,,50000.00
`;

async function pilot(source: TrustSource, today = "2026-11-03") {
  const t = setup(today);
  await openMatter(t.exec);
  await openMatter(t.exec, { number: "SL-2001", title: "Citizen v Employer", scheme: "workcover_wa", client: { name: "John Citizen" }, otherParties: [] });
  t.app.trust.configs.set(TENANT, {
    source,
    accountName: "Soul Legal Law Practice Trust Account",
    opening: { asAt: "2026-09-30", cashbook: 500_000, clientLedgers: { "SL-1998": 500_000 } },
    statementMapping: { date: "Date", amount: "Amount", description: "Description" },
  });
  return t;
}

describe("parsing", () => {
  it("handles Australian dates and money formats", () => {
    expect(parseAuDate("5/10/2026")).toBe("2026-10-05");
    expect(parseAuDate("05/10/26")).toBe("2026-10-05");
    expect(parseMoney("$1,234.5")).toBe(123_450);
    expect(parseMoney("(45.00)")).toBe(-4_500);
  });
});

describe("Xero trust source (trust account kept in Xero)", () => {
  it("maps bank transactions, transfers and tracking to cashbook entries", async () => {
    const { source, calls } = xeroSource();
    const entries = await source.fetchCashbook({ from: "2026-10-01", to: "2026-10-31" });
    expect(decodeURIComponent(calls[0]!)).toContain(`BankAccount.AccountID==guid("${TRUST_ACCOUNT}")`);
    expect(entries).toHaveLength(5);
    expect(entries.find((e) => e.sourceId === "xero:bt3")).toMatchObject({ kind: "transfer_out", amount: -2_000_000, matterRef: "SL-1998", date: "2026-10-12" });
    expect(entries.find((e) => e.sourceId === "xero:bt1")?.amlBasis).toBe("insurer_or_government");
    expect(entries.find((e) => e.sourceId === "xero:bt4")?.amlBasis).toBe("private");
  });

  it("splits one receipt across matters when each line is tracked", () => {
    const { source } = xeroSource();
    const split = source.toEntries({
      BankTransactionID: "bt9", Type: "RECEIVE", Status: "AUTHORISED", DateString: "2026-10-01T00:00:00", Total: 300,
      Contact: { Name: "ICWA" }, LineItems: [{ LineAmount: 100, Tracking: tracking("SL-1") }, { LineAmount: 200, Tracking: tracking("SL-2") }],
    });
    expect(split.map((e) => [e.matterRef, e.amount])).toEqual([["SL-1", 10_000], ["SL-2", 20_000]]);
  });
});

describe("trust add-on source (trust kept in a Xero add-on)", () => {
  it("produces the same cashbook as the Xero source", async () => {
    const fromAddon = parseCashbookCsv(ADDON_CSV, { date: "Date", matter: "Matter", party: "Name", reference: "Reference", type: "Type", receipt: "Receipt", payment: "Payment" });
    const fromXero = await xeroSource().source.fetchCashbook({ from: "2026-10-01", to: "2026-10-31" });
    const shape = (es: typeof fromXero) => es.map((e) => [e.date, e.amount, e.matterRef, e.kind, e.amlBasis]);
    expect(shape(fromAddon)).toEqual(shape(fromXero));
  });
});

describe.each([
  ["Xero", () => xeroSource().source],
  ["add-on", () => new AddOnCsvTrustSource(async () => ADDON_CSV, { date: "Date", matter: "Matter", party: "Name", reference: "Reference", type: "Type", receipt: "Receipt", payment: "Payment" })],
])("shadow reconciliation via %s", (_label, makeSource) => {
  it("reconciles bank, cashbook and client ledgers with an unpresented payment", async () => {
    const { exec } = await pilot(makeSource());
    const rec = await exec("prepare_trust_reconciliation", { periodEnd: "2026-10-31", statementCsv: STATEMENT, closingBalanceCents: CLOSING }, as(users.accounts));
    expect(rec).toMatchObject({ cashbookBalance: 3_300_000, adjustedBank: 3_300_000, clientLedgerTotal: 3_300_000, dueBy: "2026-11-20", reconciled: true });
    expect(rec.outstanding.payments).toHaveLength(1);
    expect(rec.issues.map((i: any) => i.code)).toEqual(["aml_private_receipt"]);
    expect(Object.isFrozen(rec)).toBe(true);
  });

  it("raises breaches for late postings, mismatches and overdue reconciliations", async () => {
    const { exec } = await pilot(makeSource(), "2026-11-25");
    const statement = `${STATEMENT}15/10/2026,500.00,UNKNOWN DEPOSIT\n`;
    const rec = await exec("prepare_trust_reconciliation", { periodEnd: "2026-10-31", statementCsv: statement, closingBalanceCents: CLOSING + 50_000 }, as(users.accounts));
    const codes = rec.issues.map((i: any) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["late_posting", "cashbook_bank_mismatch", "reconciliation_overdue"]));
    expect(rec.reconciled).toBe(false);
  });
});

describe("trust controls", () => {
  it("flags a client ledger going into debit during the month", async () => {
    const overdraw = XERO_OCTOBER.map((t) => (t.BankTransactionID === "bt5" ? { ...t, DateString: "2026-10-02T00:00:00" } : t));
    const { exec } = await pilot(xeroSource(overdraw).source);
    const rec = await exec("prepare_trust_reconciliation", { periodEnd: "2026-10-31", statementCsv: STATEMENT, closingBalanceCents: CLOSING }, as(users.accounts));
    expect(rec.issues.find((i: any) => i.code === "ledger_overdrawn_intra_period")).toMatchObject({ ref: "SL-1998" });
    expect(rec.reconciled).toBe(false);
  });

  it("only signs off clean reconciliations, via principal approval", async () => {
    const { exec, run } = await pilot(xeroSource().source);
    const rec = await exec("prepare_trust_reconciliation", { periodEnd: "2026-10-31", statementCsv: STATEMENT, closingBalanceCents: CLOSING }, as(users.accounts));
    const req = await run("sign_off_trust_reconciliation", { reconciliationId: rec.id }, as(users.accounts, "mcp"));
    if (req.status !== "pending_approval") throw new Error("expected approval");
    await expect(run("decide_approval", { approvalId: req.approvalId, decision: "approve" }, as(users.accounts))).rejects.toMatchObject({ code: "forbidden" });
    const done = await exec("decide_approval", { approvalId: req.approvalId, decision: "approve" }, as(users.principal));
    expect(done.status).toBe("executed");
    expect(done.result.signedOffBy).toBe(users.principal.userId);
  });

  it("requires two trust authorisers other than the requester, and blocks payments that overdraw", async () => {
    const { app, exec, run } = await pilot(xeroSource().source);
    const matter = app.store.mattersFor(TENANT).find((m) => m.number === "SL-1998")!;
    const balance = await exec("get_trust_balance", { matterId: matter.id }, as(users.solicitor, "mcp"));
    expect(balance.balance).toBe(3_200_000);

    const req = await run("prepare_trust_payment", { matterId: matter.id, payee: "Toni Priestley", amountCents: 3_000_000, purpose: "Balance of settlement" }, as(users.solicitor, "mcp"));
    if (req.status !== "pending_approval") throw new Error("expected approval");
    expect(req.requiredApprovals).toBe(2);
    expect(app.trust.paymentAuthorities).toHaveLength(0);

    const first = await exec("decide_approval", { approvalId: req.approvalId, decision: "approve" }, as(users.principal));
    expect(first.status).toBe("pending");
    await expect(run("decide_approval", { approvalId: req.approvalId, decision: "approve" }, as(users.principal))).rejects.toMatchObject({ code: "forbidden" });
    const second = await exec("decide_approval", { approvalId: req.approvalId, decision: "approve" }, as(users.accounts));
    expect(second.status).toBe("executed");
    expect((await exec("get_trust_balance", { matterId: matter.id }, as(users.solicitor))).available).toBe(200_000);

    // A further payment beyond the remaining available balance fails at execution.
    const over = await run("prepare_trust_payment", { matterId: matter.id, payee: "Toni Priestley", amountCents: 300_000, purpose: "Extra" }, as(users.solicitor));
    if (over.status !== "pending_approval") throw new Error("expected approval");
    await exec("decide_approval", { approvalId: over.approvalId, decision: "approve" }, as(users.principal));
    const blocked = await exec("decide_approval", { approvalId: over.approvalId, decision: "approve" }, as(users.accounts));
    expect(blocked.status).toBe("failed");
    expect(blocked.error).toMatch(/may not go into debit/);
  });
});
