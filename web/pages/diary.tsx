import { useState } from "react";
import { date } from "../api";
import { FormButton } from "./matter";
import { Badge, href, Loading, useAct, useLoad } from "../ui";

interface Row {
  id: string;
  matterId: string;
  title: string;
  date: string | null;
  kind: string;
  status: string;
}

export function Diary() {
  const [days, setDays] = useState(90);
  const dates = useLoad<Row[]>("list_key_dates", { withinDays: days });
  const matters = useLoad<{ id: string; number: string; title: string }[]>("search_matters", {});
  const tasks = useLoad<{ id: string; title: string; dueOn?: string; matterId?: string; status: string }[]>("list_tasks", { mine: true });
  const act = useAct();
  const matter = (id: string) => matters.data?.find((m) => m.id === id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Diary</h1>
          <p className="muted">Key dates across every matter you can see, and your tasks.</p>
        </div>
        <div className="row">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Horizon">
            {[30, 90, 180, 365, 1095].map((d) => (
              <option key={d} value={d}>
                Next {d} days
              </option>
            ))}
          </select>
          <FormButton label="Sync to calendar" secondary name="sync_calendar" />
        </div>
      </div>
      <h2>Key dates</h2>
      <Loading state={dates}>
        {() =>
          dates.data!.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Matter</th>
                    <th>Key date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dates.data!.map((k) => (
                    <tr key={k.id} style={k.date && k.date < today ? { background: "var(--danger-soft)" } : undefined}>
                      <td>{k.date ? date(k.date) : <Badge value="needs entry" tone="danger" />}</td>
                      <td>
                        <a href={href("matters", k.matterId, "dates")}>{matter(k.matterId)?.number ?? "Matter"}</a>{" "}
                        <span className="small muted">{matter(k.matterId)?.title}</span>
                      </td>
                      <td>
                        {k.title} {k.kind === "critical" && <Badge value="critical" />}
                      </td>
                      <td>
                        <Badge value={k.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No key dates in this period.</div>
          )
        }
      </Loading>
      <h2>My open tasks</h2>
      <Loading state={tasks}>
        {() =>
          tasks.data!.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Due</th>
                    <th>Task</th>
                    <th>Matter</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tasks.data!.map((t) => (
                    <tr key={t.id}>
                      <td>{date(t.dueOn)}</td>
                      <td>{t.title}</td>
                      <td>{t.matterId ? <a href={href("matters", t.matterId, "tasks")}>{matter(t.matterId)?.number ?? "Matter"}</a> : "—"}</td>
                      <td>
                        <button className="secondary" onClick={() => void act("update_task", { taskId: t.id, status: "done" }, "Task completed")}>
                          Done
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No open tasks.</div>
          )
        }
      </Loading>
    </>
  );
}
