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
import type { MailMessage } from "../connectors/types.js";
import { FilingService, filingCommands } from "../filing/service.js";
import { complianceCommands } from "../compliance/commands.js";
import { damagesCommands } from "../damages/commands.js";
import { costsCommands } from "../costs/commands.js";
import { documentCommands } from "../documents/commands.js";
import { workCommands } from "../work/commands.js";
import { emailToPdf } from "../docgen/pdf.js";
import { IntegrationHub } from "../integrations/hub.js";
import { integrationCommands } from "../integrations/commands.js";
import { wireIntegrations } from "../integrations/factory.js";
import type { ConnectProvider } from "../integrations/oauth.js";
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
  hub: IntegrationHub;
  filing: FilingService;
  connectProviders: Map<string, ConnectProvider>;
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
  hub?: IntegrationHub;
  /** Renders an email to PDF for filing. */
  renderEmailPdf?: (m: MailMessage) => Promise<Uint8Array>;
  /** OAuth connect providers for data connectors; when given, connectors are built from settings and credentials. */
  connectProviders?: Map<string, ConnectProvider>;
  localDocumentsRoot?: string;
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
  const hub = opts.hub ?? new IntegrationHub();
  const loadBytes = opts.loadDocumentBytes ?? ((doc: MatterDocument) => hub.requireDocuments(doc.tenantId).download(doc.storeFileId));
  const filing = new FilingService(
    store,
    hub,
    opts.renderEmailPdf ??
      ((m: MailMessage) =>
        emailToPdf({
          from: m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email,
          to: m.to.map((a) => a.email),
          cc: m.cc.map((a) => a.email),
          sent: m.date,
          subject: m.subject,
          attachments: m.attachments.map((a) => a.filename),
          text: m.text,
          html: m.html,
        })),
  );
  const chronology = new ChronologyService(store, chatModel, loadBytes);
  const registry = new Registry().register(
    ...adminCommands(store),
    ...domainCommands(store, undefined, (tenantId) => hub.documents(tenantId)),
    ...trustCommands(store, trust),
    ...chronologyCommands(chronology),
    ...filingCommands(filing),
    ...damagesCommands(store),
    ...costsCommands(store),
    ...documentCommands(store, hub),
    ...workCommands(store),
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
  const connectProviders = opts.connectProviders ?? new Map<string, ConnectProvider>();
  if (!opts.hub) wireIntegrations({ store, secrets, hub, trust, providers: connectProviders, localDocumentsRoot: opts.localDocumentsRoot });
  registry.register(...integrationCommands({ store, secrets, hub, bus, providers: connectProviders }));
  const agent = new AgentService(store, bus, chatModel);
  registry.register(...agentCommands(agent), ...complianceCommands(store, audit));
  return { store, trust, bus, secrets, agent, chronology, hub, filing, connectProviders };
}

/** Opens an app over durable storage, restoring the working set and the audit chain. */
export async function openApp(persistence: Persistence, opts: Omit<AppOptions, "store"> = {}): Promise<App> {
  const store = await Store.open(persistence);
  const app = createApp({ ...opts, store });
  app.bus.audit.hydrate(await persistence.loadAudit());
  return app;
}
