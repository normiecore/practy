import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SecretStore } from "../core/secrets.js";
import { startJobs } from "./jobs.js";
import { usersOf } from "../admin/commands.js";
import { settingsFor, type TenantSettings } from "../admin/settings.js";
import { AuthService } from "../auth/service.js";
import { MemoryPersistence, PostgresPersistence, type Persistence } from "../core/persistence.js";
import { openApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createHttpServer } from "./http.js";
import { connectProviders } from "../integrations/oauth.js";

const config = loadConfig();

// Development convenience: keep a generated secret key on disk so connector credentials survive restarts.
let secretKey = config.secretKey;
if (!secretKey) {
  const file = "data/.secret-key";
  if (existsSync(file)) secretKey = readFileSync(file, "utf8").trim();
  else {
    mkdirSync("data", { recursive: true });
    secretKey = SecretStore.generateKey();
    writeFileSync(file, secretKey, { mode: 0o600 });
  }
  console.warn(`PRACTY_SECRET_KEY not set: using development key in ${file}`);
}
let persistence: Persistence = new MemoryPersistence();
if (config.databaseUrl) {
  const pgp = new PostgresPersistence(config.databaseUrl);
  await pgp.migrate();
  persistence = pgp;
} else {
  console.warn("DATABASE_URL not set: data is held in memory and lost on restart");
}
const app = await openApp(persistence, { secretKey, connectProviders: connectProviders(), localDocumentsRoot: process.env.PRACTY_LOCAL_DOCS });

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

if (process.env.PRACTY_JOBS !== "0") startJobs(app);
const auth = new AuthService(app.store, config.providers, { baseUrl: config.baseUrl, defaultTenantId: tenantId });
createHttpServer(app, { auth, baseUrl: config.baseUrl, webDir: config.webDir, secureCookies: config.baseUrl.startsWith("https://") }).listen(
  config.port,
  () => console.log(`Practy listening on ${config.baseUrl} (web /, REST /api/commands, MCP /mcp)`),
);
