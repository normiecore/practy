import { randomUUID } from "node:crypto";
import { z } from "zod";
import { settingsFor } from "../admin/settings.js";
import type { CommandBus } from "../core/bus.js";
import { conflict } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import type { SecretStore } from "../core/secrets.js";
import type { InvocationContext } from "../core/types.js";
import { CsvMatterImporter, type CsvMatterColumns } from "../connectors/importers/csv.js";
import { PracticePantherImporter } from "../connectors/importers/practicepanther.js";
import type { ImportedMatter, MatterImporter } from "../connectors/types.js";
import { tokenProvider } from "../core/secrets.js";
import { MATTER_NUMBER, visibleMatters } from "../domain/commands.js";
import type { KeyDate } from "../domain/model.js";
import type { Store } from "../domain/store.js";
import type { BoxCredentials, TrustExport } from "./factory.js";
import type { IntegrationHub } from "./hub.js";
import { connectionSecretName, refreshToken, type ConnectProvider } from "./oauth.js";

interface CalendarLink {
  id: string; // `${tenantId}:${keyDateId}:${userId}`
  tenantId: string;
  keyDateId: string;
  userId: string;
  eventId: string;
  syncedDate: string;
}

const TRUST_STAFF = ["principal", "accounts", "trust_authoriser"] as const;

export function integrationCommands(deps: { store: Store; secrets: SecretStore; hub: IntegrationHub; bus: CommandBus; providers: Map<string, ConnectProvider> }) {
  const { store, secrets, hub, bus, providers } = deps;
  const calendarLinks = store.collection<CalendarLink>("calendar_link");

  async function importMatters(importer: MatterImporter, ctx: InvocationContext, dryRun: boolean) {
    const rows = await importer.listMatters();
    const created: string[] = [];
    const skipped: { number: string; reason: string }[] = [];
    for (const row of rows) {
      const r = { ...row, number: row.number.trim() };
      if (!MATTER_NUMBER.test(r.number)) {
        skipped.push({ number: r.number, reason: "matter number must be letters, digits, '.', '_' or '-' with no spaces" });
        continue;
      }
      if (store.matterByNumber(ctx.actor.tenantId, r.number)) {
        skipped.push({ number: r.number, reason: "already in Practy" });
        continue;
      }
      if (dryRun) {
        created.push(r.number);
        continue;
      }
      const out = await bus.execute("create_matter", toCreateInput(r), ctx);
      if (out.status === "executed") {
        const matterId = (out.result as { matter: { id: string } }).matter.id;
        const m = store.matters.get(matterId)!;
        store.matters.set({ ...m, status: r.status, links: { ...m.links, externalId: r.externalId }, ...(r.openedOn ? { openedOn: r.openedOn } : {}) });
        created.push(r.number);
      }
    }
    return { total: rows.length, created: created.length, createdNumbers: created, skipped, dryRun };
  }

  return [
    defineCommand({
      name: "list_integrations",
      title: "Connected systems",
      description: "Which external systems are available and connected for you and for the firm.",
      tier: 0,
      input: z.object({}),
      handler: (_i, ctx) => {
        const s = settingsFor(store, ctx.actor.tenantId);
        return {
          connections: [...providers.values()].map((p) => ({
            id: p.id,
            label: p.label,
            scope: p.scope,
            connected: secrets.has(ctx.actor.tenantId, connectionSecretName(p, ctx.actor.userId)),
            connectUrl: `/integrations/connect/${p.id}`,
          })),
          documents: { store: s.documents.store, connected: !!hub.documents(ctx.actor.tenantId), boxCredentials: secrets.has(ctx.actor.tenantId, "box") },
          mail: { provider: s.mail.provider, filingMode: s.mail.filingMode, connected: !!hub.mail(ctx.actor.tenantId, ctx.actor.userId) },
          calendar: { provider: s.calendar.provider, connected: !!hub.calendar(ctx.actor.tenantId, ctx.actor.userId) },
          trust: { source: s.trust.source, configured: s.trust.source !== "none" && !!s.trust.opening },
        };
      },
    }),

    defineCommand({
      name: "set_box_credentials",
      title: "Box credentials",
      description: "Store the firm's Box app credentials (Client Credentials Grant). Encrypted at rest; never shown again.",
      tier: 1,
      roles: ["principal"],
      input: z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1), enterpriseId: z.string().optional(), userId: z.string().optional() }),
      handler: (creds, ctx) => {
        if (!creds.enterpriseId && !creds.userId) throw conflict("Provide the Box enterprise id or a service user id");
        secrets.set(ctx.actor.tenantId, "box", creds satisfies BoxCredentials);
        return { stored: true };
      },
    }),

    defineCommand({
      name: "upload_trust_export",
      title: "Upload trust cashbook export",
      description: "Upload the trust add-on's cashbook export (CSV) for the shadow ledger, when the trust account is not kept in Xero.",
      tier: 1,
      roles: [...TRUST_STAFF],
      input: z.object({ csv: z.string().min(1) }),
      handler: ({ csv }, ctx) => {
        const rec = store.collection<TrustExport>("trust_export").set({ id: randomUUID(), tenantId: ctx.actor.tenantId, csv, uploadedAt: new Date().toISOString(), uploadedBy: ctx.actor.userId });
        return { id: rec.id, rows: csv.trim().split(/\r?\n/).length - 1 };
      },
    }),

    defineCommand({
      name: "import_matters_csv",
      title: "Import matters from CSV",
      description: "Import matters from a CSV export (e.g. a PracticePanther matter report). Existing matter numbers are skipped. Use dryRun to preview.",
      tier: 1,
      roles: ["principal"],
      input: z.object({
        csv: z.string().min(1),
        columns: z.record(z.string(), z.unknown()).describe("CSV column mapping (header names): number, clientName, and optional title, matterType, status, openedOn, injuryDate, clientEmail, clientDateOfBirth, otherParties[]"),
        dryRun: z.boolean().default(true),
      }),
      handler: ({ csv, columns, dryRun }, ctx) => importMatters(new CsvMatterImporter({ text: csv, columns: columns as unknown as CsvMatterColumns }), ctx, dryRun),
    }),

    defineCommand({
      name: "import_matters_practicepanther",
      title: "Import matters from PracticePanther",
      description: "Import matters from the connected PracticePanther account. Existing matter numbers are skipped. Use dryRun to preview.",
      tier: 1,
      roles: ["principal"],
      input: z.object({ dryRun: z.boolean().default(true), status: z.enum(["Open", "Pending", "Closed"]).optional() }),
      handler: ({ dryRun, status }, ctx) => {
        const p = providers.get("practicepanther");
        if (!p || !secrets.has(ctx.actor.tenantId, "practicepanther")) throw conflict("Connect PracticePanther first (Settings → Integrations)");
        const getAccessToken = tokenProvider(secrets, ctx.actor.tenantId, "practicepanther", (rt) => refreshToken(p, rt));
        return importMatters(new PracticePantherImporter({ getAccessToken, status }), ctx, dryRun);
      },
    }),

    defineCommand({
      name: "sync_calendar",
      title: "Sync key dates to my calendar",
      description: "Put confirmed key dates for your matters (responsible solicitor) into your connected calendar. Proposed dates are never synced.",
      tier: 1,
      input: z.object({ allVisible: z.boolean().default(false) }),
      handler: async ({ allVisible }, ctx) => {
        const cal = hub.calendar(ctx.actor.tenantId, ctx.actor.userId);
        if (!cal) throw conflict("Connect your calendar first (Settings → Integrations)");
        const matters = visibleMatters(store, ctx).filter((m) => m.status === "open" && (allVisible || m.responsibleUserId === ctx.actor.userId));
        let synced = 0;
        for (const m of matters) {
          for (const kd of store.keyDatesFor(ctx.actor.tenantId, m.id) as KeyDate[]) {
            if (kd.status !== "confirmed" || !kd.date) continue;
            const linkId = `${ctx.actor.tenantId}:${kd.id}:${ctx.actor.userId}`;
            if (calendarLinks.get(linkId)?.syncedDate === kd.date) continue;
            const eventId = await cal.upsert({
              practyId: kd.id,
              title: `${m.number} ${m.title}: ${kd.title}`,
              date: kd.date,
              description: `${kd.kind.toUpperCase()} · ${kd.source}\n${kd.notes.join("\n")}\nPracty matter ${m.number}`,
              reminders: kd.kind === "critical" ? [60 * 24 * 28, 60 * 24 * 7, 60 * 24] : [60 * 24],
            });
            calendarLinks.set({ id: linkId, tenantId: ctx.actor.tenantId, keyDateId: kd.id, userId: ctx.actor.userId, eventId, syncedDate: kd.date });
            synced++;
          }
        }
        return { synced };
      },
    }),

    defineCommand({
      name: "daily_digest",
      title: "Daily digest",
      description: "Your day: overdue and upcoming key dates, approvals waiting, emails to review and unconfirmed dates.",
      tier: 0,
      input: z.object({ days: z.number().int().positive().max(90).default(14) }),
      handler: ({ days }, ctx) => {
        const today = new Date().toISOString().slice(0, 10);
        const horizon = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
        const visible = visibleMatters(store, ctx);
        const visibleIds = new Set(visible.map((m) => m.id));
        const matters = new Map(visible.filter((m) => m.status === "open").map((m) => [m.id, m]));
        const dates = store.keyDates.list(ctx.actor.tenantId, (k) => matters.has(k.matterId) && k.status !== "dismissed");
        const withMatter = (k: KeyDate) => ({ ...k, matterNumber: matters.get(k.matterId)!.number, matterTitle: matters.get(k.matterId)!.title });
        return {
          overdue: dates.filter((k) => k.date && k.date < today).map(withMatter),
          upcoming: dates.filter((k) => k.date && k.date >= today && k.date <= horizon).sort((a, b) => a.date!.localeCompare(b.date!)).map(withMatter),
          needsAttention: dates.filter((k) => k.status === "proposed" || k.status === "manual_required").map(withMatter),
          approvalsPending: bus.approvals.list(ctx.actor.tenantId, "pending").length,
          tasksDue: store
            .collection<{ id: string; tenantId: string; assigneeId: string; status: string; dueOn?: string; title: string; matterId?: string }>("task")
            .list(ctx.actor.tenantId, (t) => t.assigneeId === ctx.actor.userId && t.status === "open" && !!t.dueOn && t.dueOn <= horizon && (!t.matterId || visibleIds.has(t.matterId)))
            .sort((a, b) => a.dueOn!.localeCompare(b.dueOn!)),
          emailsToReview: store.collection<{ id: string; tenantId: string; userId: string; status: string }>("mail_item").list(ctx.actor.tenantId, (i) => i.userId === ctx.actor.userId && i.status === "review").length,
        };
      },
    }),
  ];
}

function toCreateInput(r: ImportedMatter) {
  return {
    number: r.number,
    title: r.title || r.client.name,
    scheme: r.scheme ?? "other",
    ...(r.injuryDate ? { injuryDate: r.injuryDate } : {}),
    client: {
      name: r.client.name,
      ...(r.client.dateOfBirth ? { dateOfBirth: r.client.dateOfBirth } : {}),
      ...(r.client.email && /@/.test(r.client.email) ? { email: r.client.email } : {}),
      ...(r.client.phone ? { phone: r.client.phone } : {}),
      ...(r.client.address ? { address: r.client.address } : {}),
    },
    otherParties: r.otherParties
      .filter((p) => p.name)
      .map((p) => ({ name: p.name, role: (["defendant", "insurer", "employer", "driver", "witness"].includes(p.role) ? p.role : "other") as "other" })),
  };
}
