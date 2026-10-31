/**
 * Small controlled inputs for purpose-built forms: labelled text, date, money and number fields,
 * and an editable table of line items. Money is held as integer cents and typed in dollars.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import type { InputIssue } from "./api";
import { NumberInput } from "./command-form";

/** Server problems keyed by input path (rows numbered as displayed), so each field can show its own. */
export const IssuesContext = createContext<Record<string, string>>({});

function FieldError({ path }: { path?: string }) {
  const message = useContext(IssuesContext)[path ?? ""];
  return path && message ? (
    <span className="field-error" role="alert">
      {message}
    </span>
  ) : null;
}
const useInvalid = (path?: string) => (useContext(IssuesContext)[path ?? ""] ? true : undefined);

interface FieldBase {
  label: string;
  hint?: ReactNode;
  /** Where this value sits in the command input, e.g. "preInjuryEarnings.grossWeeklyCents". */
  path?: string;
}

export function TextField({ label, hint, path, value, onChange, placeholder, long }: FieldBase & { value: string | undefined; onChange: (v: string) => void; placeholder?: string; long?: boolean }) {
  const invalid = useInvalid(path);
  return (
    <label className="field">
      <span>{label}</span>
      {long ? (
        <textarea aria-invalid={invalid} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input aria-invalid={invalid} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <span className="hint">{hint}</span>}
      <FieldError path={path} />
    </label>
  );
}

export function DateField({ label, hint, path, value, onChange }: FieldBase & { value: string | undefined; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="date" aria-invalid={useInvalid(path)} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
      <FieldError path={path} />
    </label>
  );
}

export function MoneyField({ label, hint, path, value, onChange, placeholder }: FieldBase & { value: number | null | undefined; onChange: (v: number | undefined) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label} ($)</span>
      <NumberInput value={value ?? undefined} cents integer onChange={onChange} placeholder={placeholder} />
      {hint && <span className="hint">{hint}</span>}
      <FieldError path={path} />
    </label>
  );
}

export function NumberField({ label, hint, path, value, onChange, placeholder, suffix }: FieldBase & { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; suffix?: string }) {
  return (
    <label className="field">
      <span>
        {label}
        {suffix ? ` (${suffix})` : ""}
      </span>
      <NumberInput value={value} cents={false} integer={false} onChange={onChange} placeholder={placeholder} />
      {hint && <span className="hint">{hint}</span>}
      <FieldError path={path} />
    </label>
  );
}

export function SelectField({ label, hint, path, value, onChange, options, blank }: FieldBase & { value: string | undefined; onChange: (v: string | undefined) => void; options: [string, string][]; blank?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select aria-invalid={useInvalid(path)} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {hint && <span className="hint">{hint}</span>}
      <FieldError path={path} />
    </label>
  );
}

export function CheckField({ label, hint, path, value, onChange }: FieldBase & { value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" aria-invalid={useInvalid(path)} checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="hint"> {hint}</span>}
        <FieldError path={path} />
      </span>
    </label>
  );
}

/** A short list typed with commas, e.g. email domains or reminder months. */
export function ListField({
  label,
  hint,
  path,
  value,
  onChange,
  numbers,
  placeholder,
}: FieldBase & { value: (string | number)[] | undefined; onChange: (v: (string | number)[]) => void; numbers?: boolean; placeholder?: string }) {
  const [text, setText] = useState((value ?? []).join(", "));
  return (
    <label className="field">
      <span>{label}</span>
      <input
        aria-invalid={useInvalid(path)}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const items = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
          onChange(numbers ? items.map(Number) : items);
        }}
      />
      {hint && <span className="hint">{hint}</span>}
      <FieldError path={path} />
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
export function LineItems({
  columns,
  rows,
  onChange,
  addLabel = "Add row",
  empty,
  path,
}: {
  columns: Column[];
  rows: Row[] | undefined;
  onChange: (rows: Row[]) => void;
  addLabel?: string;
  empty?: string;
  /** Input path of the list, e.g. "specialDamages"; each cell is "<path>.<row>.<column>". */
  path?: string;
}) {
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
                      <Cell column={c} row={i} value={r[c.key]} onChange={(v) => set(i, c.key, v)} />
                      <FieldError path={path && `${path}.${i}.${c.key}`} />
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

function Cell({ column: c, row, value, onChange }: { column: Column; row: number; value: unknown; onChange: (v: unknown) => void }) {
  const label = `${c.label}, row ${row + 1}`;
  if (c.options) {
    return (
      <select aria-label={label} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
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
    return <NumberInput ariaLabel={label} value={value as number | undefined} cents={c.kind === "money"} integer={c.kind === "money"} onChange={onChange} />;
  }
  return <input aria-label={label} type={c.kind === "date" ? "date" : "text"} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
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

/**
 * Maps server issue paths onto the draft as displayed. Blank rows are dropped before sending, so the
 * server's row N is the Nth non-blank row on screen. Issues are keyed by path; the first message wins.
 */
export function displayIssues(issues: InputIssue[], draft: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const parts = issue.path === "" ? [] : issue.path.split(".");
    let node: unknown = draft;
    const shown: string[] = [];
    for (const part of parts) {
      if (Array.isArray(node) && /^\d+$/.test(part)) {
        const visible = node.map((r, i) => [r, i] as const).filter(([r]) => !(r && typeof r === "object" && blankRow(r as Row)));
        const hit = visible[Number(part)];
        shown.push(String(hit ? hit[1] : part));
        node = hit?.[0];
      } else {
        shown.push(part);
        node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
      }
    }
    out[shown.join(".")] ??= issue.message;
  }
  return out;
}

/** "specialDamages.0.amountCents" → "Special damages, row 1, amount", for the summary above the buttons. */
export function issueLabel(path: string): string {
  if (!path) return "Form";
  return path
    .split(".")
    .map((p) => (/^\d+$/.test(p) ? `row ${Number(p) + 1}` : p.replace(/Cents$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()))
    .join(", ")
    .replace(/^./, (c) => c.toUpperCase());
}
