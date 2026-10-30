/**
 * Scripted fetch for connector tests. Each route matches method + URL (string prefix or
 * RegExp) and answers in order; every call is recorded for assertions. An unmatched
 * request fails the test rather than touching the network.
 */
export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
  /** Body as text when it was a string. */
  text?: string;
  json?: any;
}

type Responder = (call: RecordedCall) => Response | Promise<Response>;

interface Route {
  method: string;
  match: string | RegExp;
  respond: Responder;
  once: boolean;
  used: boolean;
}

export function fakeFetch() {
  const calls: RecordedCall[] = [];
  const routes: Route[] = [];

  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = { ...(init.headers as Record<string, string> | undefined) };
    const call: RecordedCall = { method, url, headers, body: init.body };
    if (typeof init.body === "string") {
      call.text = init.body;
      try {
        call.json = JSON.parse(init.body);
      } catch {
        /* not JSON */
      }
    }
    calls.push(call);
    const route = routes.find(
      (r) =>
        !(r.once && r.used) &&
        r.method === method &&
        (typeof r.match === "string" ? url.startsWith(r.match) : r.match.test(url)),
    );
    if (!route) throw new Error(`Unexpected request: ${method} ${url}`);
    route.used = true;
    return route.respond(call);
  }) as typeof fetch;

  const add = (method: string, match: string | RegExp, respond: Responder | object, once: boolean) => {
    routes.push({
      method,
      match,
      respond:
        typeof respond === "function" ? (respond as Responder)
        : respond instanceof Response ? () => respond.clone()
        : () => json(respond),
      once,
      used: false,
    });
  };

  return {
    fetch: fetchImpl,
    calls,
    /** Answers every matching request. */
    on(method: string, match: string | RegExp, respond: Responder | object) {
      add(method, match, respond, false);
      return this;
    },
    /** Answers the next matching request only; queue several for sequences. */
    once(method: string, match: string | RegExp, respond: Responder | object) {
      add(method, match, respond, true);
      return this;
    },
  };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

export const empty = (status = 204) => new Response(null, { status });

export const b64url = (s: string | Uint8Array) => Buffer.from(s).toString("base64url");

export const token = async () => "test-token";
