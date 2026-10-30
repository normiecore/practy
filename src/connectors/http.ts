/**
 * Small fetch wrapper shared by the connectors: bearer auth, JSON bodies, and a typed
 * error that keeps the provider's error body so callers can act on it (e.g. Box 409
 * `item_name_in_use` carries the conflicting file).
 */
export class HttpError extends Error {
  constructor(
    readonly service: string,
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${service} ${method} ${url} failed: HTTP ${status}${describe(body)}`);
    this.name = "HttpError";
  }
}

function describe(body: unknown): string {
  if (body == null || body === "") return "";
  const b = body as { message?: unknown; error?: { message?: unknown } | unknown; error_description?: unknown };
  const msg =
    typeof b.message === "string" ? b.message
    : typeof b.error_description === "string" ? b.error_description
    : typeof (b.error as { message?: unknown })?.message === "string" ? (b.error as { message: string }).message
    : typeof body === "string" ? body.slice(0, 200)
    : "";
  return msg ? ` (${msg})` : "";
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Serialised as JSON with Content-Type application/json unless a Content-Type is given. */
  json?: unknown;
  body?: BodyInit;
  /** Non-2xx statuses the caller handles itself instead of receiving an HttpError. */
  allow?: number[];
  redirect?: RequestRedirect;
  /** Skip the Authorization header (pre-signed download URLs). */
  noAuth?: boolean;
}

export interface HttpClientOptions {
  service: string;
  baseUrl: string;
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export type HttpClient = ReturnType<typeof createHttp>;

export function createHttp(opts: HttpClientOptions) {
  const doFetch = opts.fetch ?? fetch;

  async function raw(pathOrUrl: string, init: RequestOptions = {}): Promise<Response> {
    const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : opts.baseUrl + pathOrUrl;
    const method = init.method ?? "GET";
    const headers: Record<string, string> = { ...opts.headers, ...init.headers };
    if (!init.noAuth) headers.Authorization = `Bearer ${await opts.getAccessToken()}`;
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers["Content-Type"] ??= "application/json";
    }
    const res = await doFetch(url, { method, headers, body, ...(init.redirect ? { redirect: init.redirect } : {}) });
    if (!res.ok && !init.allow?.includes(res.status)) {
      throw new HttpError(opts.service, method, url, res.status, await readBody(res));
    }
    return res;
  }

  async function json<T>(pathOrUrl: string, init: RequestOptions = {}): Promise<T> {
    const res = await raw(pathOrUrl, { ...init, headers: { Accept: "application/json", ...init.headers } });
    return (await readBody(res)) as T;
  }

  async function bytes(pathOrUrl: string, init: RequestOptions = {}): Promise<Uint8Array> {
    const res = await raw(pathOrUrl, init);
    return new Uint8Array(await res.arrayBuffer());
  }

  return { raw, json, bytes };
}

/** Parses a JSON body when there is one; falls back to text. */
export async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface ExpiringToken {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * Wraps a token fetcher so connectors can call `getAccessToken` per request. Refreshes
 * `skewMs` before expiry and shares one in-flight refresh between concurrent callers.
 */
export function cachedToken(fetchToken: () => Promise<ExpiringToken>, skewMs = 60_000): () => Promise<string> {
  let current: ExpiringToken | undefined;
  let pending: Promise<ExpiringToken> | undefined;
  return async () => {
    if (current && current.expiresAt - skewMs > Date.now()) return current.accessToken;
    pending ??= fetchToken().finally(() => (pending = undefined));
    current = await pending;
    return current.accessToken;
  };
}

/** Escapes a value for an OData string literal. */
export const odataString = (s: string) => `'${s.replaceAll("'", "''")}'`;
