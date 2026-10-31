import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { settingsFor } from "../admin/settings.js";
import { PractyOAuthProvider, redirectHostAllowed, sessionCookieFrom } from "../auth/mcp-oauth.js";
import { actorFor, AuthService, SESSION_COOKIE } from "../auth/service.js";
import { PractyError } from "../core/errors.js";
import type { Actor, Surface } from "../core/types.js";
import { renderTranscript } from "../ai/agent.js";
import { beginConnect, connectionSecretName, exchangeCode } from "../integrations/oauth.js";
import type { TenantSettings } from "../admin/settings.js";
import type { App } from "./app.js";
import { buildMcpServer } from "./mcp.js";

/** Static tokens for local development and tests only (never with client data). */
export interface DevTokenGrant {
  actor: Actor;
  surface: Exclude<Surface, "mcp" | "agent">;
}

export interface HttpOptions {
  auth: AuthService;
  baseUrl: string;
  devTokens?: Map<string, DevTokenGrant>;
  /** Directory containing the built web app (index.html). */
  webDir?: string;
  secureCookies?: boolean;
}

const STATUS: Record<PractyError["code"], number> = { not_found: 404, forbidden: 403, invalid: 400, conflict: 409 };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1b1f24}h1{font-size:1.4rem}
button,a.btn{display:inline-block;font:inherit;padding:.6rem 1rem;border-radius:.4rem;border:1px solid #1d4ed8;background:#1d4ed8;color:#fff;text-decoration:none;margin:.25rem .5rem .25rem 0;cursor:pointer}
button.secondary{background:#fff;color:#1d4ed8}.muted{color:#57606a}input{font:inherit;padding:.5rem;width:100%;box-sizing:border-box;margin:.5rem 0}</style></head><body>${body}</body></html>`;
}

export function createHttpServer(app: App, opts: HttpOptions) {
  const { auth } = opts;
  const oauth = new PractyOAuthProvider(app.store, auth);
  const http = express();
  http.disable("x-powered-by");
  http.set("trust proxy", 1);
  http.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self' https:; base-uri 'none'",
    );
    next();
  });
  // Throttle sign-in, OAuth and API traffic per client address.
  http.use(["/auth", "/oauth", "/authorize", "/token", "/register", "/integrations"], rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));
  http.use(["/api", "/mcp"], rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false }));
  http.use(express.json({ limit: "25mb" }));
  http.use(express.urlencoded({ extended: false }));

  const cookie = (token: string, maxAgeS: number) =>
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${opts.secureCookies ? "; Secure" : ""}`;

  http.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ staff sign-in
  http.get("/auth/providers", (_req, res) => {
    res.json([...auth.providers.values()].map((p) => ({ id: p.id, label: p.label })));
  });

  http.get("/auth/login", (req, res) => {
    const returnTo = String(req.query.returnTo ?? "/");
    const buttons = [...auth.providers.values()]
      .map((p) => `<a class="btn" href="/auth/login/${p.id}?returnTo=${encodeURIComponent(returnTo)}">Sign in with ${escapeHtml(p.label)}</a>`)
      .join("");
    res.send(page("Sign in · Practy", `<h1>Sign in to Practy</h1><p class="muted">Use your firm account.</p>${buttons}`));
  });

  http.get("/auth/login/:provider", async (req, res) => {
    try {
      res.redirect(302, await auth.beginLogin(String(req.params.provider), String(req.query.returnTo ?? "/")));
    } catch (err) {
      res.status(400).send(page("Sign-in error", `<h1>Sign-in error</h1><p>${escapeHtml((err as Error).message)}</p>`));
    }
  });

  http.get("/auth/callback/:provider", async (req, res) => {
    try {
      // Only a coarse device description and the network are kept from these (src/auth/sessions.ts).
      const client = { userAgent: req.header("user-agent"), ip: req.ip };
      const { token, returnTo } = await auth.completeLogin(String(req.params.provider), String(req.query.state ?? ""), String(req.query.code ?? ""), client);
      res.setHeader("Set-Cookie", cookie(token, (auth.opts.sessionHours ?? 12) * 3600));
      res.redirect(302, returnTo);
    } catch (err) {
      res.status(403).send(page("Sign-in refused", `<h1>Sign-in refused</h1><p>${escapeHtml((err as Error).message)}</p><a class="btn" href="/auth/login">Try again</a>`));
    }
  });

  if (auth.providers.has("dev")) {
    http.get("/auth/dev", (req, res) => {
      const state = escapeHtml(String(req.query.state ?? ""));
      res.send(page("Dev sign-in", `<h1>Development sign-in</h1><p class="muted">Not available in production.</p>
<form method="get" action="/auth/callback/dev"><input type="hidden" name="state" value="${state}"><label>Email<input name="code" type="email" required autofocus></label><button>Sign in</button></form>`));
    });
  }

  http.post("/auth/logout", (req, res) => {
    auth.endSession(sessionCookieFrom(req.headers.cookie));
    res.setHeader("Set-Cookie", cookie("", 0));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ API authentication
  /** sessionId is the cookie session's record id, so session commands can tell "this device" apart. */
  type Resolved = { actor: Actor; surface: Exclude<Surface, "mcp" | "agent">; sessionId?: string };
  const resolve = (req: Request): Resolved | "csrf" | undefined => {
    const bearer = /^Bearer (.+)$/.exec(req.header("authorization") ?? "")?.[1];
    if (bearer) {
      const dev = opts.devTokens?.get(bearer);
      if (dev) return dev;
      const user = bearer.startsWith("pk_") ? auth.apiKeyUser(bearer) : undefined;
      return user ? { actor: actorFor(user), surface: "api" } : undefined;
    }
    const s = auth.session(sessionCookieFrom(req.headers.cookie));
    if (!s) return undefined;
    if (req.method !== "GET" && req.header("x-practy-csrf") !== s.session.csrf) return "csrf";
    return { actor: actorFor(s.user), surface: "ui", sessionId: s.session.id };
  };
  const requireApi = (req: Request, res: Response): Resolved | undefined => {
    const r = resolve(req);
    if (r === "csrf") {
      res.status(403).json({ error: "csrf" });
      return undefined;
    }
    if (!r) res.status(401).json({ error: "unauthorized" });
    return r;
  };

  http.get("/api/session", (req, res) => {
    const s = auth.session(sessionCookieFrom(req.headers.cookie));
    if (!s) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({ user: s.user, csrf: s.session.csrf, firmName: settingsFor(app.store, s.user.tenantId).firmName });
  });

  http.post("/api/keys", async (req, res) => {
    const r = requireApi(req, res);
    if (!r) return;
    if (r.surface !== "ui") {
      res.status(403).json({ error: "forbidden", message: "API keys are created in the app" });
      return;
    }
    const user = auth.userById(r.actor.userId)!;
    const key = auth.createApiKey(user, String(req.body?.label ?? "API key"));
    await app.store.flush();
    res.json({ key, note: "Shown once. Store it securely." });
  });

  http.get("/api/commands", (req, res) => {
    if (!requireApi(req, res)) return;
    res.json(
      app.bus.registry.all().map((d) => ({
        name: d.name,
        title: d.title,
        description: d.description,
        tier: d.tier,
        humanOnly: !!d.humanOnly,
        inputSchema: z.toJSONSchema(d.input),
      })),
    );
  });

  http.post("/api/commands/:name", async (req, res) => {
    const r = requireApi(req, res);
    if (!r) return;
    try {
      res.json(await app.bus.execute(String(req.params.name), req.body, r));
    } catch (err) {
      if (err instanceof PractyError) res.status(STATUS[err.code]).json({ error: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) });
      else {
        console.error(err);
        res.status(500).json({ error: "internal", message: "Unexpected error" });
      }
    }
  });

  const apiError = (res: Response, err: unknown) => {
    if (err instanceof PractyError) res.status(STATUS[err.code]).json({ error: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) });
    else res.status(500).json({ error: "internal", message: (err as Error).message });
  };

  // ------------------------------------------------------------ document download (access checked by the same command path)
  http.get("/api/matters/:matterId/documents/:documentId/download", async (req, res) => {
    const r = requireApi(req, res);
    if (!r) return;
    try {
      const out = await app.bus.execute("get_document", { matterId: req.params.matterId, documentId: req.params.documentId }, r);
      if (out.status !== "executed") throw new Error("unexpected");
      const doc = out.result as { name: string; contentType: string; storeFileId: string };
      const bytes = await app.hub.requireDocuments(r.actor.tenantId).download(doc.storeFileId);
      res.setHeader("Content-Type", doc.contentType);
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`);
      res.send(Buffer.from(bytes));
    } catch (err) {
      apiError(res, err);
    }
  });

  // ------------------------------------------------------------ connecting data sources (mailbox, calendar, Xero, PracticePanther)
  const pendingConnects = new Map<string, { providerId: string; verifier: string; userId: string; tenantId: string; expires: number }>();
  const connectRedirect = (id: string) => `${opts.baseUrl}/integrations/callback/${id}`;

  http.get("/integrations/connect/:provider", (req, res) => {
    const s = auth.session(sessionCookieFrom(req.headers.cookie));
    if (!s) {
      res.redirect(302, `/auth/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    const p = app.connectProviders.get(String(req.params.provider));
    if (!p) {
      res.status(404).send(page("Not available", "<h1>This connection is not configured on this server</h1>"));
      return;
    }
    if (p.scope === "firm" && !s.user.roles.includes("principal")) {
      res.status(403).send(page("Not allowed", "<h1>Only a principal can connect firm-wide systems</h1>"));
      return;
    }
    const { url, state, verifier } = beginConnect(p, connectRedirect(p.id));
    pendingConnects.set(state, { providerId: p.id, verifier, userId: s.user.id, tenantId: s.user.tenantId, expires: Date.now() + 600_000 });
    res.redirect(302, url);
  });

  http.get("/integrations/callback/:provider", async (req, res) => {
    const state = String(req.query.state ?? "");
    const pending = pendingConnects.get(state);
    pendingConnects.delete(state);
    const s = auth.session(sessionCookieFrom(req.headers.cookie));
    const p = app.connectProviders.get(String(req.params.provider));
    if (!pending || !p || pending.providerId !== p.id || pending.expires < Date.now() || !s || s.user.id !== pending.userId) {
      res.status(400).send(page("Connection failed", "<h1>Connection request expired or invalid</h1><a class=\"btn\" href=\"/settings\">Back to settings</a>"));
      return;
    }
    try {
      const token = await exchangeCode(p, String(req.query.code ?? ""), connectRedirect(p.id), pending.verifier);
      app.secrets.set(pending.tenantId, connectionSecretName(p, pending.userId), token);
      if (p.id === "xero") await rememberXeroTenant(app, pending.tenantId, token.accessToken);
      await app.store.flush();
      res.redirect(302, `/settings?connected=${p.id}`);
    } catch (err) {
      res.status(502).send(page("Connection failed", `<h1>Connection failed</h1><p>${escapeHtml((err as Error).message)}</p>`));
    }
  });

  // ------------------------------------------------------------ in-app assistant (streams Server-Sent Events)

  http.post("/api/chat", (req, res) => {
    const r = requireApi(req, res);
    if (!r) return;
    const matterId = typeof req.body?.matterId === "string" ? req.body.matterId : undefined;
    const c = app.agent.start(r.actor, matterId);
    void app.store.flush().then(() => res.json({ id: c.id }), (err) => apiError(res, err));
  });

  http.get("/api/chat/:id", (req, res) => {
    const r = requireApi(req, res);
    if (!r) return;
    try {
      const c = app.agent.get(r.actor, String(req.params.id));
      res.json({ id: c.id, title: c.title, matterId: c.matterId, items: renderTranscript(c) });
    } catch (err) {
      apiError(res, err);
    }
  });

  http.post("/api/chat/:id/messages", async (req, res) => {
    const r = requireApi(req, res);
    if (!r) return;
    const text = String(req.body?.text ?? "").trim();
    if (!text) {
      res.status(400).json({ error: "invalid", message: "Message text is required" });
      return;
    }
    try {
      app.agent.get(r.actor, String(req.params.id));
    } catch (err) {
      apiError(res, err);
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const send = (e: object) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    try {
      await app.agent.send(r.actor, String(req.params.id), text, send, abort.signal);
    } catch (err) {
      send({ type: "error", message: err instanceof PractyError ? err.message : "Assistant unavailable" });
    }
    res.end();
  });

  // ------------------------------------------------------------ MCP (OAuth 2.1 for external clients)
  const issuer = new URL(opts.baseUrl);
  const mcpUrl = new URL("/mcp", issuer);
  http.use(mcpAuthRouter({ provider: oauth, issuerUrl: issuer, resourceServerUrl: mcpUrl, scopesSupported: ["practy"], resourceName: "Practy" }));

  http.get("/oauth/consent", (req, res) => {
    const id = String(req.query.request ?? "");
    const pending = oauth.pendingRequest(id);
    if (!pending) {
      res.status(400).send(page("Expired", "<h1>This request has expired</h1><p>Start the connection again from your AI client.</p>"));
      return;
    }
    const s = auth.session(sessionCookieFrom(req.headers.cookie));
    if (!s) {
      res.redirect(302, `/auth/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    const enabled = settingsFor(app.store, s.user.tenantId).ai.externalMcpClients;
    const allowed = redirectHostAllowed(app.store, s.user.tenantId, pending.params.redirectUri);
    res.send(
      page(
        "Connect AI client · Practy",
        `<h1>Connect ${escapeHtml(pending.clientName)} to Practy?</h1>
<p>Access will be sent to <strong>${escapeHtml(pending.redirectHost)}</strong> (client ID <code>${escapeHtml(pending.clientId)}</code>).
${pending.verified ? "" : "<strong>Unverified client:</strong> the name above was chosen by whoever registered it. Only allow this if you started the connection yourself and recognise that address."}</p>
<p>It will act as <strong>${escapeHtml(s.user.displayName)}</strong> (${escapeHtml(s.user.email)}) and can read and draft on matters you can see.
Legal-risk and trust actions still need approval in Practy. Matter data will be processed by the AI provider under your firm's plan.</p>
${enabled ? "" : '<p><strong>External AI clients are switched off for your firm.</strong> A principal can enable them in Settings.</p>'}
${allowed ? "" : `<p><strong>${escapeHtml(pending.redirectHost)} is not on your firm's list of allowed AI clients.</strong> A principal can add it in Settings (AI, allowed client hosts) if it is genuine.</p>`}
<form method="post" action="/oauth/consent"><input type="hidden" name="request" value="${escapeHtml(id)}"><input type="hidden" name="csrf" value="${escapeHtml(s.session.csrf)}">
<button name="decision" value="approve"${enabled && allowed ? "" : " disabled"}>Allow</button><button class="secondary" name="decision" value="deny">Deny</button></form>`,
      ),
    );
  });

  http.post("/oauth/consent", (req, res) => {
    const raw = sessionCookieFrom(req.headers.cookie);
    const s = auth.session(raw);
    if (!s || req.body?.csrf !== s.session.csrf) {
      res.status(403).send(page("Refused", "<h1>Request refused</h1>"));
      return;
    }
    try {
      res.redirect(302, oauth.decide(String(req.body.request), raw, req.body.decision === "approve"));
    } catch (err) {
      res.status(400).send(page("Error", `<h1>${escapeHtml((err as Error).message)}</h1>`));
    }
  });

  const bearer = requireBearerAuth({
    verifier: {
      verifyAccessToken: async (token) => {
        const dev = opts.devTokens?.get(token);
        if (dev) return { token, clientId: "dev", scopes: ["practy"], extra: { userId: dev.actor.userId, devActor: dev.actor } };
        return oauth.verifyAccessToken(token);
      },
    },
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });

  http.post("/mcp", bearer, async (req: Request, res: Response) => {
    const extra = req.auth?.extra as { userId: string; devActor?: Actor } | undefined;
    const user = extra && !extra.devActor ? auth.userById(extra.userId) : undefined;
    const actor = extra?.devActor ?? (user && actorFor(user));
    if (!actor) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    const maxTier = extra?.devActor ? 3 : settingsFor(app.store, actor.tenantId).ai.externalClientMaxTier;
    const server = buildMcpServer(app.bus, actor, { maxTier });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  for (const method of ["get", "delete"] as const) {
    http[method]("/mcp", (_req, res) => {
      res.status(405).set("Allow", "POST").json({ error: "method_not_allowed" });
    });
  }

  // ------------------------------------------------------------ web app
  if (opts.webDir && existsSync(join(opts.webDir, "index.html"))) {
    http.use(express.static(opts.webDir, { index: false, maxAge: "1h" }));
    http.get(/^\/(?!api\/|auth\/|oauth\/|mcp|\.well-known\/).*/, (req: Request, res: Response, next: NextFunction) => {
      if (!auth.session(sessionCookieFrom(req.headers.cookie))) {
        res.redirect(302, `/auth/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
        return;
      }
      // `root` keeps a dot directory above the web app (such as a checkout under .claude/) from being refused as a dotfile.
      res.sendFile("index.html", { root: opts.webDir! }, (err) => err && next(err));
    });
  }

  return http;
}

/** After connecting Xero, record the organisation id when the user granted exactly one. */
async function rememberXeroTenant(app: App, tenantId: string, accessToken: string): Promise<void> {
  const res = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return;
  const orgs = (await res.json()) as { tenantId: string; tenantType: string }[];
  const only = orgs.filter((o) => o.tenantType === "ORGANISATION");
  if (only.length !== 1) return;
  const s = settingsFor(app.store, tenantId);
  app.store.collection<TenantSettings>("tenant_settings").set({ ...s, trust: { ...s.trust, xeroTenantId: only[0]!.tenantId }, updatedAt: new Date().toISOString() });
}
