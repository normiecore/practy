/**
 * The firm's settings as a form, in the order the onboarding runbook walks them. Saving sends only
 * the changed sections to update_settings, which a principal approves in the Approvals inbox.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { CheckField, displayIssues, issueLabel, IssuesContext, ListField, NumberField, SelectField, TextField } from "../form-fields";
import { useAct } from "../ui";

type Settings = Record<string, any>;

const SECTIONS = ["firmName", "firmAddress", "timezone", "identity", "privacy", "letter", "documents", "mail", "calendar", "firmPolicy", "ai", "trust"] as const;

function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="card form-group">
      <legend>{title}</legend>
      {hint && <p className="hint" style={{ marginTop: 0 }}>{hint}</p>}
      <div className="form-grid">{children}</div>
    </fieldset>
  );
}

/** Returns a copy of `obj` with the value at a dotted path replaced. */
function setIn(obj: Settings, path: string, value: unknown): Settings {
  const [head, ...rest] = path.split(".");
  return { ...obj, [head!]: rest.length ? setIn(obj[head!] ?? {}, rest.join("."), value) : value };
}
const getIn = (obj: Settings, path: string): any => path.split(".").reduce((o, k) => o?.[k], obj);

export function FirmSettingsForm({ current, onDone }: { current: Settings; onDone: () => void }) {
  const act = useAct();
  const [v, setV] = useState<Settings>(current);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [unchanged, setUnchanged] = useState(false);

  // Each field names its settings path once; the same path locates the server's objection.
  const field = (path: string) => ({ path, value: getIn(v, path), onChange: (x: unknown) => setV((d) => setIn(d, path, x)) });
  const blankToUndefined = (path: string) => ({ ...field(path), onChange: (x: string) => setV((d) => setIn(d, path, x.trim() ? x : undefined)) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const patch = Object.fromEntries(SECTIONS.filter((k) => JSON.stringify(v[k]) !== JSON.stringify(current[k])).map((k) => [k, v[k]]));
    setUnchanged(Object.keys(patch).length === 0);
    if (!Object.keys(patch).length) return;
    setBusy(true);
    setIssues({});
    const out = await act("update_settings", { patch }, undefined, (found) =>
      setIssues(displayIssues(found.map((i) => ({ ...i, path: i.path.replace(/^patch\.?/, "") })), v)),
    );
    setBusy(false);
    if (out) onDone();
  };

  const trustSource = v.trust?.source;
  return (
    <IssuesContext.Provider value={issues}>
      <form onSubmit={submit} noValidate>
        <p className="muted small">Changes are sent to the Approvals inbox and take effect when a principal approves them.</p>

        <Group title="Firm">
          <TextField label="Firm name" {...field("firmName")} hint='Labels the fees row on the Authority to Settle ("<firm name> fees"), so match the firm form' />
          <TextField label="Address" long {...field("firmAddress")} hint="Printed on court documents, such as the Form 17 inspection address" />
          <TextField label="Time zone" {...field("timezone")} placeholder="Australia/Perth" />
        </Group>

        <Group title="Sign-in">
          <CheckField label="Google" value={v.identity?.providers?.includes("google")} onChange={(on) => setV((d) => setIn(d, "identity.providers", toggle(d.identity?.providers, "google", on)))} path="identity.providers" />
          <CheckField label="Microsoft" value={v.identity?.providers?.includes("microsoft")} onChange={(on) => setV((d) => setIn(d, "identity.providers", toggle(d.identity?.providers, "microsoft", on)))} />
          <ListField label="Allowed email domains" {...field("identity.allowedDomains")} placeholder="firm.com.au" hint="Staff must also be added under Users" />
          <CheckField label="Require multi-factor sign-in" {...field("identity.requireMfaClaim")} hint="Microsoft Entra ID only" />
        </Group>

        <Group title="Privacy officer" hint="Named in the privacy policy and in breach notifications.">
          <TextField label="Name" {...field("privacy.officerName")} />
          <TextField label="Email" {...field("privacy.officerEmail")} />
        </Group>

        <Group title="Letters" hint="The sign-off block on letters drafted on the firm letterhead.">
          <TextField label="Sender name" {...field("letter.senderName")} />
          <TextField label="Sender title" {...field("letter.senderTitle")} />
          <TextField label="Sender email" {...field("letter.senderEmail")} />
          <TextField label="Sender phone" {...field("letter.senderPhone")} />
          <TextField label="Closing" {...field("letter.closing")} placeholder="Yours faithfully" />
          <TextField label="Sign-off text" {...field("letter.signoff")} />
          <TextField label="Sign-off font" {...field("letter.signoffFont")} />
          <NumberField label="Sign-off size" suffix="pt" {...field("letter.signoffSizePt")} />
          <TextField label="Sign-off colour" {...field("letter.signoffColor")} placeholder="000000" hint="Six-digit hex" />
          <TextField label="Accent colour" {...field("letter.accentColor")} placeholder="000000" hint="Six-digit hex" />
        </Group>

        <Group title="Documents">
          <SelectField label="Document store" {...field("documents.store")} options={[["box", "Box"], ["local", "Local (testing only)"]]} />
          <TextField label="Matters root folder id" {...blankToUndefined("documents.mattersRootFolderId")} hint="The Box folder holding the matter folders (the PracticePanther root)" />
          <TextField label="Emails subfolder" {...field("documents.emailsSubfolder")} />
          <TextField label="Generated documents subfolder" {...field("documents.generatedSubfolder")} />
          <TextField label="Label for ICWA matters" {...field("documents.schemeLabels.icwa_mva")} />
          <TextField label="Label for WorkCover matters" {...field("documents.schemeLabels.workcover_wa")} />
          <TextField label="Label for other matters" {...field("documents.schemeLabels.other")} />
        </Group>

        <Group title="Email filing">
          <SelectField label="Mail provider" {...field("mail.provider")} options={[["gmail", "Gmail"], ["graph", "Microsoft 365"], ["none", "None"]]} />
          <SelectField
            label="Filing mode"
            {...field("mail.filingMode")}
            options={[["label_bridge", "Label only (the firm's own automation files)"], ["practy", "Practy files to Box"], ["off", "Off"]]}
          />
          <TextField label="Refile label prefix" {...field("mail.refileLabelPrefix")} />
          <CheckField label="File strong matches automatically" {...field("mail.autoFile")} />
          <NumberField label="Automatic filing cap per run" {...field("mail.autoFileCap")} />
        </Group>

        <Group title="Calendar">
          <SelectField label="Calendar provider" {...field("calendar.provider")} options={[["google", "Google"], ["graph", "Microsoft 365"], ["none", "None"]]} />
          <TextField label="Calendar id" {...field("calendar.calendarId")} placeholder="primary" />
        </Group>

        <Group title="Key date policy" hint="Firm policy, not statute. Changes apply to dates proposed from now on.">
          <NumberField label="ICWA notice target" suffix="days" {...field("firmPolicy.icwaNoticeTargetDays")} />
          <ListField label="Limitation reminders" numbers {...field("firmPolicy.limitationReminderMonths")} placeholder="6, 3, 1" hint="Months before the limitation date" />
        </Group>

        <Group title="AI">
          <CheckField label="AI features on" {...field("ai.enabled")} />
          <SelectField label="Provider" {...field("ai.provider")} options={[["bedrock", "AWS Bedrock (Sydney)"], ["anthropic", "Anthropic API"]]} />
          <TextField label="Model id" {...field("ai.model")} />
          <CheckField label="Allow the firm's own Claude to connect (MCP)" {...field("ai.externalMcpClients")} />
          <SelectField
            label="Most an external client may do"
            value={String(v.ai?.externalClientMaxTier ?? 1)}
            onChange={(x) => setV((d) => setIn(d, "ai.externalClientMaxTier", Number(x)))}
            path="ai.externalClientMaxTier"
            options={[["0", "Read only"], ["1", "Read and draft"], ["2", "Request practitioner approvals"], ["3", "Request trust approvals"]]}
          />
          <ListField label="Allowed client hosts" {...field("ai.externalClientRedirectHosts")} placeholder="claude.ai, claude.com" hint="Removing a host disconnects clients already using it" />
        </Group>

        <Group title="Trust records" hint="The shadow ledger's source. Opening balances are entered under All fields.">
          <SelectField label="Source" {...field("trust.source")} options={[["xero", "Xero"], ["addon_csv", "Trust add-on cashbook export"], ["none", "None"]]} />
          <TextField label="Trust account name" {...field("trust.accountName")} />
          {trustSource === "xero" && (
            <>
              <TextField label="Xero trust bank account id" {...blankToUndefined("trust.trustBankAccountId")} />
              <TextField label="Tracking category" {...blankToUndefined("trust.trackingCategoryName")} placeholder="Matter" />
              <TextField label="Matter number pattern" {...blankToUndefined("trust.referencePattern")} placeholder="\b(\d{3,5})\b" hint="First capture group is the matter number" />
            </>
          )}
          <TextField label="Statement column: date" {...field("trust.statementMapping.date")} />
          <TextField label="Statement column: amount" {...blankToUndefined("trust.statementMapping.amount")} hint="Or use credit and debit" />
          <TextField label="Statement column: credit" {...blankToUndefined("trust.statementMapping.credit")} />
          <TextField label="Statement column: debit" {...blankToUndefined("trust.statementMapping.debit")} />
          <TextField label="Statement column: description" {...field("trust.statementMapping.description")} />
        </Group>

        {unchanged && <div className="notice small">Nothing has changed.</div>}
        {Object.keys(issues).length > 0 && (
          <div className="notice danger small">
            These settings cannot be saved:
            <ul>
              {Object.entries(issues).map(([path, message]) => (
                <li key={path}>
                  {issueLabel(path)}: {message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="modal-actions">
          <button disabled={busy}>{busy ? "Working…" : "Send for approval"}</button>
        </div>
      </form>
    </IssuesContext.Provider>
  );
}

const toggle = (list: string[] | undefined, item: string, on: boolean) => (on ? [...new Set([...(list ?? []), item])] : (list ?? []).filter((x) => x !== item));
