import { ApprovalStore, type Approval } from "../../src/core/approvals.js";
import { AuditLog } from "../../src/core/audit.js";
import { CommandBus } from "../../src/core/bus.js";
import { Registry } from "../../src/core/registry.js";
import type { InvocationContext } from "../../src/core/types.js";
import { costsCommands } from "../../src/costs/commands.js";
import { damagesCommands } from "../../src/damages/commands.js";
import { matterGuard } from "../../src/domain/commands.js";
import { openMatter, setup } from "../helpers.js";

/** The app as built by createApp, plus a local bus carrying the damages and costs commands (app.ts is untouched). */
export async function pilotBus() {
  const t = setup();
  const { matter } = await openMatter(t.exec);
  const store = t.app.store;
  const registry = new Registry().register(...damagesCommands(store), ...costsCommands(store));
  const bus = new CommandBus(registry, new AuditLog(), new ApprovalStore(store.collection<Approval>("approval")), matterGuard(store), () => store.flush());
  const exec = async <T = any>(name: string, input: unknown, ctx: InvocationContext): Promise<T> => {
    const out = await bus.execute(name, input, ctx);
    if (out.status !== "executed") throw new Error(`${name} did not execute: ${out.status}`);
    return out.result as T;
  };
  return { ...t, bus, exec, matter, store };
}

