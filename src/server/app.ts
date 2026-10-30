import { ApprovalStore, type Approval } from "../core/approvals.js";
import { AuditLog } from "../core/audit.js";
import { CommandBus } from "../core/bus.js";
import { WA_CALENDAR, type IsoDate } from "../core/calendar.js";
import type { Persistence } from "../core/persistence.js";
import { Registry } from "../core/registry.js";
import { SecretStore, type SecretRecord } from "../core/secrets.js";
import { adminCommands } from "../admin/commands.js";
import { settingsFor } from "../admin/settings.js";
import { AgentService, agentCommands } from "../ai/agent.js";
import { ChronologyService, chronologyCommands } from "../ai/chronology.js";
import { ClaudeGateway, type ChatModel } from "../ai/gateway.js";
import type { MatterDocument } from "../documents/model.js";
import { domainCommands, matterGuard } from "../domain/commands.js";
import { Store } from "../domain/store.js";
import { TrustService, trustCommands } from "../trust/commands.js";

export interface App {
  store: Store;
  trust: TrustService;
  bus: CommandBus;
  secrets: SecretStore;
  agent: AgentService;
  chronology: ChronologyService;
}

export interface AppOptions {
  today?: () => IsoDate;
  store?: Store;
  /** Base64 32-byte key for connector secrets; a random per-process key is used when absent (dev/tests). */
  secretKey?: string;
  /** Model per firm; defaults to the Claude gateway configured in settings. Tests inject fakes. */
  chatModel?: (tenantId: string) => ChatModel;
  /** Reads document bytes from the firm's document store. */
  loadDocumentBytes?: (doc: MatterDocument) => Promise<Uint8Array>;
}

/** Composition root: one registry and one bus shared by the web app, REST API, MCP server and agents. */
export function createApp(opts: AppOptions = {}): App {
  const store = opts.store ?? new Store();
  const trust = new TrustService(store, WA_CALENDAR, opts.today);
  const secrets = new SecretStore(store.collection<SecretRecord>("secret"), opts.secretKey ?? SecretStore.generateKey());
  const chatModel =
    opts.chatModel ??
    ((tenantId: string) => {
      const ai = settingsFor(store, tenantId).ai;
      return new ClaudeGateway({ provider: ai.provider, model: ai.model, awsRegion: process.env.PRACTY_AWS_REGION });
    });
  const loadBytes = opts.loadDocumentBytes ?? (async () => {
    throw new Error("No document store is configured");
  });
  const chronology = new ChronologyService(store, chatModel, loadBytes);
  const registry = new Registry().register(
    ...adminCommands(store),
    ...domainCommands(store),
    ...trustCommands(store, trust),
    ...chronologyCommands(chronology),
  );
  const audit = new AuditLog(undefined, (entry) =>
    store.queue.enqueue(() => store.queue.persistence.appendAudit(entry)),
  );
  const bus = new CommandBus(
    registry,
    audit,
    new ApprovalStore(store.collection<Approval>("approval")),
    matterGuard(store),
    () => store.flush(),
  );
  const agent = new AgentService(store, bus, chatModel);
  registry.register(...agentCommands(agent));
  return { store, trust, bus, secrets, agent, chronology };
}

/** Opens an app over durable storage, restoring the working set and the audit chain. */
export async function openApp(persistence: Persistence, opts: Omit<AppOptions, "store"> = {}): Promise<App> {
  const store = await Store.open(persistence);
  const app = createApp({ ...opts, store });
  app.bus.audit.hydrate(await persistence.loadAudit());
  return app;
}
