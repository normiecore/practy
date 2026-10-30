import { useState } from "react";
import { ApiError } from "../api";
import { CommandForm } from "../command-form";
import { FormButton } from "./matter";
import { href, Loading, useLoad, useToast, Value } from "../ui";
import { currentSession } from "../api";

const TABS: [string, string][] = [
  ["firm", "Firm"],
  ["users", "Users"],
  ["integrations", "Integrations"],
  ["templates", "Templates"],
  ["import", "Import matters"],
  ["api", "API keys"],
];

const CONNECT: [string, string][] = [
  ["google", "Google (Gmail and Calendar)"],
  ["microsoft", "Microsoft 365 (Outlook and Calendar)"],
  ["xero", "Xero (trust records)"],
  ["practicepanther", "PracticePanther"],
];

export function Settings({ tab = "firm" }: { tab?: string }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Firm configuration. Changes to firm settings and users need practitioner approval.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : undefined} onClick={() => (location.hash = href("settings", k))}>
            {label}
          </button>
        ))}
      </div>
      {tab === "firm" && <Firm />}
      {tab === "users" && <Users />}
      {tab === "integrations" && <Integrations />}
      {tab === "templates" && <Templates />}
      {tab === "import" && <Import />}
      {tab === "api" && <ApiKeys />}
    </>
  );
}

function Firm() {
  const settings = useLoad<Record<string, unknown>>("get_settings", {});
  return (
    <div className="stack">
      <FormButton label="Change settings" name="update_settings" />
      <Loading state={settings}>{() => <Value value={settings.data} />}</Loading>
    </div>
  );
}

function Users() {
  const [inactive, setInactive] = useState(false);
  const users = useLoad("list_users", { includeInactive: inactive });
  return (
    <div className="stack">
      <div className="row">
        <FormButton label="Add or change a user" name="upsert_user" />
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Show inactive
        </label>
      </div>
      <Loading state={users}>{() => <Value value={users.data} />}</Loading>
    </div>
  );
}

function Integrations() {
  const status = useLoad<Record<string, unknown>>("list_integrations", {});
  const connected = new URLSearchParams(location.search).get("connected");
  return (
    <div className="stack">
      {connected && <div className="notice ok">Connected {connected}.</div>}
      <Loading state={status}>{() => <Value value={status.data} />}</Loading>
      <h2>Connect</h2>
      <p className="muted small">Each connection opens the provider's consent screen. Firm-wide systems can only be connected by a principal.</p>
      <div className="row">
        {CONNECT.map(([id, label]) => (
          <a key={id} className="btn secondary" href={`/integrations/connect/${id}`}>
            {label}
          </a>
        ))}
        <FormButton label="Box credentials" secondary name="set_box_credentials" />
        <FormButton label="Sync calendar" secondary name="sync_calendar" />
      </div>
    </div>
  );
}

function Templates() {
  const templates = useLoad("list_templates", {});
  return (
    <div className="stack">
      <p className="muted small">The letterhead and Authority to Settle form are the firm's own documents. They are stored as tenant data, never in the codebase.</p>
      <FormButton label="Upload template" name="upload_template" />
      <Loading state={templates}>{() => <Value value={templates.data} />}</Loading>
    </div>
  );
}

function Import() {
  return (
    <div className="grid">
      <div className="card">
        <h3>From PracticePanther</h3>
        <CommandForm name="import_matters_practicepanther" initial={{ dryRun: true }} submitLabel="Run" />
      </div>
      <div className="card">
        <h3>From CSV</h3>
        <CommandForm name="import_matters_csv" initial={{ dryRun: true }} submitLabel="Run" />
      </div>
    </div>
  );
}

function ApiKeys() {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState<string>();
  const toast = useToast();
  const create = async () => {
    const res = await fetch("/api/keys", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-practy-csrf": currentSession()?.csrf ?? "" },
      body: JSON.stringify({ label: label || "API key" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast(new ApiError(data.error, data.message ?? "Could not create key", res.status).message, true);
    setKey(data.key);
  };
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <p className="muted small">API keys act as you, with your roles, over the REST API. Approvals are still decided in this app.</p>
      <label className="field">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Reporting script" />
      </label>
      <button onClick={() => void create()}>Create key</button>
      {key && (
        <div className="notice warn" style={{ marginTop: "1rem" }}>
          Shown once. Store it securely:
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{key}</pre>
        </div>
      )}
    </div>
  );
}
