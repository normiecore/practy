import { useEffect, useState } from "react";
import { currentSession, listCommands, type CommandInfo } from "../api";
import { Badge, href, Loading, TIER_LABEL, useAct, useLoad, Value } from "../ui";

interface Approval {
  id: string;
  command: string;
  tier: 2 | 3;
  input: Record<string, unknown>;
  matterIds: string[];
  requestedBy: string;
  requestedVia: string;
  requestedAt: string;
  requiredApprovals: number;
  decisions: { userId: string; decision: string; at: string; note?: string }[];
  status: string;
  error?: string;
}

const STATUSES = ["pending", "executed", "rejected", "failed"] as const;

export function Approvals() {
  const [status, setStatus] = useState<string>("pending");
  const approvals = useLoad<Approval[]>("list_approvals", { status });
  const users = useLoad<{ id: string; displayName: string }[]>("list_users", {});
  const [commands, setCommands] = useState<Record<string, CommandInfo>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const act = useAct();
  const me = currentSession()?.user.id;

  useEffect(() => {
    listCommands().then((all) => setCommands(Object.fromEntries(all.map((c) => [c.name, c]))));
  }, []);

  const who = (id: string) => users.data?.find((u) => u.id === id)?.displayName ?? (id === "assistant" ? "Assistant" : id);
  const decide = (a: Approval, decision: "approve" | "reject") =>
    act("decide_approval", { approvalId: a.id, decision, note: notes[a.id] || undefined }, decision === "approve" ? "Approved" : "Rejected");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p className="muted">Legal-risk actions need a practitioner. Trust payments need two trust authorisers. Requests from the assistant and API land here too.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {STATUSES.map((s) => (
          <button key={s} role="tab" aria-selected={status === s} className={status === s ? "active" : undefined} onClick={() => setStatus(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <Loading state={approvals}>
        {() =>
          approvals.data!.length ? (
            <div className="stack">
              {approvals.data!.map((a) => {
                const mine = a.decisions.some((d) => d.userId === me);
                const own = a.requestedBy === me;
                return (
                  <div key={a.id} className="card">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div>
                        <h3 style={{ margin: 0 }}>{commands[a.command]?.title ?? a.command}</h3>
                        <div className="small muted">
                          Requested by {who(a.requestedBy)} via {a.requestedVia} on {new Date(a.requestedAt).toLocaleString("en-AU")}
                          {a.matterIds.map((m) => (
                            <span key={m}>
                              {" · "}
                              <a href={href("matters", m)}>matter</a>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="row">
                        <span className="badge">{TIER_LABEL[a.tier]}</span>
                        <Badge value={a.status} />
                      </div>
                    </div>
                    <div style={{ marginTop: "0.75rem" }}>
                      <Value value={a.input} />
                    </div>
                    {a.decisions.length > 0 && (
                      <p className="small">
                        {a.decisions.map((d) => `${who(d.userId)} ${d.decision === "approve" ? "approved" : "rejected"}${d.note ? `: ${d.note}` : ""}`).join("; ")}
                        {a.status === "pending" && ` (${a.decisions.filter((d) => d.decision === "approve").length} of ${a.requiredApprovals})`}
                      </p>
                    )}
                    {a.error && <div className="notice danger">{a.error}</div>}
                    {a.status === "pending" && !mine && (
                      <div className="row" style={{ marginTop: "0.75rem" }}>
                        <input placeholder="Note (optional)" style={{ maxWidth: 360 }} value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                        <button onClick={() => void decide(a, "approve")}>Approve</button>
                        <button className="danger" onClick={() => void decide(a, "reject")}>
                          Reject
                        </button>
                        {own && <span className="hint">You requested this. The server decides whether you may also approve it.</span>}
                      </div>
                    )}
                    {a.status === "pending" && mine && <p className="hint">You have decided. Waiting for another authoriser.</p>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty">Nothing {status}.</div>
          )
        }
      </Loading>
    </>
  );
}
