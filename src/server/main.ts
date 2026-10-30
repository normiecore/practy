import { createApp } from "./app.js";
import { createHttpServer, type TokenGrant } from "./http.js";

/**
 * Development entry point. PRACTY_DEV_TOKENS is a JSON object of
 * token → { actor, surface }. Never use static tokens with real client data.
 */
const tokens = new Map<string, TokenGrant>(Object.entries(JSON.parse(process.env.PRACTY_DEV_TOKENS ?? "{}")));
if (!tokens.size) {
  tokens.set("dev-solicitor", {
    surface: "ui",
    actor: { userId: "u-sol", tenantId: "t-demo", displayName: "Demo Solicitor", roles: ["solicitor"] },
  });
  console.warn("PRACTY_DEV_TOKENS not set: using demo token 'dev-solicitor' (tenant t-demo)");
}

const port = Number(process.env.PORT ?? 3000);
createHttpServer(createApp(), tokens).listen(port, () => {
  console.log(`Practy listening on :${port} (REST /api/commands, MCP /mcp)`);
});
