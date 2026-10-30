/**
 * Small controlled inputs for purpose-built forms: labelled text, date, money and number fields,
 * and an editable table of line items. Money is held as integer cents and typed in dollars.
 */
import type { ReactNode } from "react";
import { NumberInput } from "./command-form";

interface FieldBase {
  label: string;
  hint?: ReactNode;
}

export function TextField({ label, hint, value, onChange, placeholder, long }: FieldBase & { value: string | undefined; onChange: (v: string) => void; placeholder?: string; long?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      {long ? (
        <textarea value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function DateField({ label, hint, value, onChange }: FieldBase & { value: string | undefined; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function MoneyField({ label, hint, value, onChange, placeholder }: FieldBase & { value: number | null | undefined; onChange: (v: number | undefined) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label} ($)</span>
      <NumberInput value={value ?? undefined} cents integer onChange={onChange} placeholder={placeholder} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function NumberField({ label, hint, value, onChange, placeholder, suffix }: FieldBase & { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; suffix?: string }) {
  return (
    <label className="field">
      <span>
        {label}
        {suffix ? ` (${suffix})` : ""}
      </span>
      <NumberInput value={value} cents={false} integer={false} onChange={onChange} placeholder={placeholder} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function SelectField({ label, hint, value, onChange, options, blank }: FieldBase & { value: string | undefined; onChange: (v: string | undefined) => void; options: [string, string][]; blank?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

// ------------------------------------------------------------ line items

export interface Column {
  key: string;
  label: string;
  kind: "text" | "date" | "money" | "number";
  /** Select options, for a text column with a fixed set of values. */
  options?: [string, string][];
  optional?: boolean;
}

type Row = Record<string, unknown>;

/** True when every cell of a row is blank, so an untouched added row is dropped rather than sent. */
export const blankRow = (row: Row) => Object.values(row).every((v) => v === undefined || v === null || v === "");

/** An editable table of line items. On a phone each row stacks into a small card (see .rows-table in styles.css). */
export function LineItems({ columns, rows, onChange, addLabel = "Add row", empty }: { columns: Column[]; rows: Row[] | undefined; onChange: (rows: Row[]) => void; addLabel?: string; empty?: string }) {
  const list = rows ?? [];
  const set = (i: number, key: string, v: unknown) => onChange(list.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  return (
    <div>
      {list.length === 0 ? (
        empty && <p className="muted small">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="rows-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.kind === "money" || c.kind === "number" ? "num" : undefined}>
                    {c.label}
                    {c.kind === "money" ? " ($)" : ""}
                    {c.optional ? <span className="optional"> (optional)</span> : null}
                  </th>
                ))}
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} data-label={c.label + (c.kind === "money" ? " ($)" : "") + (c.optional ? " (optional)" : "")} className={`cell-${c.kind}`}>
                      <Cell column={c} value={r[c.key]} onChange={(v) => set(i, c.key, v)} />
                    </td>
                  ))}
                  <td className="cell-remove">
                    <button type="button" className="ghost" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(list.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="secondary" onClick={() => onChange([...list, {}])}>
        {addLabel}
      </button>
    </div>
  );
}

function Cell({ column: c, value, onChange }: { column: Column; value: unknown; onChange: (v: unknown) => void }) {
  if (c.options) {
    return (
      <select aria-label={c.label} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{c.optional ? "—" : "Choose…"}</option>
        {c.options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );
  }
  if (c.kind === "money" || c.kind === "number") {
    return <NumberInput ariaLabel={c.label} value={value as number | undefined} cents={c.kind === "money"} integer={c.kind === "money"} onChange={onChange} />;
  }
  return <input aria-label={c.label} type={c.kind === "date" ? "date" : "text"} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

// ------------------------------------------------------------ payload clean-up

/**
 * Drops blank strings, blank line items, empty lists and empty objects so optional fields are omitted.
 * Null is kept: it means "deliberately left unset" (general damages).
 */
export function prune(v: unknown): unknown {
  if (v === "" || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const list = v.filter((x) => !(x && typeof x === "object" && blankRow(x as Row))).map(prune).filter((x) => x !== undefined);
    return list.length ? list : undefined;
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const c = prune(x);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return typeof v === "string" ? v.trim() || undefined : v;
}
