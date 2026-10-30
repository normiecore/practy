/**
 * Purpose-built form for compute_damages, grouped the way particulars of damages are prepared.
 * Field names match the command's input exactly; the generic CommandForm remains the fallback.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { SCHEME_LABEL } from "../api";
import { DateField, LineItems, MoneyField, NumberField, prune, SelectField, TextField, type Column } from "../form-fields";
import { useAct } from "../ui";

/** The firm's damages rules (src/damages/tables.ts DAMAGES_DEFAULTS), shown so they can be changed for one matter. */
const FIRM_DEFAULTS = { jongenPercent: 15, contingencyPercent: 5, interestPercent: 3 };

const SCHEMES: [string, string][] = [
  ["icwa_mva", SCHEME_LABEL.icwa_mva ?? "ICWA motor vehicle"],
  ["workcover_wa", SCHEME_LABEL.workcover_wa ?? "WorkCover WA"],
  ["public_liability", "Public liability"],
  ["medical_negligence", "Medical negligence"],
  ["other", "Other"],
];

const COLUMNS: Record<string, Column[]> = {
  weeklyPayments: [
    { key: "from", label: "From", kind: "date" },
    { key: "to", label: "To", kind: "date" },
    { key: "grossPaidCents", label: "Gross paid", kind: "money" },
    { key: "payer", label: "Payer", kind: "text" },
    { key: "source", label: "Source", kind: "text", optional: true },
  ],
  unindemnifiedPeriods: [
    { key: "from", label: "From", kind: "date" },
    { key: "to", label: "To", kind: "date" },
    { key: "grossWeeklyCents", label: "Gross weekly", kind: "money", optional: true },
    { key: "note", label: "Note", kind: "text", optional: true },
  ],
  specialDamages: [
    { key: "from", label: "From", kind: "date", optional: true },
    { key: "to", label: "To", kind: "date", optional: true },
    { key: "providerPayer", label: "Provider or payee", kind: "text" },
    { key: "item", label: "Item", kind: "text" },
    { key: "amountCents", label: "Amount", kind: "money" },
    { key: "period", label: "Period as shown", kind: "text", optional: true },
    {
      key: "paidBy",
      label: "Paid by",
      kind: "text",
      options: [
        ["insurer", "Insurer"],
        ["plaintiff", "Plaintiff"],
      ],
    },
  ],
  pastGratuitousServices: [
    { key: "from", label: "From", kind: "date" },
    { key: "to", label: "To", kind: "date" },
    { key: "provider", label: "Provider", kind: "text" },
    { key: "service", label: "Service", kind: "text" },
    { key: "hourlyRateCents", label: "Hourly rate", kind: "money" },
    { key: "hoursPerWeek", label: "Hours a week", kind: "number" },
    { key: "hoursDescription", label: "As the evidence describes it", kind: "text", optional: true },
  ],
  futureMedical: [
    { key: "service", label: "Service", kind: "text" },
    { key: "costCents", label: "Cost each time", kind: "money" },
    { key: "frequencyPerYear", label: "Times a year", kind: "number" },
    { key: "frequency", label: "As the evidence describes it", kind: "text", optional: true },
    { key: "evidence", label: "Evidence", kind: "text", optional: true },
  ],
  futureCare: [
    { key: "description", label: "Care", kind: "text", optional: true },
    { key: "hourlyRateCents", label: "Hourly rate", kind: "money" },
    { key: "hoursPerWeek", label: "Hours a week", kind: "number" },
    { key: "hoursDescription", label: "As the evidence describes it", kind: "text", optional: true },
    { key: "evidence", label: "Evidence", kind: "text", optional: true },
  ],
  aids: [
    { key: "item", label: "Item", kind: "text" },
    { key: "amountCents", label: "Amount", kind: "money" },
    { key: "note", label: "Note", kind: "text", optional: true },
  ],
  otherItems: [
    { key: "item", label: "Item", kind: "text" },
    { key: "amountCents", label: "Amount", kind: "money" },
    { key: "calculation", label: "Calculation", kind: "text", optional: true },
  ],
};

export interface DamagesDefaults {
  scheme?: string;
  clientName?: string;
  dateOfBirth?: string;
  injuryDate?: string;
}

type Draft = Record<string, any>;

const today = () => new Date().toISOString().slice(0, 10);

function startingDraft(previous: Draft | undefined, d: DamagesDefaults): Draft {
  if (previous) {
    const { matterId: _m, ...rest } = previous;
    // A new version is worked out to today; the previous date is shown beside the field.
    return { ...rest, calculationDate: today() };
  }
  return {
    scheme: d.scheme,
    plaintiff: { name: d.clientName, dateOfBirth: d.dateOfBirth },
    injuryDate: d.injuryDate,
    calculationDate: today(),
    preInjuryEarnings: {},
    generalDamagesCents: null,
    lifeExpectancy: {},
    ...FIRM_DEFAULTS,
  };
}

/** What the server needs before it can compute anything; checked here so the form can point at the field. */
function missing(v: Draft): string[] {
  const out: string[] = [];
  if (!v.plaintiff?.sex) out.push("Plaintiff sex (for the life tables and multipliers)");
  if (!v.plaintiff?.dateOfBirth) out.push("Date of birth");
  if (!v.injuryDate) out.push("Date of injury");
  if (!v.calculationDate) out.push("Calculation date");
  if (v.preInjuryEarnings?.grossWeeklyCents === undefined && v.preInjuryEarnings?.grossAnnualCents === undefined) out.push("Pre-injury gross weekly or annual earnings");
  if (!v.lifeExpectancy?.years) out.push("Life expectancy (years)");
  if (!v.lifeExpectancy?.citation?.trim()) out.push("Life expectancy source");
  return out;
}

function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="card form-group">
      <legend>{title}</legend>
      {hint && <p className="hint" style={{ marginTop: 0 }}>{hint}</p>}
      {children}
    </fieldset>
  );
}

export function DamagesForm({ matterId, previous, defaults, onDone }: { matterId: string; previous?: Draft; defaults: DamagesDefaults; onDone: () => void }) {
  const act = useAct();
  const [v, setV] = useState<Draft>(() => startingDraft(previous, defaults));
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string[]>([]);

  const set = (key: string, value: unknown) => setV((d) => ({ ...d, [key]: value }));
  const sub = (key: string, field: string, value: unknown) => setV((d) => ({ ...d, [key]: { ...(d[key] ?? {}), [field]: value } }));
  const rows = (key: string, empty: string, addLabel = "Add row") => <LineItems columns={COLUMNS[key]!} rows={v[key]} onChange={(r) => set(key, r)} empty={empty} addLabel={addLabel} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const gaps = missing(v);
    setShown(gaps);
    if (gaps.length) return;
    const body = prune(v) as Draft;
    // Required objects stay even when blank; general damages left blank is sent as null, never a figure.
    body.preInjuryEarnings ??= {};
    body.generalDamagesCents = v.generalDamagesCents ?? null;
    setBusy(true);
    const out = await act("compute_damages", { ...body, matterId }, "Damages saved as a new version");
    setBusy(false);
    if (out) onDone();
  };

  const p = v.plaintiff ?? {};
  return (
    <form onSubmit={submit} noValidate>
      <p className="muted small">
        Saves a new draft version for practitioner review using the firm's rules: net is gross less income tax only, 6% weekly multipliers in whole years, interest on the plaintiff's own losses. Leave optional lines blank to omit them.
      </p>

      <Group title="Plaintiff and claim">
        <div className="form-grid">
          <TextField label="Name" value={p.name} onChange={(x) => sub("plaintiff", "name", x)} hint={!p.name && defaults.clientName ? `Defaults to ${defaults.clientName}` : undefined} />
          <DateField label="Date of birth" value={p.dateOfBirth} onChange={(x) => sub("plaintiff", "dateOfBirth", x)} />
          <SelectField
            label="Sex"
            value={p.sex}
            onChange={(x) => sub("plaintiff", "sex", x)}
            blank="Choose…"
            options={[
              ["male", "Male"],
              ["female", "Female"],
            ]}
            hint="Used for the life tables"
          />
          <DateField label="Date of injury" value={v.injuryDate} onChange={(x) => set("injuryDate", x)} />
          <DateField
            label="Calculation date"
            value={v.calculationDate}
            onChange={(x) => set("calculationDate", x)}
            hint={previous?.calculationDate && previous.calculationDate !== v.calculationDate ? `The previous version was worked out to ${previous.calculationDate}` : undefined}
          />
          <SelectField label="Scheme" value={v.scheme} onChange={(x) => set("scheme", x)} options={SCHEMES} blank="Matter's scheme" />
          <NumberField label="Whole person impairment" suffix="%" value={v.wpiPercent} onChange={(x) => set("wpiPercent", x)} hint="For the WorkCover s 424 band" />
          <MoneyField label="Section 424 cap" value={v.s424CapCents} onChange={(x) => set("s424CapCents", x)} hint="WorkCover only, once confirmed" />
        </div>
        <TextField label="Background" value={p.background} onChange={(x) => sub("plaintiff", "background", x)} placeholder="e.g. manual work background" hint="As instructed or as the evidence shows" />
      </Group>

      <Group title="Pre-injury earnings" hint="The rate at the date of the accident. Give weekly or annual (annual is divided by 52).">
        <div className="form-grid">
          <MoneyField label="Gross weekly" value={v.preInjuryEarnings?.grossWeeklyCents} onChange={(x) => sub("preInjuryEarnings", "grossWeeklyCents", x)} />
          <MoneyField label="Gross annual" value={v.preInjuryEarnings?.grossAnnualCents} onChange={(x) => sub("preInjuryEarnings", "grossAnnualCents", x)} />
          <TextField label="Source" value={v.preInjuryEarnings?.source} onChange={(x) => sub("preInjuryEarnings", "source", x)} placeholder="e.g. payslips, 2023 to 2024 tax return" />
        </div>
      </Group>

      <Group title="Weekly payments and unindemnified periods">
        <h3>Weekly payments received</h3>
        {rows("weeklyPayments", "No weekly payments.", "Add payment period")}
        <h3>Unindemnified periods claimed</h3>
        <p className="hint">Leave empty to claim from the day after the last weekly payment (or the injury) to the calculation date. Gross weekly defaults to the pre-injury rate.</p>
        {rows("unindemnifiedPeriods", "", "Add period")}
      </Group>

      <Group title="Past superannuation">
        <div className="form-grid">
          <DateField label="Past super runs from" value={v.pastSuperFrom} onChange={(x) => set("pastSuperFrom", x)} hint="Defaults to the date of injury (weekly payments attract no super)" />
        </div>
      </Group>

      <Group title="Special damages" hint="Out-of-pocket expenses. Items paid by the insurer are refundable to it.">
        {rows("specialDamages", "No special damages.", "Add item")}
      </Group>

      <Group title="Past gratuitous services">{rows("pastGratuitousServices", "No past gratuitous services.", "Add service")}</Group>

      <Group title="Future medical" hint="Each item is converted to a weekly cost and multiplied over life expectancy.">
        {rows("futureMedical", "No future medical expenses.", "Add item")}
      </Group>

      <Group title="Future care">{rows("futureCare", "No future care.", "Add care")}</Group>

      <Group title="Aids and equipment">{rows("aids", "No aids.", "Add aid")}</Group>

      <Group title="Other items">{rows("otherItems", "No other items.", "Add item")}</Group>

      <Group title="General damages">
        <div className="form-grid">
          <MoneyField
            label="General damages"
            value={v.generalDamagesCents}
            onChange={(x) => set("generalDamagesCents", x ?? null)}
            placeholder="Not yet assessed"
          />
        </div>
        <p className="hint">The practitioner sets this figure. Left blank, the particulars show a marked placeholder; Practy never estimates it.</p>
      </Group>

      <Group title="Life expectancy and multipliers">
        <div className="form-grid">
          <NumberField label="Life expectancy" suffix="years" value={v.lifeExpectancy?.years} onChange={(x) => sub("lifeExpectancy", "years", x)} />
          <TextField label="Life expectancy source" value={v.lifeExpectancy?.citation} onChange={(x) => sub("lifeExpectancy", "citation", x)} placeholder="e.g. ABS Life Tables, Western Australia, 2022 to 2024" />
          <NumberField label="Earnings multiplier period" suffix="years" value={v.multiplierYears?.earnings} onChange={(x) => sub("multiplierYears", "earnings", x)} hint="Defaults to working life to age 67" />
          <NumberField label="Lifetime multiplier period" suffix="years" value={v.multiplierYears?.lifetime} onChange={(x) => sub("multiplierYears", "lifetime", x)} hint="Defaults to life expectancy" />
          <NumberField label="Loss of future earning capacity" suffix="%" value={v.futureLossPercent} onChange={(x) => set("futureLossPercent", x)} placeholder="100" hint="For a partial loss; defaults to 100%" />
        </div>
      </Group>

      <Group title="Firm parameters" hint="The firm's defaults are filled in. Change them only where the matter calls for it.">
        <div className="form-grid">
          <NumberField label="Jongen discount" suffix="%" value={v.jongenPercent} onChange={(x) => set("jongenPercent", x)} placeholder={String(FIRM_DEFAULTS.jongenPercent)} hint={`Firm default ${FIRM_DEFAULTS.jongenPercent}%, between 15% and 30%`} />
          <NumberField label="Contingencies" suffix="%" value={v.contingencyPercent} onChange={(x) => set("contingencyPercent", x)} placeholder={String(FIRM_DEFAULTS.contingencyPercent)} hint={`Firm default ${FIRM_DEFAULTS.contingencyPercent}%`} />
          <NumberField label="Interest" suffix="% a year" value={v.interestPercent} onChange={(x) => set("interestPercent", x)} placeholder={String(FIRM_DEFAULTS.interestPercent)} hint={`Firm default ${FIRM_DEFAULTS.interestPercent}%`} />
        </div>
      </Group>

      <TextField label="Version note (optional)" value={v.note} onChange={(x) => set("note", x)} placeholder="e.g. updated for the latest specials schedule" />

      {shown.length > 0 && (
        <div className="notice danger small" role="alert">
          Still needed: {shown.join("; ")}.
        </div>
      )}
      <div className="modal-actions">
        <button disabled={busy}>{busy ? "Working…" : "Compute damages"}</button>
      </div>
    </form>
  );
}
