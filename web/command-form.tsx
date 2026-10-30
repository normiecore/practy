/**
 * A form generated from a command's JSON Schema. Every command can be run from the app this way,
 * so a capability added on the server is usable here before it gets a purpose-built screen.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { listCommands, SCHEME_LABEL, type CommandInfo, type CommandResult } from "./api";
import { TIER_LABEL, useAct, Value } from "./ui";

type Schema = Record<string, any>;

export function useCommandInfo(name: string): CommandInfo | undefined {
  const [info, setInfo] = useState<CommandInfo>();
  useEffect(() => {
    listCommands().then((all) => setInfo(all.find((c) => c.name === name)));
  }, [name]);
  return info;
}

const words = (k: string) =>
  k
    .replace(/Cents$/, "")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

/** Strips nullable wrappers so `T | null` renders as T. */
function unwrap(s: Schema): Schema {
  if (s.anyOf) {
    const real = s.anyOf.filter((x: Schema) => x.type !== "null");
    if (real.length === 1) return { ...real[0], description: s.description ?? real[0].description };
    return { type: "string", description: s.description };
  }
  return s;
}

function initialValue(s: Schema): unknown {
  s = unwrap(s);
  if (s.default !== undefined) return structuredClone(s.default);
  if (s.const !== undefined) return s.const;
  if (s.type === "object" && s.properties) {
    const out: Record<string, unknown> = {};
    for (const [k, p] of Object.entries<Schema>(s.properties)) {
      const v = initialValue(p);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return undefined;
}

/** Removes empty values so optional fields left blank are omitted, not sent as "". */
function clean(v: unknown): unknown {
  if (v === "" || v === undefined) return undefined;
  if (Array.isArray(v)) return v.map(clean).filter((x) => x !== undefined);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const c = clean(x);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return v;
}

const readFile = (file: File, as: "base64" | "text") =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(as === "text" ? String(r.result) : String(r.result).split(",", 2)[1] ?? "");
    if (as === "text") r.readAsText(file);
    else r.readAsDataURL(file);
  });

interface FieldProps {
  name: string;
  schema: Schema;
  value: any;
  required: boolean;
  onChange: (v: any) => void;
  /** Sets this field and blank siblings together, so a file picker can also fill name and content type. */
  patch?: (p: Record<string, unknown>) => void;
}

function Field({ name, schema: raw, value, required, onChange, patch }: FieldProps): ReactNode {
  const s = unwrap(raw);
  const title = words(name) + (required ? "" : " (optional)");
  const hint = s.description ? <span className="hint">{s.description}</span> : null;

  if (s.const !== undefined) return null;

  if (name === "base64") {
    return (
      <label className="field">
        <span>File{required ? "" : " (optional)"}</span>
        <input
          type="file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const base64 = await readFile(f, "base64");
            if (patch) patch({ base64, name: f.name, contentType: f.type || "application/octet-stream" });
            else onChange(base64);
          }}
        />
      </label>
    );
  }

  if (s.oneOf) {
    const disc = Object.keys(s.oneOf[0].properties ?? {}).find((k) => s.oneOf.every((o: Schema) => o.properties?.[k]?.const !== undefined));
    if (disc) {
      const current = s.oneOf.find((o: Schema) => o.properties[disc].const === value?.[disc]);
      return (
        <fieldset className="card" style={{ marginBottom: "0.7rem" }}>
          <legend>{title}</legend>
          <label className="field">
            <span>{words(disc)}</span>
            <select
              value={value?.[disc] ?? ""}
              onChange={(e) => {
                const v = s.oneOf.find((o: Schema) => o.properties[disc].const === e.target.value);
                onChange(v ? initialValue(v) : undefined);
              }}
            >
              <option value="">{required ? "Choose…" : "None"}</option>
              {s.oneOf.map((o: Schema) => (
                <option key={o.properties[disc].const} value={o.properties[disc].const}>
                  {words(String(o.properties[disc].const))}
                </option>
              ))}
            </select>
          </label>
          {current && <ObjectFields schema={current} value={value} onChange={onChange} />}
        </fieldset>
      );
    }
  }

  if (s.type === "object" && s.properties) {
    return (
      <fieldset className="card" style={{ marginBottom: "0.7rem" }}>
        <legend>{title}</legend>
        {hint}
        <ObjectFields schema={s} value={value ?? {}} onChange={onChange} />
      </fieldset>
    );
  }

  if (s.type === "array" && s.items) {
    const items = unwrap(s.items);
    const list: any[] = Array.isArray(value) ? value : [];
    if (items.type === "string" && !items.enum) {
      return (
        <label className="field">
          <span>{title}</span>
          <textarea value={list.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} placeholder="One per line" />
          {hint}
        </label>
      );
    }
    if (items.enum) {
      return (
        <fieldset style={{ border: 0, padding: 0, marginBottom: "0.7rem" }}>
          <legend className="small" style={{ fontWeight: 600 }}>
            {title}
          </legend>
          {items.enum.map((opt: string) => (
            <label key={opt} className="check">
              <input
                type="checkbox"
                checked={list.includes(opt)}
                onChange={(e) => onChange(e.target.checked ? [...list, opt] : list.filter((x) => x !== opt))}
              />
              {words(opt)}
            </label>
          ))}
        </fieldset>
      );
    }
    return (
      <fieldset className="card" style={{ marginBottom: "0.7rem" }}>
        <legend>{title}</legend>
        {hint}
        {list.map((item, i) => (
          <div key={i} style={{ borderBottom: "1px solid var(--border)", marginBottom: "0.7rem" }}>
            <Field
              name={`${words(name).replace(/s$/, "")} ${i + 1}`}
              schema={items}
              value={item}
              required
              onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))}
            />
            <button type="button" className="ghost" onClick={() => onChange(list.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => onChange([...list, initialValue(items)])}>
          Add
        </button>
      </fieldset>
    );
  }

  if (s.type === "object") {
    // Free-form records (settings patches, template fields, CSV column maps).
    return <JsonField title={title} hint={hint} value={value} onChange={onChange} />;
  }

  if (s.type === "boolean") {
    return (
      <label className="check">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {words(name)}
        {hint}
      </label>
    );
  }

  if (s.enum) {
    return (
      <label className="field">
        <span>{title}</span>
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          {(!required || value === undefined) && <option value="">{required ? "Choose…" : "—"}</option>}
          {s.enum.map((o: string) => (
            <option key={o} value={o}>
              {SCHEME_LABEL[o] ?? words(o)}
            </option>
          ))}
        </select>
        {hint}
      </label>
    );
  }

  if (s.type === "integer" || s.type === "number") {
    const cents = /Cents$/.test(name);
    return (
      <label className="field">
        <span>
          {title}
          {cents ? " ($)" : ""}
        </span>
        <NumberInput value={value} cents={cents} integer={s.type === "integer"} onChange={onChange} />
        {hint}
      </label>
    );
  }

  const long = /^(body|text|description|details|csv|statementCsv|reasoning|summary|detail|otherTerms|outcome|note|purpose)$/.test(name);
  if (long) {
    return (
      <label className="field">
        <span>{title}</span>
        <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
        {/csv/i.test(name) && (
          <input type="file" accept=".csv,text/csv" onChange={async (e) => e.target.files?.[0] && onChange(await readFile(e.target.files[0], "text"))} />
        )}
        {hint}
      </label>
    );
  }

  const type = s.format === "date" ? "date" : s.format === "date-time" ? "datetime-local" : s.format === "email" ? "email" : "text";
  return (
    <label className="field">
      <span>{title}</span>
      <input
        type={type}
        value={type === "datetime-local" && value ? String(value).slice(0, 16) : (value ?? "")}
        onChange={(e) => onChange(type === "datetime-local" && e.target.value ? new Date(e.target.value).toISOString() : e.target.value)}
      />
      {hint}
    </label>
  );
}

function NumberInput({ value, cents, integer, onChange }: { value: number | undefined; cents: boolean; integer: boolean; onChange: (v: number | undefined) => void }) {
  const show = (v: number | undefined) => (v === undefined || v === null ? "" : cents ? (v / 100).toFixed(2) : String(v));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    const parsed = text === "" ? undefined : Number(text);
    const asValue = parsed === undefined ? undefined : cents ? Math.round(parsed * 100) : parsed;
    if (asValue !== value) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[$,\s]/g, "");
        setText(e.target.value);
        if (t === "") return onChange(undefined);
        const n = Number(t);
        if (Number.isNaN(n)) return;
        onChange(cents ? Math.round(n * 100) : integer ? Math.trunc(n) : n);
      }}
    />
  );
}

function JsonField({ title, hint, value, onChange }: { title: string; hint: ReactNode; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <label className="field">
      <span>{title} (JSON)</span>
      <textarea
        value={text}
        style={{ fontFamily: "monospace", borderColor: bad ? "var(--danger)" : undefined }}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) return onChange(undefined);
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {hint}
    </label>
  );
}

function ObjectFields({ schema, value, onChange, hide = [] }: { schema: Schema; value: any; onChange: (v: any) => void; hide?: string[] }) {
  const req = new Set<string>(schema.required ?? []);
  const set = (k: string, v: unknown) => onChange({ ...(value ?? {}), [k]: v });
  return (
    <>
      {Object.entries<Schema>(schema.properties ?? {})
        .filter(([k]) => !hide.includes(k))
        .map(([k, p]) => (
          <Field
            key={k}
            name={k}
            schema={p}
            value={value?.[k]}
            required={req.has(k)}
            onChange={(v) => set(k, v)}
            patch={(p) => {
              const next = { ...(value ?? {}), [k]: p[k] };
              for (const [pk, pv] of Object.entries(p)) if (pk !== k && schema.properties[pk] && !next[pk]) next[pk] = pv;
              onChange(next);
            }}
          />
        ))}
    </>
  );
}

export interface CommandFormProps {
  name: string;
  /** Inputs supplied by the screen (such as matterId); hidden from the form. */
  fixed?: Record<string, unknown>;
  initial?: Record<string, unknown>;
  submitLabel?: string;
  /** Toast shown on success; false when the caller reports the outcome itself. */
  doneMessage?: string | false;
  /** Called after the command runs or is sent for approval. Without it the result is shown under the form. */
  onDone?: (out: CommandResult) => void;
}

export function CommandForm({ name, fixed = {}, initial, submitLabel, doneMessage = "Done", onDone }: CommandFormProps) {
  const info = useCommandInfo(name);
  const act = useAct();
  const [value, setValue] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommandResult>();

  useEffect(() => {
    if (info) setValue({ ...(initialValue(info.inputSchema) as object), ...initial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  if (!info) return <p className="muted">Loading…</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const out = await act(name, { ...(clean(value) as object), ...fixed }, info.tier >= 2 || doneMessage === false ? undefined : doneMessage);
    setBusy(false);
    if (!out) return;
    if (onDone) onDone(out);
    else setResult(out);
  };

  return (
    <form onSubmit={submit}>
      <p className="muted small">{info.description}</p>
      {info.tier >= 2 && <div className="notice warn small">Needs {TIER_LABEL[info.tier]?.toLowerCase()}. Submitting drafts a request in the approvals inbox.</div>}
      <ObjectFields schema={info.inputSchema} value={value} onChange={setValue} hide={Object.keys(fixed)} />
      <div className="modal-actions">
        <button disabled={busy}>{busy ? "Working…" : (submitLabel ?? info.title)}</button>
      </div>
      {result?.status === "executed" && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <Value value={result.result} />
        </div>
      )}
    </form>
  );
}
