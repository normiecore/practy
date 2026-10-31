import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { User } from "../auth/model.js";
import { revokeUserAccess } from "../auth/sessions.js";
import { conflict, invalid, notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import type { Role } from "../core/types.js";
import type { Store } from "../domain/store.js";
import { deepMerge, settingsFor, tenantSettingsSchema, type TenantSettings } from "./settings.js";

const ROLES = ["principal", "solicitor", "paralegal", "accounts", "trust_authoriser"] as const satisfies readonly Role[];

export const usersOf = (store: Store) => store.collection<User>("user");

export function findUserByEmail(store: Store, email: string): User | undefined {
  const e = email.toLowerCase();
  for (const u of usersOf(store).values()) if (u.email === e) return u;
  return undefined;
}

export function adminCommands(store: Store) {
  const settings = store.collection<TenantSettings>("tenant_settings");
  /** The settings a patch would produce, refused with located issues if any value is the wrong shape. */
  const mergedSettings = (tenantId: string, patch: Record<string, unknown>): TenantSettings => {
    const { id: _i, tenantId: _t, updatedAt: _u, ...safe } = patch;
    const next = { ...deepMerge(settingsFor(store, tenantId), safe), id: tenantId, tenantId };
    const checked = tenantSettingsSchema.safeParse(next);
    if (!checked.success) {
      throw invalid(
        z.prettifyError(checked.error),
        // Paths are given as they sit inside `patch`, matching the command input.
        checked.error.issues.map((i) => ({ path: ["patch", ...i.path.map(String)].join("."), message: i.message })),
      );
    }
    return next;
  };
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
      // Checked when requested, so a mistake is refused before it reaches the approver, and again when approved.
      precheck: ({ patch }, ctx) => void mergedSettings(ctx.actor.tenantId, patch),
      handler: ({ patch }, ctx) => settings.set({ ...mergedSettings(ctx.actor.tenantId, patch), updatedAt: new Date().toISOString() }),
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
      description:
        "Create or update a staff account (email, roles, fee-earner category, active). Deactivating a user also ends their sign-in sessions, disconnects their AI clients and revokes their API keys. Requires principal approval.",
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
        const user = usersOf(store).set({
          id: existing?.id ?? randomUUID(),
          tenantId: ctx.actor.tenantId,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          ...existing,
          ...input,
          email,
        });
        // An inactive user cannot authenticate anyway; ending everything now means reactivating them later revives nothing.
        if (!user.active) revokeUserAccess(store, user.tenantId, user.id, "deactivated");
        return user;
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
