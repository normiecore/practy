/** Thin client for the command API. Every screen uses the same commands as MCP and the assistant. */

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  tenantId: string;
}

export interface Session {
  user: SessionUser;
  csrf: string;
  firmName: string;
}

export type CommandResult<T = unknown> =
  | { status: "executed"; result: T }
  | { status: "pending_approval"; approvalId: string; requiredApprovals: number; message: string };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let session: Session | null = null;

export async function loadSession(): Promise<Session | null> {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  if (res.status === 401) return null;
  session = (await res.json()) as Session;
  return session;
}

export const currentSession = () => session;

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "x-practy-csrf": session?.csrf ?? "" },
    body: JSON.stringify(body ?? {}),
  });
}

export async function command<T = any>(name: string, input: unknown = {}): Promise<CommandResult<T>> {
  const res = await post(`/api/commands/${name}`, input);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = `/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
    throw new ApiError("unauthorized", "Signed out", 401);
  }
  if (!res.ok) throw new ApiError(data.error ?? "error", data.message ?? `Request failed (${res.status})`, res.status);
  return data as CommandResult<T>;
}

/** Runs a read or draft command and returns its result (throws if it unexpectedly needs approval). */
export async function run<T = any>(name: string, input: unknown = {}): Promise<T> {
  const out = await command<T>(name, input);
  if (out.status !== "executed") throw new ApiError("pending_approval", out.message, 202);
  return out.result;
}

export interface CommandInfo {
  name: string;
  title: string;
  description: string;
  tier: 0 | 1 | 2 | 3;
  humanOnly: boolean;
  inputSchema: any;
}

let commandList: Promise<CommandInfo[]> | undefined;

/** The command catalogue with JSON Schema inputs, fetched once per page load. */
export function listCommands(): Promise<CommandInfo[]> {
  commandList ??= fetch("/api/commands", { credentials: "same-origin" }).then((r) => {
    if (!r.ok) throw new ApiError("commands", "Could not load commands", r.status);
    return r.json() as Promise<CommandInfo[]>;
  });
  commandList.catch(() => (commandList = undefined));
  return commandList;
}

export async function startChat(matterId?: string): Promise<string> {
  const res = await post("/api/chat", { matterId });
  if (!res.ok) throw new ApiError("chat", "Could not start a conversation", res.status);
  return ((await res.json()) as { id: string }).id;
}

export async function getChat(id: string) {
  const res = await fetch(`/api/chat/${id}`, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError("chat", "Conversation not found", res.status);
  return (await res.json()) as { id: string; title: string; items: { role: "user" | "assistant"; text: string; tools: { name: string; status?: string }[] }[] };
}

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; status: string; approvalId?: string; error?: string }
  | { type: "done"; conversationId: string }
  | { type: "error"; message: string };

export async function sendChat(id: string, text: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await post(`/api/chat/${id}/messages`, { text });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? "chat", data.message ?? "Assistant unavailable", res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  signal?.addEventListener("abort", () => void reader.cancel());
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)) as ChatEvent);
    }
  }
}

export async function logout(): Promise<void> {
  await post("/auth/logout", {});
  window.location.href = "/auth/login";
}

export const money = (cents: number | null | undefined) =>
  cents == null ? "—" : (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

export const date = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

export const SCHEME_LABEL: Record<string, string> = { icwa_mva: "ICWA motor vehicle", workcover_wa: "WorkCover WA", other: "Other PI" };
