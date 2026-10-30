import { randomUUID } from "node:crypto";
import { usersOf } from "../admin/commands.js";
import { settingsFor, type TenantSettings } from "../admin/settings.js";
import { AuthService } from "../auth/service.js";
import { MemoryPersistence, PostgresPersistence, type Persistence } from "../core/persistence.js";
import { openApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createHttpServer } from "./http.js";

const config = loadConfig();
let persistence: Persistence = new MemoryPersistence();
if (config.databaseUrl) {
  const pgp = new PostgresPersistence(config.databaseUrl);
  await pgp.migrate();
  persistence = pgp;
} else {
  console.warn("DATABASE_URL not set: data is held in memory and lost on restart");
}
const app = await openApp(persistence, { secretKey: config.secretKey });

// First run: create the firm's settings and an initial principal so someone can sign in.
const tenantId = config.tenantId;
const settings = app.store.collection<TenantSettings>("tenant_settings");
if (!settings.get(tenantId)) settings.set({ ...settingsFor(app.store, tenantId), firmName: config.firmName, updatedAt: new Date().toISOString() });
if (config.bootstrapAdminEmail && !usersOf(app.store).list(tenantId).length) {
  usersOf(app.store).set({
    id: randomUUID(),
    tenantId,
    email: config.bootstrapAdminEmail,
    displayName: config.bootstrapAdminEmail,
    roles: ["principal", "trust_authoriser"],
    active: true,
    createdAt: new Date().toISOString(),
  });
  console.log(`Created initial principal ${config.bootstrapAdminEmail}`);
}
await app.store.flush();
if (!config.providers.size) console.warn("No identity providers configured: set GOOGLE_* / MICROSOFT_* or PRACTY_DEV_LOGIN=1 for development");

const auth = new AuthService(app.store, config.providers, { baseUrl: config.baseUrl, defaultTenantId: tenantId });
createHttpServer(app, { auth, baseUrl: config.baseUrl, webDir: config.webDir, secureCookies: config.baseUrl.startsWith("https://") }).listen(
  config.port,
  () => console.log(`Practy listening on ${config.baseUrl} (web /, REST /api/commands, MCP /mcp)`),
);
