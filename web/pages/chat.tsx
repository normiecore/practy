import { useEffect, useRef, useState, type FormEvent } from "react";
import { sendChat, startChat, type ChatEvent } from "../api";
import { Badge, href, notifyChanged } from "../ui";

interface Message {
  role: "user" | "assistant";
  text: string;
  tools: { id: string; name: string; status?: string; approvalId?: string; error?: string }[];
}

/** In-app assistant. It acts through the same commands as the rest of the app, so anything legal-risk lands in Approvals. */
export function Chat({ matterId, onClose }: { matterId?: string; onClose: () => void }) {
  const [conversation, setConversation] = useState<{ id: string; matterId?: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const log = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController>(undefined);

  // A new conversation per matter, so the assistant's context matches the screen.
  useEffect(() => {
    if (conversation && conversation.matterId === matterId) return;
    abort.current?.abort();
    setMessages([]);
    setError(undefined);
    startChat(matterId).then(
      (id) => setConversation({ id, matterId }),
      (err: Error) => setError(err.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages]);

  const update = (fn: (m: Message) => Message) => setMessages((ms) => (ms.length ? [...ms.slice(0, -1), fn(ms[ms.length - 1]!)] : ms));

  const onEvent = (e: ChatEvent) => {
    if (e.type === "text") update((m) => ({ ...m, text: m.text + e.delta }));
    else if (e.type === "tool_call") update((m) => ({ ...m, tools: [...m.tools, { id: e.id, name: e.name }] }));
    else if (e.type === "tool_result") {
      update((m) => ({ ...m, tools: m.tools.map((t) => (t.id === e.id ? { ...t, status: e.status, approvalId: e.approvalId, error: e.error } : t)) }));
      notifyChanged();
    } else if (e.type === "error") setError(e.message);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!conversation || !text.trim() || busy) return;
    const q = text.trim();
    setText("");
    setError(undefined);
    setBusy(true);
    setMessages((ms) => [...ms, { role: "user", text: q, tools: [] }, { role: "assistant", text: "", tools: [] }]);
    abort.current = new AbortController();
    try {
      await sendChat(conversation.id, q, onEvent, abort.current.signal);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="chat" aria-label="Assistant">
      <header>
        <strong>Assistant{matterId ? " (this matter)" : ""}</strong>
        <button className="ghost" onClick={onClose} aria-label="Close assistant">
          ✕
        </button>
      </header>
      <div className="log" ref={log}>
        {messages.length === 0 && (
          <p className="muted small">
            Ask about a matter, draft a letter or find a date. Anything outward-facing or involving trust money goes to Approvals for a person to decide.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text || (m.role === "assistant" && busy && i === messages.length - 1 ? "…" : "")}
            {m.tools.length > 0 && (
              <div className="tools">
                {m.tools.map((t) =>
                  t.approvalId ? (
                    <a key={t.id} href={href("approvals")}>
                      <Badge value={`${t.name}: awaiting approval`} tone="warn" />
                    </a>
                  ) : (
                    <Badge key={t.id} value={t.error ? `${t.name}: ${t.error}` : t.name} tone={t.error ? "danger" : t.status ? "ok" : undefined} />
                  ),
                )}
              </div>
            )}
          </div>
        ))}
        {error && <div className="notice danger small">{error}</div>}
      </div>
      <form onSubmit={submit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Message"
          aria-label="Message"
          disabled={!conversation}
        />
        <button disabled={busy || !conversation}>Send</button>
      </form>
    </aside>
  );
}
