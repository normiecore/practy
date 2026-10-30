import { useState } from "react";
import { FormButton } from "./matter";
import { Badge, href, Loading, useAct, useLoad } from "../ui";

interface MailItem {
  id: string;
  subject: string;
  from: string;
  date: string;
  decision: string;
  confidence: number;
  evidence: string[];
  candidates: string[];
  matterId?: string;
  status: string;
  error?: string;
}

const STATUSES = ["review", "misc", "filed", "dismissed", "error"] as const;

export function Filing() {
  const [status, setStatus] = useState<string>("review");
  const queue = useLoad<MailItem[]>("list_filing_queue", { status });
  const matters = useLoad<{ id: string; number: string; title: string }[]>("search_matters", {});
  const [choice, setChoice] = useState<Record<string, string>>({});
  const act = useAct();
  const label = (id: string) => {
    const m = matters.data?.find((x) => x.id === id);
    return m ? `${m.number} ${m.title}` : id;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Email filing</h1>
          <p className="muted">Emails Practy could not file with confidence. Pick the matter, or dismiss.</p>
        </div>
        <FormButton label="Run sweep now" name="run_mail_sweep" />
      </div>
      <div className="tabs" role="tablist">
        {STATUSES.map((s) => (
          <button key={s} role="tab" aria-selected={status === s} className={status === s ? "active" : undefined} onClick={() => setStatus(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <Loading state={queue}>
        {() =>
          queue.data!.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Email</th>
                    <th>Why</th>
                    <th>{status === "filed" ? "Matter" : "File to"}</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.data!.map((i) => {
                    const selected = choice[i.id] ?? i.candidates[0] ?? "";
                    return (
                      <tr key={i.id}>
                        <td className="small">{new Date(i.date).toLocaleString("en-AU")}</td>
                        <td>
                          <strong>{i.subject || "(no subject)"}</strong>
                          <div className="hint">{i.from}</div>
                        </td>
                        <td className="small">
                          {i.evidence.join("; ") || "—"}
                          <div className="hint">Confidence {Math.round(i.confidence * 100)}%</div>
                          {i.error && <Badge value={i.error} tone="danger" />}
                        </td>
                        <td>
                          {i.status === "filed" && i.matterId ? (
                            <a href={href("matters", i.matterId, "documents")}>{label(i.matterId)}</a>
                          ) : (
                            <div className="row">
                              <select value={selected} onChange={(e) => setChoice({ ...choice, [i.id]: e.target.value })} aria-label="Matter" style={{ maxWidth: 260 }}>
                                <option value="">Choose matter…</option>
                                {i.candidates.length > 0 && (
                                  <optgroup label="Suggested">
                                    {i.candidates.map((c) => (
                                      <option key={c} value={c}>
                                        {label(c)}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label="All matters">
                                  {matters.data?.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.number} {m.title}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                              <button disabled={!selected} onClick={() => void act("file_email", { itemId: i.id, matterId: selected }, "Filed")}>
                                File
                              </button>
                              {i.status !== "dismissed" && (
                                <button className="ghost" onClick={() => void act("dismiss_email", { itemId: i.id }, "Dismissed")}>
                                  Dismiss
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">Nothing here.</div>
          )
        }
      </Loading>
    </>
  );
}
