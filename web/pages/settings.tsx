import { useState } from "react";
import { ApiError } from "../api";
import { CommandForm } from "../command-form";
import { FirmSettingsForm } from "./firm-settings-form";
import { DedicatedFormButton, FormButton, SectionTabs } from "./matter";
import { Badge, href, Loading, useAct, useLoad, useToast, Value } from "../ui";
import { currentSession } from "../api";

const TABS: [string, string][] = [
  ["firm", "Firm"],
  ["users", "Users"],
  ["integrations", "Integrations"],
  ["templates", "Templates"],
  ["import", "Import matters"],
  ["api", "API keys"],
  ["sessions", "Sign-in sessions"],
];

/** Local date and time, such as "31 Oct 2026, 5:20 pm". */
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Never");
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
      <SectionTabs tabs={TABS} current={tab} onSelect={(k) => (location.hash = href("settings", k))} />
      {tab === "firm" && <Firm />}
      {tab === "users" && <Users />}
      {tab === "integrations" && <Integrations />}
      {tab === "templates" && <Templates />}
      {tab === "import" && <Import />}
      {tab === "api" && <ApiKeys />}
      {tab === "sessions" && <Sessions />}
    </>
  );
}

function Firm() {
  const settings = useLoad<Record<string, any>>("get_settings", {});
  return (
    <div className="stack">
      <div className="row">
        <DedicatedFormButton
          label="Edit settings"
          title="Firm settings"
          wide
          disabled={!settings.data}
          name="update_settings"
          render={(close) => <FirmSettingsForm current={settings.data!} onDone={close} />}
        />
      </div>
      <Loading state={settings}>{() => <Value value={settings.data} />}</Loading>
    </div>
  );
}

interface StaffUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  feeEarnerCategory?: string;
  active: boolean;
  lastLoginAt?: string;
}

interface AccessRevoked {
  displayName: string;
  sessionsEnded: number;
  aiClientsDisconnected: number;
  apiKeysRevoked: number;
}

function revokedMessage(r: AccessRevoked): string {
  const parts = [
    r.sessionsEnded && `${count(r.sessionsEnded, "session")} ended`,
    r.aiClientsDisconnected && `${count(r.aiClientsDisconnected, "AI client")} disconnected`,
    r.apiKeysRevoked && `${count(r.apiKeysRevoked, "API key")} revoked`,
  ].filter(Boolean);
  return parts.length ? `Signed ${r.displayName} out everywhere: ${parts.join(", ")}` : `${r.displayName} was not signed in anywhere`;
}

function Users() {
  const [inactive, setInactive] = useState(false);
  const users = useLoad<StaffUser[]>("list_users", { includeInactive: inactive });
  const me = currentSession()?.user;
  // Only a principal can sign someone else out; the server checks this too.
  const principal = !!me?.roles.includes("principal");
  const act = useAct();
  const toast = useToast();
  const signOutEverywhere = async (u: StaffUser) => {
    const out = await act<AccessRevoked>("end_user_sessions", { userId: u.id });
    if (out?.status === "executed") toast(revokedMessage(out.result));
  };
  return (
    <div className="stack">
      <div className="row">
        <FormButton label="Add or change a user" name="upsert_user" />
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Show inactive
        </label>
      </div>
      {principal && (
        <p className="muted small">
          Sign out everywhere ends all of that person's sign-in sessions, disconnects AI clients they connected and revokes their API keys: use it for a lost phone or when
          someone leaves. They can sign in again unless you also make them inactive (which signs them out everywhere too). For a lost or stolen phone this is not enough
          on its own: the phone is still signed in to the firm's Google or Microsoft account and can sign straight back in, so also sign the person out there or reset their
          password.
        </p>
      )}
      <Loading state={users}>
        {() =>
          users.data!.length ? (
            <div className="table-wrap">
              <table className="card-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Roles</th>
                    <th>Fee earner</th>
                    <th>Active</th>
                    <th>Last sign-in</th>
                    {principal && <th />}
                  </tr>
                </thead>
                <tbody>
                  {users.data!.map((u) => (
                    <tr key={u.id}>
                      <td data-label="Name" className="primary">
                        {u.displayName}
                      </td>
                      <td data-label="Email">{u.email}</td>
                      <td data-label="Roles">{u.roles.map((r) => r.replace(/_/g, " ")).join(", ")}</td>
                      <td data-label="Fee earner">{u.feeEarnerCategory ?? <span className="muted">None</span>}</td>
                      <td data-label="Active">{u.active ? "Yes" : <Badge value="inactive" tone="warn" />}</td>
                      <td data-label="Last sign-in">{when(u.lastLoginAt)}</td>
                      {principal && (
                        <td data-label="Actions" className="actions">
                          {u.id !== me?.id && (
                            <button className="secondary" aria-label={`Sign out everywhere (${u.displayName})`} onClick={() => void signOutEverywhere(u)}>
                              Sign out everywhere
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No users.</div>
          )
        }
      </Loading>
    </div>
  );
}

interface SignInSession {
  id: string;
  device: string;
  location: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

/** The signed-in person's own sessions, so a lost phone or a shared computer can be cut off. */
function Sessions() {
  const sessions = useLoad<SignInSession[]>("list_my_sessions", {});
  const act = useAct();
  const toast = useToast();
  const others = sessions.data?.filter((s) => !s.current).length ?? 0;
  const endOthers = async () => {
    const out = await act<{ ended: number }>("end_other_sessions", {});
    if (out?.status === "executed") toast(out.result.ended ? `Signed out ${count(out.result.ended, "other device")}` : "No other devices were signed in");
  };
  return (
    <div className="stack">
      <p className="muted small">
        Each browser or phone you sign in on has its own session. If a device is lost, or you signed in on a shared computer, end its session here: it is signed out the
        next time it does anything. Locations are approximate: the network the device signed in from, with the last part of the address removed.
      </p>
      <p className="muted small">
        If a phone is lost or stolen, tell a principal as well: ending the session here does not sign the phone out of the firm's Google or Microsoft account, so it could
        sign straight back in until the firm signs you out there too.
      </p>
      <div className="row">
        <button className="secondary" disabled={!others} onClick={() => void endOthers()}>
          Sign out all other devices
        </button>
      </div>
      <Loading state={sessions}>
        {() =>
          sessions.data!.length ? (
            <div className="table-wrap">
              <table className="card-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Approximate location</th>
                    <th>Signed in</th>
                    <th>Last active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sessions.data!.map((s) => (
                    <tr key={s.id}>
                      <td data-label="Device" className="primary">
                        {s.device} {s.current && <Badge value="This device" tone="info" />}
                      </td>
                      <td data-label="Location">{s.location ?? <span className="muted">Unknown</span>}</td>
                      <td data-label="Signed in">{when(s.createdAt)}</td>
                      <td data-label="Last active">{when(s.lastSeenAt)}</td>
                      <td data-label="Actions" className="actions">
                        {s.current ? (
                          // Ending this device's session is the normal Sign out, never a tap in this list.
                          <span className="hint">To end this one, use Sign out.</span>
                        ) : (
                          <button className="secondary" aria-label={`End session on ${s.device}`} onClick={() => void act("end_session", { sessionId: s.id }, "Session ended")}>
                            End
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No active sessions.</div>
          )
        }
      </Loading>
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
