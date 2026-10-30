import { useEffect, useState, type ReactNode } from "react";
import { date, listCommands, money, SCHEME_LABEL, type CommandInfo } from "../api";
import { CommandForm, type CommandFormProps } from "../command-form";
import { Badge, href, Loading, Modal, TIER_LABEL, useAct, useLoad, Value } from "../ui";

const TABS: [string, string][] = [
  ["overview", "Overview"],
  ["dates", "Key dates"],
  ["tasks", "Tasks"],
  ["notes", "File notes"],
  ["evidence", "Evidence requests"],
  ["documents", "Documents"],
  ["chronology", "Chronology"],
  ["damages", "Damages"],
  ["settlement", "Settlement"],
  ["time", "Time and costs"],
  ["trust", "Trust"],
  ["actions", "All actions"],
];

/** A button that opens a generated command form in a dialog. */
export function FormButton({ label, secondary, ...form }: CommandFormProps & { label: string; secondary?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={secondary ? "secondary" : undefined} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <Modal title={label} onClose={() => setOpen(false)}>
          <CommandForm
            {...form}
            onDone={(out) => {
              setOpen(false);
              form.onDone?.(out);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between", marginTop: "1rem" }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div className="row">{actions}</div>
      </div>
      <div style={{ marginTop: "0.6rem" }}>{children}</div>
    </section>
  );
}

interface MatterDetail {
  id: string;
  number: string;
  title: string;
  scheme: string;
  status: string;
  injuryDate?: string;
  openedOn: string;
  closedOn?: string;
  aiPermitted: boolean;
  references?: string[];
  links: { boxFolderId?: string };
  legalHold?: { on: boolean; reason: string };
  amlScreening?: { designatedService: boolean; screenedAt: string };
  parties: { partyId: string; role: string; party?: { name: string; kind: string; email?: string; phone?: string; dateOfBirth?: string } }[];
}

export function MatterWorkspace({ id, tab = "overview" }: { id: string; tab?: string }) {
  const matter = useLoad<MatterDetail>("get_matter", { matterId: id });
  return (
    <Loading state={matter}>
      {() => {
        const m = matter.data!;
        return (
          <>
            <div className="page-head">
              <div>
                <p className="small muted">
                  <a href={href("matters")}>Matters</a> / {m.number}
                </p>
                <h1>{m.title}</h1>
                <div className="row small">
                  <Badge value={m.status} />
                  <span className="badge">{SCHEME_LABEL[m.scheme] ?? m.scheme}</span>
                  {!m.aiPermitted && <Badge value="AI not permitted" tone="warn" />}
                  {m.legalHold?.on && <Badge value="legal hold" tone="danger" />}
                </div>
              </div>
            </div>
            <div className="tabs" role="tablist">
              {TABS.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : undefined} onClick={() => (location.hash = href("matters", id, k))}>
                  {label}
                </button>
              ))}
            </div>
            <MatterTab m={m} tab={tab} />
          </>
        );
      }}
    </Loading>
  );
}

function MatterTab({ m, tab }: { m: MatterDetail; tab: string }) {
  const fixed = { matterId: m.id };
  switch (tab) {
    case "overview":
      return <Overview m={m} />;
    case "dates":
      return <KeyDates matterId={m.id} />;
    case "tasks":
      return <Tasks matterId={m.id} />;
    case "notes":
      return (
        <ListSection title="File notes" list="list_file_notes" fixed={fixed}>
          <FormButton label="Add file note" name="add_file_note" fixed={fixed} />
        </ListSection>
      );
    case "evidence":
      return <Evidence matterId={m.id} />;
    case "documents":
      return <Documents matterId={m.id} />;
    case "chronology":
      return <Chronology matterId={m.id} />;
    case "damages":
      return <Damages matterId={m.id} />;
    case "settlement":
      return <Settlement m={m} />;
    case "time":
      return <Time matterId={m.id} />;
    case "trust":
      return <MatterTrust matterId={m.id} />;
    case "actions":
      return <AllActions matterId={m.id} />;
    default:
      return <div className="empty">Unknown tab</div>;
  }
}

function ListSection({ title, list, fixed, input = {}, children }: { title: string; list: string; fixed: Record<string, unknown>; input?: object; children?: ReactNode }) {
  const data = useLoad(list, { ...fixed, ...input });
  return (
    <Section title={title} actions={children}>
      <Loading state={data}>{() => <Value value={data.data} />}</Loading>
    </Section>
  );
}

// ------------------------------------------------------------ overview

function Overview({ m }: { m: MatterDetail }) {
  const fixed = { matterId: m.id };
  return (
    <div className="stack">
      <div className="grid">
        <div className="card">
          <h3>Details</h3>
          <dl className="kv">
            <dt>Matter no.</dt>
            <dd>{m.number}</dd>
            <dt>Injury date</dt>
            <dd>{date(m.injuryDate)}</dd>
            <dt>Opened</dt>
            <dd>{date(m.openedOn)}</dd>
            {m.closedOn && (
              <>
                <dt>Closed</dt>
                <dd>{date(m.closedOn)}</dd>
              </>
            )}
            <dt>References</dt>
            <dd>{m.references?.length ? m.references.join(", ") : "—"}</dd>
            <dt>Box folder</dt>
            <dd>{m.links.boxFolderId ?? "—"}</dd>
          </dl>
        </div>
        <div className="card">
          <h3>Controls</h3>
          <dl className="kv">
            <dt>AI processing</dt>
            <dd>{m.aiPermitted ? "Client consented" : "Not permitted: hidden from AI"}</dd>
            <dt>Legal hold</dt>
            <dd>{m.legalHold?.on ? `On: ${m.legalHold.reason}` : "Off"}</dd>
            <dt>AML screening</dt>
            <dd>{m.amlScreening ? `${m.amlScreening.designatedService ? "Designated service" : "Not a designated service"} (${date(m.amlScreening.screenedAt)})` : "Not screened"}</dd>
          </dl>
        </div>
      </div>
      <div className="row">
        <FormButton
          label="Edit matter"
          secondary
          name="update_matter"
          fixed={fixed}
          initial={{ title: m.title, status: m.status, references: m.references ?? [], boxFolderId: m.links.boxFolderId }}
        />
        <FormButton label="Record event" secondary name="record_matter_event" fixed={fixed} />
        <FormButton label="AI permission" secondary name="set_matter_ai_permission" fixed={fixed} initial={{ aiPermitted: m.aiPermitted }} />
        <FormButton label="Legal hold" secondary name="set_legal_hold" fixed={fixed} initial={{ on: !m.legalHold?.on }} />
        <FormButton label="AML screening" secondary name="aml_screen_matter" fixed={fixed} />
      </div>
      <Section title="Parties" actions={<FormButton label="Add party" name="add_party" fixed={fixed} />}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {m.parties.map((p) => (
                <tr key={p.partyId}>
                  <td>
                    <Badge value={p.role} />
                  </td>
                  <td>{p.party?.name ?? "—"}</td>
                  <td>{p.party?.email ?? "—"}</td>
                  <td>{p.party?.phone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------ key dates

interface KeyDate {
  id: string;
  title: string;
  date: string | null;
  kind: string;
  status: string;
  ruleVerified: boolean;
  source: string;
  notes: string[];
}

function KeyDates({ matterId }: { matterId: string }) {
  const dates = useLoad<KeyDate[]>("list_key_dates", { matterId });
  const act = useAct();
  return (
    <Section title="Key dates" actions={<FormButton label="Add or change a date" name="propose_key_date" fixed={{ matterId }} />}>
      <p className="muted small">Dates proposed by the rule pack need a practitioner to confirm them. Unverified rules never produce a date on their own.</p>
      <Loading state={dates}>
        {() =>
          dates.data!.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Key date</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dates.data!.map((k) => (
                    <tr key={k.id}>
                      <td>{k.date ? date(k.date) : <Badge value="needs entry" tone="danger" />}</td>
                      <td>
                        {k.title} {k.kind === "critical" && <Badge value="critical" />}
                        {k.notes.map((n, i) => (
                          <div key={i} className="hint">
                            {n}
                          </div>
                        ))}
                      </td>
                      <td className="small">
                        {k.source}
                        {!k.ruleVerified && (
                          <div>
                            <Badge value="rule unverified" tone="warn" />
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge value={k.status} />
                      </td>
                      <td>
                        <div className="row" style={{ flexWrap: "nowrap" }}>
                          {k.status === "proposed" && k.date && (
                            <button className="secondary" onClick={() => void act("confirm_key_date", { matterId, keyDateId: k.id })}>
                              Confirm
                            </button>
                          )}
                          <FormButton
                            label="Edit"
                            secondary
                            name="propose_key_date"
                            fixed={{ matterId, keyDateId: k.id }}
                            initial={{ title: k.title, date: k.date ?? undefined, kind: k.kind }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No key dates.</div>
          )
        }
      </Loading>
    </Section>
  );
}

// ------------------------------------------------------------ tasks

function Tasks({ matterId }: { matterId: string }) {
  const [includeDone, setIncludeDone] = useState(false);
  const tasks = useLoad<{ id: string; title: string; detail?: string; dueOn?: string; status: string; source: string }[]>("list_tasks", { matterId, includeDone });
  const act = useAct();
  return (
    <Section title="Tasks" actions={<FormButton label="New task" name="create_task" fixed={{ matterId }} />}>
      <label className="check">
        <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} /> Show completed
      </label>
      <Loading state={tasks}>
        {() =>
          tasks.data!.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Due</th>
                    <th>Task</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tasks.data!.map((t) => (
                    <tr key={t.id}>
                      <td>{date(t.dueOn)}</td>
                      <td>
                        {t.title}
                        {t.detail && <div className="hint">{t.detail}</div>}
                        {t.source !== "manual" && <span className="badge">{t.source.replace(/_/g, " ")}</span>}
                      </td>
                      <td>
                        <Badge value={t.status} />
                      </td>
                      <td>
                        {t.status === "open" ? (
                          <button className="secondary" onClick={() => void act("update_task", { taskId: t.id, status: "done" }, "Task completed")}>
                            Done
                          </button>
                        ) : (
                          <button className="ghost" onClick={() => void act("update_task", { taskId: t.id, status: "open" })}>
                            Reopen
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No tasks.</div>
          )
        }
      </Loading>
    </Section>
  );
}

// ------------------------------------------------------------ evidence requests

function Evidence({ matterId }: { matterId: string }) {
  const reqs = useLoad<{ id: string; kind: string; provider: string; description: string; requestedOn: string; chaseOn: string[]; status: string; receivedOn?: string }[]>(
    "list_evidence_requests",
    { matterId },
  );
  return (
    <Section title="Evidence requests" actions={<FormButton label="Log request" name="log_evidence_request" fixed={{ matterId }} />}>
      <p className="muted small">Each request creates chase-up tasks until it is marked received.</p>
      <Loading state={reqs}>
        {() =>
          reqs.data!.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Requested</th>
                    <th>Provider</th>
                    <th>What</th>
                    <th>Chase</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reqs.data!.map((r) => (
                    <tr key={r.id}>
                      <td>{date(r.requestedOn)}</td>
                      <td>{r.provider}</td>
                      <td>
                        <span className="badge">{r.kind.replace(/_/g, " ")}</span> {r.description}
                      </td>
                      <td className="small">{r.status === "requested" ? r.chaseOn.map(date).join(", ") : "—"}</td>
                      <td>
                        <Badge value={r.status} /> {r.receivedOn && <span className="small muted">{date(r.receivedOn)}</span>}
                      </td>
                      <td>
                        {r.status === "requested" && <FormButton label="Received" secondary name="mark_evidence_received" fixed={{ matterId, requestId: r.id }} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No evidence requests.</div>
          )
        }
      </Loading>
    </Section>
  );
}

// ------------------------------------------------------------ documents

interface Doc {
  id: string;
  name: string;
  contentType: string;
  size: number;
  docDate?: string;
  category?: string;
  source: string;
  evidence?: boolean;
  aiExcluded?: boolean;
  aiExcludedReason?: string;
}

function Documents({ matterId }: { matterId: string }) {
  const docs = useLoad<Doc[]>("list_documents", { matterId });
  const act = useAct();
  const fixed = { matterId };
  return (
    <div className="stack">
      <div className="row">
        <FormButton label="Upload" name="upload_document" fixed={fixed} />
        <FormButton label="Sync from Box" secondary name="sync_matter_documents" fixed={fixed} />
        <FormButton label="Letter" secondary name="generate_letter" fixed={fixed} />
        <FormButton label="From template" secondary name="generate_from_template" fixed={fixed} />
        <FormButton label="Form 17 list" secondary name="generate_list_of_documents" fixed={fixed} />
        <FormButton label="Court book" secondary name="build_court_book" fixed={fixed} />
        <FormButton label="Send email" secondary name="send_email" fixed={fixed} />
      </div>
      <Loading state={docs}>
        {() =>
          docs.data!.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Flags</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {docs.data!.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <a href={`/api/matters/${encodeURIComponent(matterId)}/documents/${encodeURIComponent(d.id)}/download`}>{d.name}</a>
                        <div className="hint">
                          {d.source} · {(d.size / 1024).toFixed(0)} KB
                        </div>
                      </td>
                      <td>{date(d.docDate)}</td>
                      <td>{d.category ?? "—"}</td>
                      <td>
                        {d.evidence && <Badge value="evidence" tone="info" />} {d.aiExcluded && <Badge value="no AI" tone="warn" />}
                      </td>
                      <td>
                        <div className="row">
                          {d.contentType === "application/pdf" && (
                            <button className="ghost" onClick={() => void act("build_chronology", { matterId, documentId: d.id }, "Chronology extracted: review it on the Chronology tab")}>
                              Chronology
                            </button>
                          )}
                          {/wordprocessingml/.test(d.contentType) && (
                            <button className="ghost" onClick={() => void act("remove_tracked_changes", { matterId, documentId: d.id }, "Static markup copy saved")}>
                              Static markup
                            </button>
                          )}
                          <button className="ghost" onClick={() => void act("mark_evidence_document", { matterId, documentId: d.id, evidence: !d.evidence })}>
                            {d.evidence ? "Not evidence" : "Mark evidence"}
                          </button>
                          {d.aiExcluded ? (
                            <button className="ghost" onClick={() => void act("clear_document_ai_restriction", { matterId, documentId: d.id })}>
                              Allow AI
                            </button>
                          ) : (
                            <FormButton label="Exclude from AI" secondary name="restrict_document_ai" fixed={{ matterId, documentId: d.id }} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No documents yet.</div>
          )
        }
      </Loading>
    </div>
  );
}

// ------------------------------------------------------------ chronology

interface ChronEvent {
  id: string;
  date: string | null;
  dateText: string;
  provider: string;
  eventType: string;
  summary: string;
  diagnoses: string[];
  wpiPercent: number | null;
  documentId: string;
  documentName: string;
  page: number;
  quote: string;
  verification: string;
  reviewStatus: string;
}

function Chronology({ matterId }: { matterId: string }) {
  const [includeRejected, setIncludeRejected] = useState(false);
  const events = useLoad<ChronEvent[]>("get_chronology", { matterId, includeRejected });
  const act = useAct();
  return (
    <Section title="Medical chronology">
      <p className="muted small">Extracted from PDFs on the Documents tab. Each event cites a page and quote; check unverified quotes against the source before relying on them.</p>
      <label className="check">
        <input type="checkbox" checked={includeRejected} onChange={(e) => setIncludeRejected(e.target.checked)} /> Show rejected
      </label>
      <Loading state={events}>
        {() =>
          events.data!.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Provider</th>
                    <th>Event</th>
                    <th>Source</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {events.data!.map((e) => (
                    <tr key={e.id}>
                      <td>{e.date ? date(e.date) : e.dateText}</td>
                      <td>{e.provider}</td>
                      <td>
                        <span className="badge">{e.eventType}</span> {e.summary}
                        {e.diagnoses.length > 0 && <div className="hint">Diagnoses: {e.diagnoses.join("; ")}</div>}
                        {e.wpiPercent !== null && <div className="hint">WPI {e.wpiPercent}%</div>}
                      </td>
                      <td className="small">
                        <a href={`/api/matters/${encodeURIComponent(matterId)}/documents/${encodeURIComponent(e.documentId)}/download#page=${e.page}`}>
                          {e.documentName} p.{e.page}
                        </a>
                        <div className="hint">“{e.quote}”</div>
                        {e.verification !== "verified" && <Badge value={e.verification} tone="warn" />}
                      </td>
                      <td>
                        <Badge value={e.reviewStatus} tone={e.reviewStatus === "accepted" || e.reviewStatus === "edited" ? "ok" : e.reviewStatus === "rejected" ? "danger" : "warn"} />
                        {e.reviewStatus === "unreviewed" && (
                          <div className="row" style={{ marginTop: "0.3rem" }}>
                            <button className="secondary" onClick={() => void act("review_chronology_event", { matterId, eventId: e.id, decision: "accepted" })}>
                              Accept
                            </button>
                            <button className="ghost" onClick={() => void act("review_chronology_event", { matterId, eventId: e.id, decision: "rejected" })}>
                              Reject
                            </button>
                          </div>
                        )}
                        <FormButton
                          label="Correct"
                          secondary
                          name="review_chronology_event"
                          fixed={{ matterId, eventId: e.id, decision: "edited" }}
                          initial={{ changes: { date: e.date ?? undefined, summary: e.summary, provider: e.provider, diagnoses: e.diagnoses, wpiPercent: e.wpiPercent ?? undefined } }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No chronology yet. Use “Chronology” on a PDF in Documents.</div>
          )
        }
      </Loading>
    </Section>
  );
}

// ------------------------------------------------------------ damages

interface StoredDamages {
  version: number;
  createdAt: string;
  input: Record<string, unknown>;
  note?: string;
  audit: { level?: string; message: string }[];
  model: {
    summary: { lines: { id: string; title: string; amountCents: number }[]; totalCents: number; netCents: number; refundable: { totalCents: number }; statement: string };
    flags: { level?: string; message: string }[];
  };
}

function Damages({ matterId }: { matterId: string }) {
  const dmg = useLoad<StoredDamages>("get_damages", { matterId });
  const fixed = { matterId };
  const missing = dmg.error && /not found/i.test(dmg.error);
  return (
    <div className="stack">
      <div className="row">
        <FormButton label={dmg.data ? "New version" : "Compute damages"} name="compute_damages" fixed={fixed} initial={dmg.data ? withoutMatter(dmg.data.input) : undefined} />
        {dmg.data && <FormButton label="Particulars (docx)" secondary name="generate_particulars" fixed={fixed} initial={{ version: dmg.data.version }} />}
        <FormButton label="Centrelink preclusion" secondary name="estimate_centrelink_preclusion" fixed={fixed} />
      </div>
      {missing ? (
        <div className="empty">No damages model yet.</div>
      ) : (
        <Loading state={dmg}>
          {() => {
            const d = dmg.data!;
            const notes = [...d.model.flags, ...d.audit];
            return (
              <>
                <p className="muted small">
                  Version {d.version}, {date(d.createdAt)}. Draft figures for practitioner review.
                  {d.note && ` ${d.note}`}
                </p>
                {notes.length > 0 && (
                  <div className="notice warn">
                    {notes.map((f, i) => (
                      <div key={i}>{f.message}</div>
                    ))}
                  </div>
                )}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Head</th>
                        <th>Item</th>
                        <th className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.model.summary.lines.map((l) => (
                        <tr key={l.id}>
                          <td>{l.id}</td>
                          <td>{l.title}</td>
                          <td className="num">{money(l.amountCents)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td />
                        <th>Total</th>
                        <th className="num">{money(d.model.summary.totalCents)}</th>
                      </tr>
                      <tr>
                        <td />
                        <td>Less refundable to insurer</td>
                        <td className="num">({money(d.model.summary.refundable.totalCents)})</td>
                      </tr>
                      <tr>
                        <td />
                        <th>Net</th>
                        <th className="num">{money(d.model.summary.netCents)}</th>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {d.model.summary.statement && <p className="small">{d.model.summary.statement}</p>}
              </>
            );
          }}
        </Loading>
      )}
    </div>
  );
}

const withoutMatter = (input: Record<string, unknown>) => {
  const { matterId: _m, ...rest } = input;
  return rest;
};

// ------------------------------------------------------------ settlement

function Settlement({ m }: { m: MatterDetail }) {
  const fixed = { matterId: m.id };
  const [authority, setAuthority] = useState<{ id: string; version: number; result: Record<string, unknown>; statement: unknown }>();
  const clearances = useLoad("list_clearances", fixed);
  const client = m.parties.find((p) => p.role === "client")?.party?.name;
  return (
    <div className="stack">
      <Section
        title="Authority to Settle"
        actions={
          <>
            <FormButton
              label="Compute"
              name="compute_authority_to_settle"
              fixed={fixed}
              initial={{ clientName: client, injuryDate: m.injuryDate }}
              doneMessage={false}
              onDone={(out) => out.status === "executed" && setAuthority(out.result as never)}
            />
            {authority && <FormButton label="Generate document" secondary name="generate_authority_document" fixed={{ ...fixed, draftId: authority.id }} />}
          </>
        }
      >
        {authority ? (
          <div className="grid">
            <div className="card">
              <h3>Figures (version {authority.version})</h3>
              <Value value={Object.fromEntries(Object.entries(authority.result).filter(([k]) => /Cents$/.test(k)))} />
            </div>
            <div className="card">
              <h3>Settlement statement</h3>
              <Value value={authority.statement} />
            </div>
          </div>
        ) : (
          <p className="muted">Compute the figures from the offer and deductions, then generate the firm's form for approval.</p>
        )}
      </Section>
      <Section title="Clearances" actions={<FormButton label="Record clearance event" name="record_clearance" fixed={fixed} />}>
        <p className="muted small">Medicare, Centrelink, NDIS and other recoveries that must be cleared before funds are released.</p>
        <Loading state={clearances}>{() => <Value value={clearances.data} />}</Loading>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------ time and costs

function Time({ matterId }: { matterId: string }) {
  const entries = useLoad<{ id: string; status: string }[]>("list_time_entries", { matterId });
  const summary = useLoad("timesheet_summary", { matterId });
  const act = useAct();
  const proposed = entries.data?.filter((e) => e.status === "proposed").map((e) => e.id) ?? [];
  const fixed = { matterId };
  return (
    <div className="stack">
      <div className="row">
        <FormButton label="Record time" name="propose_time_entry" fixed={fixed} />
        {proposed.length > 0 && (
          <button className="secondary" onClick={() => void act("approve_time_entries", { matterId, entryIds: proposed })}>
            Approve {proposed.length} proposed
          </button>
        )}
        <FormButton label="Costs disclosure check" secondary name="check_costs_disclosure" fixed={fixed} />
      </div>
      <Section title="Summary">
        <Loading state={summary}>{() => <Value value={summary.data} />}</Loading>
      </Section>
      <Section title="Entries">
        <Loading state={entries}>{() => <Value value={entries.data} />}</Loading>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------ trust

function MatterTrust({ matterId }: { matterId: string }) {
  const balance = useLoad("get_trust_balance", { matterId });
  return (
    <Section title="Trust" actions={<FormButton label="Request payment" name="prepare_trust_payment" fixed={{ matterId }} />}>
      <p className="muted small">Shadow ledger from the firm's trust records. Payments need two trust authorisers.</p>
      <Loading state={balance}>{() => <Value value={balance.data} />}</Loading>
    </Section>
  );
}

// ------------------------------------------------------------ every matter-scoped command

function AllActions({ matterId }: { matterId: string }) {
  const [cmds, setCmds] = useState<CommandInfo[]>();
  const [open, setOpen] = useState<CommandInfo>();
  useEffect(() => {
    listCommands().then((all) => setCmds(all.filter((c) => c.inputSchema?.properties?.matterId && !c.humanOnly)));
  }, []);
  if (!cmds) return <p className="muted">Loading…</p>;
  return (
    <>
      <p className="muted small">Everything Practy can do on this matter. The assistant and MCP clients use the same commands.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>What it does</th>
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            {cmds.map((c) => (
              <tr key={c.name}>
                <td>
                  <button className="ghost" onClick={() => setOpen(c)}>
                    {c.title}
                  </button>
                </td>
                <td className="small">{c.description}</td>
                <td className="small">{TIER_LABEL[c.tier]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal title={open.title} onClose={() => setOpen(undefined)}>
          <CommandForm name={open.name} fixed={{ matterId }} />
        </Modal>
      )}
    </>
  );
}
