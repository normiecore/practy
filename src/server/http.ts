import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { PractyError } from "../core/errors.js";
import type { Actor, Surface } from "../core/types.js";
import type { App } from "./app.js";
import { buildMcpServer } from "./mcp.js";

/**
 * Phase 0 authentication: static bearer tokens per user. Replaced by OAuth 2.1 + PKCE
 * with firm SSO (MCP authorization spec) before any real client data is loaded.
 * A token's surface distinguishes the Practy web app session ("ui") from API keys ("api").
 */
export interface TokenGrant {
  actor: Actor;
  surface: Exclude<Surface, "mcp" | "agent">;
}

const STATUS: Record<PractyError["code"], number> = { not_found: 404, forbidden: 403, invalid: 400, conflict: 409 };

export function createHttpServer(app: App, tokens: Map<string, TokenGrant>) {
  const http = express();
  http.use(express.json({ limit: "5mb" }));

  const auth = (req: Request, res: Response): TokenGrant | undefined => {
    const token = /^Bearer (.+)$/.exec(req.header("authorization") ?? "")?.[1];
    const grant = token ? tokens.get(token) : undefined;
    if (!grant) res.status(401).json({ error: "unauthorized" });
    return grant;
  };

  http.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  http.get("/api/commands", (req, res) => {
    if (!auth(req, res)) return;
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
    const grant = auth(req, res);
    if (!grant) return;
    try {
      res.json(await app.bus.execute(String(req.params.name), req.body, { actor: grant.actor, surface: grant.surface }));
    } catch (err) {
      if (err instanceof PractyError) res.status(STATUS[err.code]).json({ error: err.code, message: err.message });
      else res.status(500).json({ error: "internal" });
    }
  });

  // Remote MCP endpoint (Streamable HTTP, stateless): one server instance per request, bound to the caller.
  http.post("/mcp", async (req, res) => {
    const grant = auth(req, res);
    if (!grant) return;
    const server = buildMcpServer(app.bus, grant.actor);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return http;
}
