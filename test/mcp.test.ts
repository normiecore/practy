import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Actor } from "../src/core/types.js";
import { createHttpServer } from "../src/server/http.js";
import { buildMcpServer } from "../src/server/mcp.js";
import { as, openMatter, setup, users } from "./helpers.js";

async function connect(app: ReturnType<typeof setup>["app"], actor: Actor) {
  const server = buildMcpServer(app.bus, actor);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const text = (r: any) => r.content[0].text as string;

describe("MCP server", () => {
  it("exposes every command except human-only approval decisions (UI/API/MCP parity)", async () => {
    const { app } = setup();
    const client = await connect(app, users.solicitor);
    const tools = (await client.listTools()).tools;
    const expected = app.bus.registry.all().filter((d) => !d.humanOnly).map((d) => d.name).sort();
    expect(tools.map((t) => t.name).sort()).toEqual(expected);
    expect(app.bus.registry.all().filter((d) => d.humanOnly).map((d) => d.name)).toEqual(["decide_approval"]);

    const pay = tools.find((t) => t.name === "prepare_trust_payment")!;
    expect(pay.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(pay.inputSchema.required).toEqual(expect.arrayContaining(["matterId", "amountCents"]));
    expect(tools.find((t) => t.name === "get_matter")!.annotations?.readOnlyHint).toBe(true);
  });

  it("runs a matter through chat as the signed-in user, with approvals and AI-use logging", async () => {
    const { app, exec } = setup();
    const client = await connect(app, users.solicitor);
    const created = JSON.parse(text(await client.callTool({
      name: "create_matter",
      arguments: { number: "SL-3001", title: "Nguyen v ICWA", scheme: "icwa_mva", injuryDate: "2026-02-10", client: { name: "Linh Nguyen" } },
    })));
    expect(created.status).toBe("executed");
    const matterId = created.result.matter.id;
    const limitation = created.result.keyDates.find((k: any) => k.ruleId === "limitation.pi.3y");

    const confirm = JSON.parse(text(await client.callTool({ name: "confirm_key_date", arguments: { matterId, keyDateId: limitation.id } })));
    expect(confirm.status).toBe("pending_approval");
    const pending = await exec<any[]>("list_approvals", { status: "pending" }, as(users.principal));
    expect(pending.map((a) => a.requestedVia)).toEqual(["mcp"]);

    const log = app.bus.audit.list({ tenantId: users.solicitor.tenantId, matterId, aiOnly: true });
    expect(log.map((e) => e.outcome)).toEqual(["pending_approval"]);
  });

  it("hides matters without AI consent and returns tool errors rather than throwing", async () => {
    const { app, exec } = setup();
    const { matter } = await openMatter(exec, { aiPermitted: false });
    const client = await connect(app, users.solicitor);
    const res: any = await client.callTool({ name: "get_matter", arguments: { matterId: matter.id } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/^not_found/);
    const search = JSON.parse(text(await client.callTool({ name: "search_matters", arguments: { query: "" } })));
    expect(search.result).toEqual([]);
    // Still visible in the app.
    expect((await exec("get_matter", { matterId: matter.id }, as(users.solicitor))).number).toBe("SL-1998");
  });
});

describe("HTTP surface", () => {
  it("serves REST commands and the remote MCP endpoint with bearer auth", async () => {
    const { app } = setup();
    const http = createHttpServer(app, new Map([["tok", { actor: users.solicitor, surface: "ui" as const }]]));
    const server = http.listen(0);
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      expect((await fetch(`${base}/api/commands`)).status).toBe(401);
      const list = await (await fetch(`${base}/api/commands`, { headers: { Authorization: "Bearer tok" } })).json();
      expect(list.find((c: any) => c.name === "create_matter").inputSchema.type).toBe("object");

      const bad = await fetch(`${base}/api/commands/get_matter`, { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify({ matterId: "nope" }) });
      expect(bad.status).toBe(404);

      const mcp = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { Authorization: "Bearer tok", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
      });
      expect(mcp.status).toBe(200);
      const body = await mcp.json();
      expect(body.result.serverInfo.name).toBe("practy");
      expect(body.result.instructions).toMatch(/approval/);
    } finally {
      server.close();
    }
  });
});
