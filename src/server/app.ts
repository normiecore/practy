import { ApprovalStore } from "../core/approvals.js";
import { AuditLog } from "../core/audit.js";
import { CommandBus } from "../core/bus.js";
import { WA_CALENDAR, type IsoDate } from "../core/calendar.js";
import { Registry } from "../core/registry.js";
import { domainCommands, matterGuard } from "../domain/commands.js";
import { Store } from "../domain/store.js";
import { TrustService, trustCommands } from "../trust/commands.js";

export interface App {
  store: Store;
  trust: TrustService;
  bus: CommandBus;
}

/** Composition root: one registry and one bus shared by the REST API, MCP server and (later) web UI. */
export function createApp(opts: { today?: () => IsoDate } = {}): App {
  const store = new Store();
  const trust = new TrustService(store, WA_CALENDAR, opts.today);
  const registry = new Registry().register(...domainCommands(store), ...trustCommands(store, trust));
  const bus = new CommandBus(registry, new AuditLog(), new ApprovalStore(), matterGuard(store));
  return { store, trust, bus };
}
