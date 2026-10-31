/** Shared UI pieces: routing, toasts, data loading, modals and a generic value renderer. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, command, date, money, run, type CommandResult, type InputIssue } from "./api";

// ------------------------------------------------------------ routing (hash based, so the server needs no route table)

export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parts;
}

export const href = (...parts: string[]) => "#/" + parts.map(encodeURIComponent).join("/");
export const go = (...parts: string[]) => {
  location.hash = href(...parts);
};

// ------------------------------------------------------------ change notifications (refetch after any mutation)

const CHANGED = "practy:changed";
export const notifyChanged = () => window.dispatchEvent(new Event(CHANGED));

// ------------------------------------------------------------ toasts

interface Toast {
  id: number;
  text: string;
  error?: boolean;
}
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const push = useCallback((text: string, error = false) => {
    const id = ++next.current;
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={t.error ? "toast error" : "toast"}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------ data loading

export interface Loaded<T> {
  data?: T;
  error?: string;
  loading: boolean;
  reload: () => void;
}

/** Runs a read command and reloads it whenever inputs change or any mutation happens. Pass name null to skip. */
export function useLoad<T = any>(name: string | null, input: unknown = {}): Loaded<T> {
  const key = JSON.stringify(input);
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: !!name });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, []);
  useEffect(() => {
    if (!name) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    run<T>(name, JSON.parse(key)).then(
      (data) => live && setState({ data, loading: false }),
      (err: Error) => live && setState({ error: err.message, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [name, key, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** Returns a function that runs a mutating command, reports the outcome and refreshes loaded data. */
export function useAct() {
  const toast = useToast();
  return useCallback(
    async <T = any,>(name: string, input: unknown, done?: string, onIssues?: (issues: InputIssue[]) => void): Promise<CommandResult<T> | undefined> => {
      try {
        const out = await command<T>(name, input);
        if (out.status === "pending_approval") {
          toast(
            out.requiredApprovals > 1
              ? `Sent for approval (${out.requiredApprovals} authorisers needed)`
              : "Sent to the approvals inbox",
          );
        } else if (done) toast(done);
        notifyChanged();
        return out;
      } catch (err) {
        // A form that can place each problem beside its field takes them; the toast then just points there.
        if (onIssues && err instanceof ApiError && err.issues.length) {
          onIssues(err.issues);
          toast("Some entries need attention: see the highlighted fields", true);
        } else toast(err instanceof ApiError ? err.message : String(err), true);
        return undefined;
      }
    },
    [toast],
  );
}

// ------------------------------------------------------------ small components

export function Loading({ state, children }: { state: Loaded<unknown>; children: () => ReactNode }) {
  if (state.error) return <div className="notice danger">{state.error}</div>;
  if (state.data === undefined) return <p className="muted">Loading…</p>;
  return <>{children()}</>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus handling for a dialog: moves focus into it when it opens (unless a field already took it),
 * keeps Tab and Shift+Tab inside it, closes it on Escape, and returns focus to where it was on close.
 */
export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === el || !el.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !el.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}

/** A dialog. On a phone it fills the screen, with the title bar fixed and a closing row of actions kept in view. */
export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const ref = useDialogFocus<HTMLDivElement>(onClose);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={wide ? "modal wide" : "modal"} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="ghost modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  confirmed: "ok",
  executed: "ok",
  approved: "ok",
  done: "ok",
  filed: "ok",
  received: "ok",
  open: "info",
  proposed: "warn",
  pending: "warn",
  requested: "warn",
  manual_required: "danger",
  overdue: "danger",
  rejected: "danger",
  failed: "danger",
  critical: "danger",
};

export function Badge({ value, tone }: { value: string; tone?: string }) {
  return <span className={`badge ${tone ?? STATUS_TONE[value] ?? ""}`}>{value.replace(/_/g, " ")}</span>;
}

export const TIER_LABEL: Record<number, string> = { 0: "Read", 1: "Draft", 2: "Practitioner approval", 3: "Two trust authorisers" };

// ------------------------------------------------------------ generic value rendering

const HIDDEN = new Set(["tenantId", "sha1", "storeFileId", "folderId"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isIsoDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v);
const label = (k: string) =>
  k
    .replace(/Cents$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

function scalar(key: string, v: unknown): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="muted">—</span>;
  if (typeof v === "number" && /Cents$/.test(key)) return money(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (key === "status" && typeof v === "string") return <Badge value={v} />;
  if (isIsoDate(v)) {
    const s = v as string;
    return s.length > 10 ? `${date(s)} ${s.slice(11, 16)}` : date(s);
  }
  return String(v);
}

/** Renders any command result readably: arrays of records as tables, records as definition lists. */
export function Value({ value, name = "" }: { value: unknown; name?: string }): ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="muted">None</p>;
    if (value.every((v) => v === null || typeof v !== "object")) return <>{value.map((v) => scalar(name, v)).reduce((a, b) => [a, ", ", b] as any)}</>;
    const cols = [...new Set(value.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))].filter(
      (k) => !HIDDEN.has(k) && k !== "id" && !k.endsWith("Id"),
    );
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} className={/Cents$/.test(c) ? "num" : undefined}>
                  {label(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.map((r, i) => (
              <tr key={(r as any)?.id ?? i}>
                {cols.map((c) => (
                  <td key={c} className={/Cents$/.test(c) ? "num" : undefined}>
                    <Value value={(r as any)?.[c]} name={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (value && typeof value === "object") {
    // Internal ids mean nothing to a reader; the surrounding screen already names the matter or record.
    const entries = Object.entries(value).filter(([k, v]) => !HIDDEN.has(k) && !(typeof v === "string" && UUID.test(v)));
    return (
      <dl className="kv">
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{label(k)}</dt>
            <dd>
              <Value value={v} name={k} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <>{scalar(name, value)}</>;
}
