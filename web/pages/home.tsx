import { date } from "../api";
import { Badge, href, Loading, useLoad } from "../ui";

interface DigestDate {
  id: string;
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  title: string;
  date: string | null;
  kind: string;
  status: string;
}

interface Digest {
  overdue: DigestDate[];
  upcoming: DigestDate[];
  needsAttention: DigestDate[];
  approvalsPending: number;
  tasksDue: { id: string; title: string; dueOn: string; matterId?: string }[];
  emailsToReview: number;
}

export function DateTable({ rows, empty }: { rows: DigestDate[]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="card-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Matter</th>
            <th>Key date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k.id}>
              <td data-label="Date">{date(k.date)}</td>
              <td data-label="Matter">
                <a href={href("matters", k.matterId, "dates")}>{k.matterNumber}</a> <span className="muted small">{k.matterTitle}</span>
              </td>
              <td data-label="Key date" className="primary">
                {k.title} {k.kind === "critical" && <Badge value="critical" />}
              </td>
              <td data-label="Status">
                <Badge value={k.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Home() {
  const digest = useLoad<Digest>("daily_digest", { days: 14 });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Today</h1>
          <p className="muted">Key dates, tasks and items waiting on you over the next 14 days.</p>
        </div>
      </div>
      <Loading state={digest}>
        {() => {
          const d = digest.data!;
          return (
            <div className="stack">
              <div className="grid">
                <a className="card" href={href("approvals")}>
                  <div className="muted small">Approvals waiting</div>
                  <div className="stat">{d.approvalsPending}</div>
                </a>
                <a className="card" href={href("filing")}>
                  <div className="muted small">Emails to review</div>
                  <div className="stat">{d.emailsToReview}</div>
                </a>
                <div className="card">
                  <div className="muted small">Overdue key dates</div>
                  <div className="stat" style={{ color: d.overdue.length ? "var(--danger)" : undefined }}>
                    {d.overdue.length}
                  </div>
                </div>
                <div className="card">
                  <div className="muted small">Dates needing confirmation</div>
                  <div className="stat">{d.needsAttention.length}</div>
                </div>
              </div>
              {d.overdue.length > 0 && (
                <section>
                  <h2>Overdue</h2>
                  <DateTable rows={d.overdue} empty="" />
                </section>
              )}
              <section>
                <h2>Coming up</h2>
                <DateTable rows={d.upcoming} empty="Nothing in the next 14 days." />
              </section>
              <section>
                <h2>My tasks</h2>
                {d.tasksDue.length ? (
                  <ul>
                    {d.tasksDue.map((t) => (
                      <li key={t.id}>
                        {date(t.dueOn)}: {t.matterId ? <a href={href("matters", t.matterId, "tasks")}>{t.title}</a> : t.title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No tasks due.</p>
                )}
              </section>
              <section>
                <h2>Proposed dates to confirm</h2>
                <p className="muted small">Dates computed by the rule pack stay proposed until a practitioner confirms them.</p>
                <DateTable rows={d.needsAttention} empty="All key dates are confirmed." />
              </section>
            </div>
          );
        }}
      </Loading>
    </>
  );
}
