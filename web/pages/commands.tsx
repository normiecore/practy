import { useEffect, useState } from "react";
import { listCommands, type CommandInfo } from "../api";
import { CommandForm } from "../command-form";
import { Modal, TIER_LABEL } from "../ui";

export function CommandsPage() {
  const [cmds, setCmds] = useState<CommandInfo[]>();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<CommandInfo>();
  useEffect(() => {
    listCommands().then(setCmds);
  }, []);
  const shown = cmds?.filter((c) => !q || `${c.name} ${c.title} ${c.description}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>All commands</h1>
          <p className="muted">Every capability in Practy. The same commands are available to the assistant, the REST API and MCP clients.</p>
        </div>
      </div>
      <input style={{ maxWidth: 360, marginBottom: "1rem" }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search commands" />
      {!shown ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Command</th>
                <th>What it does</th>
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.name}>
                  <td>
                    <button className="ghost" onClick={() => setOpen(c)}>
                      {c.title}
                    </button>
                    <div className="hint">
                      <code>{c.name}</code>
                    </div>
                  </td>
                  <td className="small">{c.description}</td>
                  <td className="small">{TIER_LABEL[c.tier]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Modal title={open.title} onClose={() => setOpen(undefined)}>
          <CommandForm name={open.name} />
        </Modal>
      )}
    </>
  );
}
