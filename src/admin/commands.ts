import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { User } from "../auth/model.js";
import { conflict, notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import type { Role } from "../core/types.js";
import type { Store } from "../domain/store.js";
import { deepMerge, settingsFor, type TenantSettings } from "./settings.js";

const ROLES = ["principal", "solicitor", "paralegal", "accounts", "trust_authoriser"] as const satisfies readonly Role[];

export const usersOf = (store: Store) => store.collection<User>("user");

export function findUserByEmail(store: Store, email: string): User | undefined {
  const e = email.toLowerCase();
  for (const u of usersOf(store).values()) if (u.email === e) return u;
  return undefined;
}

export function adminCommands(store: Store) {
  const settings = store.collection<TenantSettings>("tenant_settings");
  return [
    defineCommand({
      name: "whoami",
      title: "Who am I",
      description: "The signed-in user, their roles and the surface they are using.",
      tier: 0,
      input: z.object({}),
      handler: (_i, ctx) => ({ ...ctx.actor, surface: ctx.surface }),
    }),

    defineCommand({
      name: "get_settings",
      title: "Firm settings",
      description: "Firm configuration (integrations, AI policy, filing mode, firm policies). Contains no secrets.",
      tier: 0,
      input: z.object({}),
      handler: (_i, ctx) => settingsFor(store, ctx.actor.tenantId),
    }),

    defineCommand({
      name: "update_settings",
      title: "Update firm settings",
      description: "Change firm configuration (partial update). Requires principal approval.",
      tier: 2,
      roles: ["principal"],
      approverRoles: ["principal"],
      input: z.object({ patch: z.record(z.string(), z.unknown()) }),
      handler: ({ patch }, ctx) => {
        const { id: _i, tenantId: _t, ...safe } = patch;
        const next = deepMerge(settingsFor(store, ctx.actor.tenantId), safe);
        return settings.set({ ...next, id: ctx.actor.tenantId, tenantId: ctx.actor.tenantId, updatedAt: new Date().toISOString() });
      },
    }),

    defineCommand({
      name: "list_users",
      title: "List users",
      description: "Staff accounts with roles and fee-earner categories.",
      tier: 0,
      input: z.object({ includeInactive: z.boolean().default(false) }),
      handler: ({ includeInactive }, ctx) => usersOf(store).list(ctx.actor.tenantId, (u) => includeInactive || u.active),
    }),

    defineCommand({
      name: "upsert_user",
      title: "Add or update a user",
      description: "Create or update a staff account (email, roles, fee-earner category, active). Requires principal approval.",
      tier: 2,
      roles: ["principal"],
      approverRoles: ["principal"],
      input: z.object({
        email: z.email(),
        displayName: z.string().min(1),
        roles: z.array(z.enum(ROLES)).min(1),
        feeEarnerCategory: z.enum(["SP", "JP", "CPL"]).optional(),
        active: z.boolean().default(true),
      }),
      handler: (input, ctx) => {
        const email = input.email.toLowerCase();
        const existing = findUserByEmail(store, email);
        if (existing && existing.tenantId !== ctx.actor.tenantId) throw conflict("Email belongs to another firm");
        return usersOf(store).set({
          id: existing?.id ?? randomUUID(),
          tenantId: ctx.actor.tenantId,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          ...existing,
          ...input,
          email,
        });
      },
    }),

    defineCommand({
      name: "get_user",
      title: "Get user",
      description: "One staff account.",
      tier: 0,
      input: z.object({ userId: z.string() }),
      handler: ({ userId }, ctx) => {
        const u = usersOf(store).find(ctx.actor.tenantId, userId);
        if (!u) throw notFound("User");
        return u;
      },
    }),
  ];
}
