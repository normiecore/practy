import { randomUUID } from "node:crypto";
import { z } from "zod";
import { WA_CALENDAR, type WorkingCalendar } from "../core/calendar.js";
import { invalid, notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import { AI_SURFACES, type InvocationContext } from "../core/types.js";
import type { Store } from "../domain/store.js";
import { COSTS_BASES, coolingOffEnd, disclosureRequirement, estimateExceeded, validateCostsTerms } from "./disclosure.js";
import { FEE_CATEGORIES, FORUMS, determinationFor, rateFor } from "./scales.js";
import { estimateDraftingUnits, estimateEmailUnits, estimatePerusalUnits, timesheetSummary, type TimeEntry, type UnitEstimate } from "./time.js";

const isoDate = z.iso.date();
const amount = z.number().int().nonnegative();
const STAFF = ["principal", "solicitor", "paralegal"] as const;

const unitsFrom = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), direction: z.enum(["sent", "received"]), words: z.number().int().nonnegative(), internal: z.boolean().optional(), automated: z.boolean().optional() }),
  z.object({ kind: z.literal("perusal"), pages: z.number().positive(), density: z.enum(["dense", "medium", "light", "clinical", "certificate"]), unitsPerPage: z.number().positive().optional() }),
  z.object({ kind: z.literal("drafting"), pages: z.number().positive(), settlingUnits: z.number().int().nonnegative().optional() }),
  z.object({ kind: z.literal("form"), complex: z.boolean().optional() }),
]);

const entryInput = z.object({
  feeEarnerId: z.string().optional().describe("Defaults to the caller"),
  feeEarnerName: z.string().optional(),
  category: z.enum(FEE_CATEGORIES),
  forum: z.enum(FORUMS).default("court"),
  date: isoDate.describe("Date the work was done (selects the scale)"),
  units: z.number().int().positive().optional().describe("6-minute units; or give unitsFrom to apply the firm's heuristics"),
  unitsFrom: unitsFrom.optional(),
  description: z.string().min(1),
  sourceRef: z.string().optional(),
  claimable: z.boolean().optional(),
  partyParty: z.boolean().optional(),
  scaleItem: z.string().optional().describe('Table B item key, e.g. "preparation", "statement_of_claim"'),
  aiAssisted: z.boolean().optional().describe("Defaults to true when proposed from an AI surface"),
  estimate: z.boolean().optional().describe("Future attendance or unbilled work"),
});

function unitsEstimate(u: z.infer<typeof unitsFrom>): UnitEstimate {
  switch (u.kind) {
    case "email":
      return estimateEmailUnits(u);
    case "perusal":
      return estimatePerusalUnits(u);
    case "drafting":
      return estimateDraftingUnits({ kind: "dense", pages: u.pages, ...(u.settlingUnits !== undefined ? { settlingUnits: u.settlingUnits } : {}) });
    case "form":
      return estimateDraftingUnits({ kind: "form", ...(u.complex !== undefined ? { complex: u.complex } : {}) });
  }
}

export function costsCommands(store: Store, opts: { calendar?: WorkingCalendar } = {}) {
  const entries = store.collection<TimeEntry>("time_entry");
  const calendar = opts.calendar ?? WA_CALENDAR;
  const forMatter = (ctx: InvocationContext, matterId: string) => entries.list(ctx.actor.tenantId, (e) => e.matterId === matterId);
  const requireMatter = (ctx: InvocationContext, id: string) => {
    if (!store.matters.find(ctx.actor.tenantId, id)) throw notFound(`Matter ${id}`);
  };

  return [
    defineCommand({
      name: "propose_time_entry",
      title: "Propose time entries",
      description:
        "Propose 6-minute time entries for a matter. Units can be given directly or estimated with the firm's heuristics (emails ~120 words/unit sent, ~350 received, minimum 1; perusal by page density; drafting ~4 units a page). Entries stay proposed until a practitioner approves them.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ matterId: z.string(), entries: z.array(entryInput).min(1) }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, entries: drafts }, ctx) => {
        requireMatter(ctx, matterId);
        const now = new Date().toISOString();
        const prepared = drafts.map((d, i) => {
          const est = d.unitsFrom ? unitsEstimate(d.unitsFrom) : undefined;
          const units = d.units ?? est?.units;
          if (!units) throw invalid(`Entry ${i + 1}: give units or unitsFrom`);
          try {
            rateFor(d.category, d.date, d.forum);
          } catch (err) {
            throw invalid(`Entry ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
          }
          if (d.scaleItem && !determinationFor(d.date, d.forum)?.items.some((it) => it.key === d.scaleItem)) {
            throw invalid(`Entry ${i + 1}: unknown scale item ${d.scaleItem} for ${d.forum} work on ${d.date}`);
          }
          const entry: TimeEntry = {
            id: randomUUID(),
            tenantId: ctx.actor.tenantId,
            matterId,
            feeEarnerId: d.feeEarnerId ?? ctx.actor.userId,
            ...(d.feeEarnerName ? { feeEarnerName: d.feeEarnerName } : d.feeEarnerId ? {} : { feeEarnerName: ctx.actor.displayName }),
            category: d.category,
            forum: d.forum,
            date: d.date,
            units,
            description: est && !d.units ? `${d.description} [${est.rationale}]` : d.description,
            ...(d.sourceRef ? { sourceRef: d.sourceRef } : {}),
            claimable: d.claimable ?? est?.claimable ?? true,
            ...(d.partyParty !== undefined ? { partyParty: d.partyParty } : {}),
            ...(d.scaleItem ? { scaleItem: d.scaleItem } : {}),
            status: "proposed",
            aiAssisted: d.aiAssisted ?? AI_SURFACES.includes(ctx.surface),
            ...(d.estimate ? { estimate: true } : {}),
            proposedBy: ctx.actor.userId,
            proposedAt: now,
          };
          return entry;
        });
        // Validate everything before writing anything.
        return prepared.map((e) => entries.set(e));
      },
    }),

    defineCommand({
      name: "list_time_entries",
      title: "List time entries",
      description: "Time entries for a matter, oldest first.",
      tier: 0,
      input: z.object({ matterId: z.string(), status: z.enum(["proposed", "approved"]).optional() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, status }, ctx) =>
        forMatter(ctx, matterId)
          .filter((e) => !status || e.status === status)
          .sort((a, b) => a.date.localeCompare(b.date)),
    }),

    defineCommand({
      name: "approve_time_entries",
      title: "Approve time entries",
      description: "Approve proposed time entries so they can be billed. Requires practitioner approval in Practy.",
      tier: 2,
      input: z.object({ matterId: z.string(), entryIds: z.array(z.string()).min(1) }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, entryIds }, ctx) => {
        const found = entryIds.map((id) => {
          const e = entries.find(ctx.actor.tenantId, id);
          if (!e || e.matterId !== matterId) throw notFound(`Time entry ${id}`);
          return e;
        });
        const at = new Date().toISOString();
        return found.map((e) => entries.set({ ...e, status: "approved", approvedBy: ctx.actor.userId, approvedAt: at }));
      },
    }),

    defineCommand({
      name: "timesheet_summary",
      title: "Timesheet summary",
      description:
        "Timesheet for a matter: each entry at the scale rate in force on its work date, totals by fee earner and by Table B item with item caps (SP-equivalent hours across Determinations), and non-claimable rows separated.",
      tier: 0,
      input: z.object({
        matterId: z.string(),
        status: z.enum(["proposed", "approved", "all"]).default("all"),
        from: isoDate.optional(),
        to: isoDate.optional(),
      }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, status, from, to }, ctx) =>
        timesheetSummary(
          forMatter(ctx, matterId).filter(
            (e) => (status === "all" || e.status === status) && (!from || e.date >= from) && (!to || e.date <= to),
          ),
        ),
    }),

    defineCommand({
      name: "check_costs_disclosure",
      title: "Check costs disclosure",
      description:
        "Uniform Law costs checks: the disclosure required for an estimate (none under $750, standard form under $3,000, else full s 174), costs terms (uplift at most 25%, only in a conditional agreement; contingency fees prohibited), WIP plus disbursements against the estimate, and the cooling-off end date.",
      tier: 0,
      input: z.object({
        matterId: z.string().optional(),
        estimateCents: amount,
        terms: z
          .object({ basis: z.enum(COSTS_BASES), upliftPercent: z.number().nonnegative().optional(), percentageOfRecovery: z.number().nonnegative().optional() })
          .optional(),
        wipCents: amount.optional().describe("Defaults to the matter's claimable time value"),
        disbursementsCents: amount.default(0),
        thresholdPct: z.number().positive().max(100).default(80),
        agreementDate: isoDate.optional(),
      }),
      matterIds: (i) => (i.matterId ? [i.matterId] : []),
      handler: ({ matterId, estimateCents, terms, wipCents, disbursementsCents, thresholdPct, agreementDate }, ctx) => {
        const wip = wipCents ?? (matterId ? timesheetSummary(forMatter(ctx, matterId)).totals.claimableValueCents : undefined);
        return {
          requirement: disclosureRequirement(estimateCents),
          ...(terms ? { terms: validateCostsTerms(terms) } : {}),
          ...(wip !== undefined ? { estimate: estimateExceeded({ wipCents: wip, disbursementsCents, estimateCents, thresholdPct }) } : {}),
          ...(agreementDate ? { coolingOff: coolingOffEnd(agreementDate, calendar) } : {}),
        };
      },
    }),
  ];
}
