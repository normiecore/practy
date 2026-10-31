import { useState } from "react";
import { date, SCHEME_LABEL } from "../api";
import { CommandForm } from "../command-form";
import { Badge, go, href, Loading, Modal, useLoad, useToast, Value } from "../ui";

interface MatterRow {
  id: string;
  number: string;
  title: string;
  scheme: string;
  status: string;
  injuryDate?: string;
}

export function Matters() {
  const [query, setQuery] = useState("");
  const [scheme, setScheme] = useState("");
  const [opening, setOpening] = useState(false);
  const [conflicts, setConflicts] = useState<{ matterId: string; hits: unknown[] }>();
  const toast = useToast();
  const matters = useLoad<MatterRow[]>("search_matters", { query, ...(scheme ? { scheme } : {}) });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Matters</h1>
          <p className="muted">Search by matter number, title or party name.</p>
        </div>
        <button onClick={() => setOpening(true)}>Open a matter</button>
      </div>
      <div className="row filters" style={{ marginBottom: "1rem" }}>
        <input
          className="filter-search"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search matters"
          enterKeyHint="search"
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <select className="filter-scheme" value={scheme} onChange={(e) => setScheme(e.target.value)} aria-label="Scheme">
          <option value="">All schemes</option>
          {Object.entries(SCHEME_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <Loading state={matters}>
        {() =>
          matters.data!.length ? (
            <div className="table-wrap">
              <table className="card-table matters-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Title</th>
                    <th>Scheme</th>
                    <th>Injury date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {matters.data!.map((m) => (
                    <tr key={m.id}>
                      <td data-label="No." className="matter-no">
                        <a href={href("matters", m.id)}>{m.number}</a>
                      </td>
                      <td data-label="Title" className="primary">
                        {/* On a phone the number cell is hidden and this one link carries number and title. */}
                        <a href={href("matters", m.id)} className="matter-link">
                          <span className="card-only">{m.number} </span>
                          {m.title}
                        </a>
                      </td>
                      <td data-label="Scheme" className="scheme">
                        <span>{SCHEME_LABEL[m.scheme] ?? m.scheme}</span>
                      </td>
                      <td data-label="Injury date">{date(m.injuryDate)}</td>
                      <td data-label="Status" className="status">
                        <Badge value={m.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No matters found.</div>
          )
        }
      </Loading>
      {opening && (
        <Modal title="Open a matter" onClose={() => setOpening(false)}>
          <CommandForm
            name="create_matter"
            submitLabel="Open matter"
            doneMessage={false}
            onDone={(out) => {
              setOpening(false);
              if (out.status !== "executed") return;
              const r = out.result as { matter: { id: string }; conflicts: unknown[]; keyDates: unknown[] };
              if (r.conflicts.length) return setConflicts({ matterId: r.matter.id, hits: r.conflicts });
              toast(`Matter opened with ${r.keyDates.length} proposed key dates`);
              go("matters", r.matter.id, "dates");
            }}
          />
        </Modal>
      )}
      {conflicts && (
        <Modal title="Possible conflicts" onClose={() => go("matters", conflicts.matterId)}>
          <div className="notice warn">The matter was opened, but the conflict search matched existing parties. Review these before acting.</div>
          <Value value={conflicts.hits} />
          <div className="modal-actions">
            <button onClick={() => go("matters", conflicts.matterId)}>Go to matter</button>
          </div>
        </Modal>
      )}
    </>
  );
}
