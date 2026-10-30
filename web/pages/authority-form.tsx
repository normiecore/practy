/**
 * Purpose-built form for compute_authority_to_settle, laid out like the firm's Authority to Settle:
 * A (the offer), B (deductions), C (net in hand). The server computes every figure, including the
 * Medicare 10% advance; this form only collects the inputs.
 */
import { useState, type FormEvent } from "react";
import { money } from "../api";
import { MoneyField, prune, SelectField, TextField } from "../form-fields";
import { useAct } from "../ui";

type Draft = Record<string, any>;

const OFFER_PARTS = ["settlementOfferCents", "legalCostsCents", "disbursementsCents", "medicalAccountsCents", "medicareContributionCents"];

export function AuthorityForm({ matterId, previous, clientName, onDone }: { matterId: string; previous?: Draft; clientName?: string; onDone: () => void }) {
  const act = useAct();
  const [v, setV] = useState<Draft>(() => {
    if (!previous) return { clientName };
    const { matterId: _m, ...rest } = previous;
    return rest;
  });
  const [centrelinkMode, setCentrelinkMode] = useState<"text" | "amount">(typeof previous?.centrelink === "number" ? "amount" : "text");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const set = (key: string, value: unknown) => setV((d) => ({ ...d, [key]: value }));

  // Centrelink is one field on the server (text or cents); keep both here so switching mode loses nothing.
  const centrelinkText = v.centrelinkText ?? (typeof v.centrelink === "string" ? v.centrelink : undefined);
  const centrelinkCents = v.centrelinkCents ?? (typeof v.centrelink === "number" ? v.centrelink : undefined);
  const totalOffer = OFFER_PARTS.reduce((t, k) => t + (v[k] ?? 0), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (v.settlementOfferCents === undefined) return;
    const body = (prune({ ...v, centrelink: centrelinkMode === "amount" ? centrelinkCents : centrelinkText }) ?? {}) as Draft;
    delete body.centrelinkCents;
    delete body.centrelinkText;
    setBusy(true);
    const out = await act("compute_authority_to_settle", { ...body, matterId }, "Authority to Settle saved as a new version");
    setBusy(false);
    if (out) onDone();
  };

  return (
    <form onSubmit={submit} noValidate>
      <p className="muted small">Saves a draft version and a settlement statement. Sending the authority to the client is a separate step that needs approval.</p>

      <fieldset className="card form-group">
        <legend>Client</legend>
        <div className="form-grid">
          <TextField label="Client name" value={v.clientName} onChange={(x) => set("clientName", x)} />
          <TextField label="Date of injury" value={v.injuryDate} onChange={(x) => set("injuryDate", x)} placeholder="d/m/yyyy" hint="As shown on the form. Defaults to the matter's date of injury" />
          <TextField label="Solicitor" value={v.solicitor} onChange={(x) => set("solicitor", x)} />
        </div>
      </fieldset>

      <fieldset className="card form-group">
        <legend>A. Offer</legend>
        <div className="form-grid">
          <MoneyField label="(a) Settlement offer" value={v.settlementOfferCents} onChange={(x) => set("settlementOfferCents", x)} hint="Settlement, self-rehabilitation or general damages sum to the client" />
          <MoneyField label="(b) Legal costs" value={v.legalCostsCents} onChange={(x) => set("legalCostsCents", x)} hint="Contribution to legal costs, including GST" />
          <MoneyField label="(c) Disbursements" value={v.disbursementsCents} onChange={(x) => set("disbursementsCents", x)} />
          <MoneyField label="(d) Medical accounts" value={v.medicalAccountsCents} onChange={(x) => set("medicalAccountsCents", x)} />
          <MoneyField label="(e) Medicare contribution" value={v.medicareContributionCents} onChange={(x) => set("medicareContributionCents", x)} hint="Usually nil: Medicare is a deduction, not a contribution" />
        </div>
        <TextField label="(f) Other terms" value={v.otherTerms} onChange={(x) => set("otherTerms", x)} placeholder="One short line" />
        <p className="total-line">
          Total offer <strong>{money(totalOffer)}</strong>
        </p>
      </fieldset>

      <fieldset className="card form-group">
        <legend>B. Deductions</legend>
        <p className="hint" style={{ marginTop: 0 }}>
          The Medicare advance (10% of the total offer) and the firm's fees are worked out from section A.
        </p>
        <div className="form-grid">
          <MoneyField label="Workers compensation refund" value={v.workersCompRefundCents} onChange={(x) => set("workersCompRefundCents", x)} />
          <MoneyField label="Tax (if applicable)" value={v.taxCents} onChange={(x) => set("taxCents", x)} />
          <SelectField
            label="Centrelink refund"
            value={centrelinkMode}
            onChange={(x) => setCentrelinkMode(x === "amount" ? "amount" : "text")}
            options={[
              ["text", "Describe it (e.g. to be ascertained)"],
              ["amount", "Estimated amount"],
            ]}
          />
          {centrelinkMode === "amount" ? (
            <MoneyField label="Centrelink amount" value={centrelinkCents} onChange={(x) => set("centrelinkCents", x)} />
          ) : (
            <TextField label="Centrelink wording" value={centrelinkText} onChange={(x) => set("centrelinkText", x)} placeholder="to be ascertained" hint='Blank reads "to be ascertained"; "nil" reads Nil' />
          )}
          <MoneyField label="Legal Aid refund" value={v.legalAidRefundCents} onChange={(x) => set("legalAidRefundCents", x)} placeholder="N/A" hint="Leave blank for N/A" />
          <MoneyField label="Barrister or other solicitors' fees" value={v.otherSolicitorsFeesCents} onChange={(x) => set("otherSolicitorsFeesCents", x)} />
          <MoneyField label="Other debts" value={v.otherDebtsCents} onChange={(x) => set("otherDebtsCents", x)} />
          <TextField label="Fees label" value={v.feesLabel} onChange={(x) => set("feesLabel", x)} hint="The firm's fees line on the form; blank uses the firm's usual wording" />
        </div>
        <label className="check">
          <input type="checkbox" checked={!!v.medicalAccountsPaidByClient} onChange={(e) => set("medicalAccountsPaidByClient", e.target.checked)} />
          The client paid the medical accounts (reads "by me" and is not deducted)
        </label>
        <label className="check">
          <input type="checkbox" checked={!!v.clientPaidDisbursements} onChange={(e) => set("clientPaidDisbursements", e.target.checked)} />
          The client paid the disbursements (the disbursements contribution goes back to the client)
        </label>
      </fieldset>

      <fieldset className="card form-group">
        <legend>C. Net in hand</legend>
        <div className="form-grid">
          <MoneyField label="Residual balance held in trust" value={v.residualTrustCents} onChange={(x) => set("residualTrustCents", x)} />
        </div>
      </fieldset>

      {shown && v.settlementOfferCents === undefined && (
        <div className="notice danger small" role="alert">
          Enter the settlement offer.
        </div>
      )}
      <div className="modal-actions">
        <button disabled={busy}>{busy ? "Working…" : "Compute"}</button>
      </div>
    </form>
  );
}
