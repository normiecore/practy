import type { Actor, InvocationContext, Surface } from "../src/core/types.js";
import { createApp } from "../src/server/app.js";

export const TENANT = "t-soul";

export const users = {
  principal: { userId: "u-kw", tenantId: TENANT, displayName: "Principal", roles: ["principal", "trust_authoriser"] },
  solicitor: { userId: "u-sol", tenantId: TENANT, displayName: "Solicitor", roles: ["solicitor"] },
  paralegal: { userId: "u-para", tenantId: TENANT, displayName: "Paralegal", roles: ["paralegal"] },
  accounts: { userId: "u-acc", tenantId: TENANT, displayName: "Accounts", roles: ["accounts", "trust_authoriser"] },
  outsider: { userId: "u-x", tenantId: "t-other", displayName: "Other firm", roles: ["principal"] },
} satisfies Record<string, Actor>;

export const as = (actor: Actor, surface: Surface = "ui"): InvocationContext => ({ actor, surface });

export function setup(today = "2026-11-03") {
  const app = createApp({ today: () => today });
  const run = async (name: string, input: unknown, ctx: InvocationContext) => {
    const out = await app.bus.execute(name, input, ctx);
    return out;
  };
  const exec = async <T = any>(name: string, input: unknown, ctx: InvocationContext): Promise<T> => {
    const out = await run(name, input, ctx);
    if (out.status !== "executed") throw new Error(`${name} did not execute: ${out.status}`);
    return out.result as T;
  };
  return { app, run, exec };
}

export async function openMatter(
  exec: ReturnType<typeof setup>["exec"],
  overrides: Record<string, unknown> = {},
) {
  return exec(
    "create_matter",
    {
      number: "SL-1998",
      title: "Priestley v ICWA",
      scheme: "icwa_mva",
      injuryDate: "2025-03-14",
      client: { name: "Toni Priestley", dateOfBirth: "1990-05-01" },
      otherParties: [{ name: "Insurance Commission of Western Australia", role: "insurer", kind: "organisation" }],
      ...overrides,
    },
    as(users.solicitor),
  );
}
