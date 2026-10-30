import type { z } from "zod";
import type { InvocationContext, Role, Tier } from "./types.js";

export interface CommandDef<I extends z.ZodObject = z.ZodObject, O = unknown> {
  name: string;
  title: string;
  description: string;
  tier: Tier;
  input: I;
  /** Roles allowed to invoke. Empty means any authenticated user. */
  roles?: Role[];
  /**
   * Roles allowed to approve a tier 2/3 request. Tier 3 needs two distinct approvers.
   * Defaults to principal/solicitor for tier 2 and trust_authoriser for tier 3.
   */
  approverRoles?: Role[];
  /**
   * Deliberately unavailable on AI surfaces (approval decisions). This is the only
   * exception to UI/API/MCP parity and is asserted in tests.
   */
  humanOnly?: boolean;
  /** Matters touched by this input; used for walls, no-AI flags and the AI-use log. */
  matterIds?: (input: z.infer<I>) => string[];
  handler: (input: z.infer<I>, ctx: InvocationContext) => O | Promise<O>;
}

export function defineCommand<I extends z.ZodObject, O>(def: CommandDef<I, O>): CommandDef<I, O> {
  return def;
}

export class Registry {
  private readonly commands = new Map<string, CommandDef>();

  register(...defs: CommandDef<any, any>[]): this {
    for (const def of defs) {
      if (this.commands.has(def.name)) throw new Error(`Duplicate command ${def.name}`);
      if (!/^[a-z][a-z0-9_]*$/.test(def.name)) throw new Error(`Bad command name ${def.name}`);
      this.commands.set(def.name, def as CommandDef);
    }
    return this;
  }

  get(name: string): CommandDef | undefined {
    return this.commands.get(name);
  }

  all(): CommandDef[] {
    return [...this.commands.values()];
  }
}
