import { ApprovalStore, type Approval } from "../core/approvals.js";
import { AuditLog } from "../core/audit.js";
import { CommandBus } from "../core/bus.js";
import { WA_CALENDAR, type IsoDate } from "../core/calendar.js";
import type { Persistence } from "../core/persistence.js";
import { Registry } from "../core/registry.js";
import { domainCommands, matterGuard } from "../domain/commands.js";
import { Store } from "../domain/store.js";
import { TrustService, trustCommands } from "../trust/commands.js";

export interface App {
  store: Store;
  trust: TrustService;
  bus: CommandBus;
}

export interface AppOptions {
  today?: () => IsoDate;
  store?: Store;
}

/** Composition root: one registry and one bus shared by the web app, REST API, MCP server and agents. */
export function createApp(opts: AppOptions = {}): App {
  const store = opts.store ?? new Store();
  const trust = new TrustService(store, WA_CALENDAR, opts.today);
  const registry = new Registry().register(...domainCommands(store), ...trustCommands(store, trust));
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
  return { store, trust, bus };
}

/** Opens an app over durable storage, restoring the working set and the audit chain. */
export async function openApp(persistence: Persistence, opts: Omit<AppOptions, "store"> = {}): Promise<App> {
  const store = await Store.open(persistence);
  const app = createApp({ ...opts, store });
  app.bus.audit.hydrate(await persistence.loadAudit());
  return app;
}
