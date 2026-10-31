import { randomUUID } from "node:crypto";
import { z } from "zod";
import { settingsFor } from "../admin/settings.js";
import type { Entity } from "../core/collection.js";
import { conflict, invalid, notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import type { InvocationContext } from "../core/types.js";
import type { Matter } from "../domain/model.js";
import type { Store } from "../domain/store.js";
import {
  CLEARANCE_KINDS,
  applyClearanceEvent,
  centrelinkPreclusionEstimate,
  clearanceBlockers,
  newClearance,
  type Clearance,
} from "./clearances.js";
import { auditDamages, computeDamages, type AuditWarning, type DamagesInput, type DamagesModel } from "./engine.js";
import { fmtDate } from "./money.js";
import { DAMAGES_DEFAULTS } from "./tables.js";
import { computeAuthority, computeSettlementStatement, type AuthorityInput, type AuthorityResult, type SettlementStatement } from "./settlement.js";

const isoDate = z.iso.date();
const cents = z.number().int();
const amount = cents.nonnegative();
const period = { from: isoDate, to: isoDate };
const STAFF = ["principal", "solicitor", "paralegal"] as const;

export interface StoredDamages extends Entity {
  matterId: string;
  version: number;
  status: "draft";
  input: DamagesInput;
  model: DamagesModel;
  audit: AuditWarning[];
  note?: string;
  createdBy: string;
  createdAt: string;
}

export interface StoredAuthority extends Entity {
  matterId: string;
  version: number;
  status: "draft";
  input: AuthorityInput;
  result: AuthorityResult;
  statement: SettlementStatement;
  createdBy: string;
  createdAt: string;
}

const damagesInput = z.object({
  matterId: z.string(),
  scheme: z.enum(["icwa_mva", "workcover_wa", "public_liability", "medical_negligence", "other"]).optional().describe("Defaults to the matter's scheme"),
  wpiPercent: z.number().min(0).max(100).optional(),
  plaintiff: z.object({
    name: z.string().optional(),
    dateOfBirth: isoDate.optional().describe("Defaults to the client's recorded date of birth"),
    sex: z.enum(["male", "female"]),
    background: z.string().optional().describe('As instructed or as the evidence shows, e.g. "manual work background"'),
  }),
  injuryDate: isoDate.optional().describe("Defaults to the matter's injury date"),
  calculationDate: isoDate,
  preInjuryEarnings: z.object({
    grossWeeklyCents: amount.optional(),
    grossAnnualCents: amount.optional(),
    source: z.string().optional(),
  }),
  weeklyPayments: z.array(z.object({ ...period, grossPaidCents: amount, payer: z.string(), source: z.string().optional() })).optional(),
  unindemnifiedPeriods: z.array(z.object({ ...period, grossWeeklyCents: amount.optional(), note: z.string().optional() })).optional(),
  pastSuperFrom: isoDate.optional(),
  specialDamages: z
    .array(
      z.object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        period: z.string().optional(),
        providerPayer: z.string(),
        item: z.string(),
        amountCents: amount,
        paidBy: z.enum(["insurer", "plaintiff"]),
      }),
    )
    .optional(),
  pastGratuitousServices: z
    .array(z.object({ ...period, provider: z.string(), service: z.string(), hourlyRateCents: amount, hoursPerWeek: z.number().nonnegative(), hoursDescription: z.string().optional() }))
    .optional(),
  futureMedical: z
    .array(z.object({ service: z.string(), costCents: amount, frequencyPerYear: z.number().nonnegative(), frequency: z.string().optional(), evidence: z.string().optional() }))
    .optional(),
  futureCare: z
    .array(z.object({ description: z.string().optional(), hourlyRateCents: amount, hoursPerWeek: z.number().nonnegative(), hoursDescription: z.string().optional(), evidence: z.string().optional() }))
    .optional(),
  aids: z.array(z.object({ item: z.string(), amountCents: amount, note: z.string().optional() })).optional(),
  otherItems: z.array(z.object({ item: z.string(), amountCents: amount, calculation: z.string().optional() })).optional(),
  generalDamagesCents: amount.nullable().describe("Set by the practitioner. Null leaves a marked placeholder; never invent a figure."),
  lifeExpectancy: z.object({
    years: z.number().positive(),
    citation: z.string().min(1).describe('e.g. "ABS Life Tables, Western Australia, 2022 to 2024"'),
  }),
  multiplierYears: z.object({ earnings: z.number().nonnegative().optional(), lifetime: z.number().nonnegative().optional() }).optional(),
  futureLossPercent: z.number().min(0).max(100).optional(),
  jongenPercent: z.number().min(15).max(30).optional(),
  contingencyPercent: z.number().min(0).max(100).optional(),
  interestPercent: z.number().min(0).max(100).optional(),
  s424CapCents: amount.optional(),
  note: z.string().optional(),
});

const authorityInput = z.object({
  matterId: z.string(),
  clientName: z.string().optional().describe("Defaults to the matter's client"),
  injuryDate: z.string().optional().describe("As shown on the form (d/m/yyyy); defaults to the matter's injury date"),
  solicitor: z.string().optional(),
  settlementOfferCents: amount,
  legalCostsCents: amount.optional(),
  disbursementsCents: amount.optional(),
  medicalAccountsCents: amount.optional(),
  medicareContributionCents: amount.optional(),
  medicalAccountsPaidByClient: z.boolean().optional(),
  clientPaidDisbursements: z.boolean().optional(),
  taxCents: amount.optional(),
  centrelink: z.union([z.string(), amount]).optional().describe('Text (default "to be ascertained") or cents'),
  workersCompRefundCents: amount.optional(),
  legalAidRefundCents: amount.nullable().optional(),
  otherSolicitorsFeesCents: amount.optional(),
  otherDebtsCents: amount.optional(),
  residualTrustCents: amount.optional(),
  otherTerms: z.string().optional(),
  feesLabel: z.string().optional().describe("Label of the firm-fees row on the firm's Authority to Settle form. Defaults to \"<firm name> fees\" from the firm settings."),
});

const clearanceEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("requested"), date: isoDate, reference: z.string().optional() }),
  z.object({ type: z.literal("nopb_received"), issueDate: isoDate, pastBenefitsCents: amount.optional() }),
  z.object({ type: z.literal("mo022_lodged"), date: isoDate }),
  z.object({
    type: z.literal("charge_received"),
    date: isoDate,
    amountCents: amount,
    preclusion: z.object(period).optional(),
    compensationReductionCents: amount.optional(),
  }),
  z.object({ type: z.literal("paid"), date: isoDate, amountCents: amount.optional() }),
  z.object({ type: z.literal("not_applicable"), reason: z.string().min(1) }),
]);

/** Engine errors are input problems: report them as invalid, not as server faults. */
function engine<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw invalid(err instanceof Error ? err.message : String(err));
  }
}

function nextVersion<T extends Entity & { matterId: string; version: number }>(items: T[], matterId: string): number {
  return items.filter((i) => i.matterId === matterId).reduce((m, i) => Math.max(m, i.version), 0) + 1;
}

export function damagesCommands(store: Store) {
  const models = store.collection<StoredDamages>("damages_model");
  const authorities = store.collection<StoredAuthority>("authority_draft");
  const clearances = store.collection<Clearance>("clearance");

  const getMatter = (ctx: InvocationContext, id: string): Matter => {
    const m = store.matters.find(ctx.actor.tenantId, id);
    if (!m) throw notFound(`Matter ${id}`);
    return m;
  };
  const clientOf = (m: Matter) => {
    const link = m.parties.find((p) => p.role === "client");
    return link ? store.parties.get(link.partyId) : undefined;
  };
  const matterClearances = (ctx: InvocationContext, matterId: string) =>
    clearances.list(ctx.actor.tenantId, (c) => c.matterId === matterId);

  return [
    defineCommand({
      name: "compute_damages",
      title: "Compute particulars of damages",
      description:
        "Compute a plaintiff's particulars of damages (r 45C(3), Stott CPC-A1 heads) using the firm's rules: net = gross less income tax only, SG by year, Jongen 15%, 6% weekly multipliers (whole years), 5% contingencies, 3% interest on the plaintiff's own losses. Saves a new draft version for the matter and runs the accuracy audit. General damages are never invented.",
      tier: 1,
      roles: [...STAFF],
      input: damagesInput,
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, note, ...raw }, ctx) => {
        const matter = getMatter(ctx, matterId);
        const dateOfBirth = raw.plaintiff.dateOfBirth ?? clientOf(matter)?.dateOfBirth;
        if (!dateOfBirth) throw invalid("Plaintiff date of birth is needed (not recorded on the client)");
        const input: DamagesInput = {
          ...raw,
          scheme: raw.scheme ?? matter.scheme,
          injuryDate: raw.injuryDate ?? matter.injuryDate ?? (() => { throw invalid("Record the date of injury on the matter first"); })(),
          plaintiff: { ...raw.plaintiff, dateOfBirth, name: raw.plaintiff.name ?? clientOf(matter)?.name },
        } as DamagesInput;
        const model = engine(() => computeDamages(input));
        const stored: StoredDamages = {
          id: randomUUID(),
          tenantId: ctx.actor.tenantId,
          matterId,
          version: nextVersion(models.list(ctx.actor.tenantId), matterId),
          status: "draft",
          input,
          model,
          audit: auditDamages(model, input),
          ...(note ? { note } : {}),
          createdBy: ctx.actor.userId,
          createdAt: new Date().toISOString(),
        };
        return models.set(stored);
      },
    }),

    defineCommand({
      name: "get_damages_defaults",
      title: "Damages defaults",
      description:
        "The firm's standing damages parameters (Jongen discount and its allowed range, contingencies, interest, the weekly divisor and working-life age), each with its source. compute_damages uses these for any parameter left out.",
      tier: 0,
      input: z.object({}),
      handler: () => ({
        jongenPercent: DAMAGES_DEFAULTS.jongenPercent,
        jongenRange: { ...DAMAGES_DEFAULTS.jongenRange, value: [...DAMAGES_DEFAULTS.jongenRange.value] },
        contingencyPercent: DAMAGES_DEFAULTS.contingencyPercent,
        interestPercent: DAMAGES_DEFAULTS.interestPercent,
        weeklyDivisor: { ...DAMAGES_DEFAULTS.weeklyDivisorHundredths, value: DAMAGES_DEFAULTS.weeklyDivisorHundredths.value / 100 },
        workingLifeAge: DAMAGES_DEFAULTS.workingLifeAge,
      }),
    }),

    defineCommand({
      name: "get_damages",
      title: "Get particulars of damages",
      description: "The latest (or a given) draft damages model for a matter, with its audit warnings and the list of versions.",
      tier: 0,
      input: z.object({ matterId: z.string(), version: z.number().int().positive().optional() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, version }, ctx) => {
        const all = models.list(ctx.actor.tenantId, (m) => m.matterId === matterId).sort((a, b) => a.version - b.version);
        const current = version ? all.find((m) => m.version === version) : all.at(-1);
        if (!current) throw notFound(version ? `Damages version ${version}` : "Damages model");
        return {
          current,
          versions: all.map((m) => ({ id: m.id, version: m.version, createdAt: m.createdAt, createdBy: m.createdBy, totalCents: m.model.summary.totalCents, warnings: m.audit.length })),
        };
      },
    }),

    defineCommand({
      name: "get_authority_to_settle",
      title: "Get Authority to Settle",
      description: "The latest (or a given) saved Authority to Settle draft for a matter, with its settlement statement and the list of versions.",
      tier: 0,
      input: z.object({ matterId: z.string(), version: z.number().int().positive().optional() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, version }, ctx) => {
        const all = authorities.list(ctx.actor.tenantId, (a) => a.matterId === matterId).sort((a, b) => a.version - b.version);
        const current = version ? all.find((a) => a.version === version) : all.at(-1);
        if (!current) throw notFound(version ? `Authority to Settle version ${version}` : "Authority to Settle");
        return {
          current,
          versions: all.map((a) => ({ id: a.id, version: a.version, createdAt: a.createdAt, createdBy: a.createdBy, totalOfferCents: a.result.totalOfferCents, netInHandCents: a.result.netInHandCents })),
        };
      },
    }),

    defineCommand({
      name: "compute_authority_to_settle",
      title: "Compute Authority to Settle",
      description:
        "Compute the Authority to Settle figures (Total Offer, Medicare 10% advance of the Total Offer, firm fees, net in hand, net total) and the form's display cells. Saves a draft version and a settlement statement using any Medicare/Centrelink/NDIS charges already recorded. Sending it to the client is a separate, approved step.",
      tier: 1,
      roles: [...STAFF],
      input: authorityInput,
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, ...raw }, ctx) => {
        const matter = getMatter(ctx, matterId);
        const input: AuthorityInput = {
          ...raw,
          clientName: raw.clientName ?? clientOf(matter)?.name,
          injuryDate: raw.injuryDate ?? (matter.injuryDate ? fmtDate(matter.injuryDate) : ""),
          // The row label on the firm's own form, which the document filler searches for.
          feesLabel: raw.feesLabel ?? `${settingsFor(store, ctx.actor.tenantId).firmName} fees`,
        } as AuthorityInput;
        const result = engine(() => computeAuthority(input));
        const charge = (kind: Clearance["kind"]) => {
          const c = matterClearances(ctx, matterId).find((x) => x.kind === kind && x.chargeCents !== undefined);
          return c?.chargeCents;
        };
        const statement = computeSettlementStatement({
          authority: input,
          medicareChargeCents: charge("medicare") ?? null,
          ...(charge("centrelink") !== undefined ? { centrelinkChargeCents: charge("centrelink")! } : {}),
          ...(charge("ndis") !== undefined ? { ndisRecoveryCents: charge("ndis")! } : {}),
        });
        const stored: StoredAuthority = {
          id: randomUUID(),
          tenantId: ctx.actor.tenantId,
          matterId,
          version: nextVersion(authorities.list(ctx.actor.tenantId), matterId),
          status: "draft",
          input,
          result,
          statement,
          createdBy: ctx.actor.userId,
          createdAt: new Date().toISOString(),
        };
        return authorities.set(stored);
      },
    }),

    defineCommand({
      name: "record_clearance",
      title: "Record clearance event",
      description:
        "Record a Medicare, Centrelink, NDIS, DVA, private health fund or other clearance event (requested, NOPB received, MO022 lodged, charge received, paid, not applicable). Creates the clearance if the matter has none of that kind.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        clearanceId: z.string().optional(),
        kind: z.enum(CLEARANCE_KINDS).optional(),
        label: z.string().optional().describe('For several of one kind, e.g. "HBF"'),
        event: clearanceEvent,
      }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, clearanceId, kind, label, event }, ctx) => {
        getMatter(ctx, matterId);
        let current: Clearance | undefined;
        if (clearanceId) {
          current = clearances.find(ctx.actor.tenantId, clearanceId);
          if (!current || current.matterId !== matterId) throw notFound("Clearance");
        } else {
          if (!kind) throw invalid("Give a clearanceId or a kind");
          current =
            matterClearances(ctx, matterId).find((c) => c.kind === kind && c.label === label) ??
            newClearance({ id: randomUUID(), tenantId: ctx.actor.tenantId, matterId, kind, ...(label ? { label } : {}) });
        }
        const base = current;
        let next: Clearance;
        try {
          next = applyClearanceEvent(base, event, { by: ctx.actor.userId });
        } catch (err) {
          throw conflict(err instanceof Error ? err.message : String(err));
        }
        return clearances.set(next);
      },
    }),

    defineCommand({
      name: "list_clearances",
      title: "List clearances",
      description: "Clearances for a matter. With a settlement date, also reports what blocks release of the settlement funds and the MO022 due date.",
      tier: 0,
      input: z.object({ matterId: z.string(), settlementDate: isoDate.optional(), asAt: isoDate.optional() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, settlementDate, asAt }, ctx) => {
        const list = matterClearances(ctx, matterId);
        return {
          clearances: list,
          ...(settlementDate ? { release: clearanceBlockers(list, settlementDate, { asAt: asAt ?? new Date().toISOString().slice(0, 10) }) } : {}),
        };
      },
    }),

    defineCommand({
      name: "estimate_centrelink_preclusion",
      title: "Estimate Centrelink preclusion period",
      description:
        "Estimate the Centrelink preclusion period: 50% of an agreed lump sum (or the economic-loss part of a judgment) divided by the weekly income cut-out, in whole weeks from the injury date. An estimate only; give the cut-out figure with its source and date.",
      tier: 0,
      input: z.object({
        matterId: z.string().optional(),
        lumpSumCents: amount,
        settlementType: z.enum(["agreed", "judgment"]),
        economicLossCents: amount.optional(),
        incomeCutOutWeeklyCents: cents.positive(),
        incomeCutOutSource: z.string().min(1),
        incomeCutOutDate: isoDate,
        injuryDate: isoDate.optional().describe("Defaults to the matter's injury date"),
        periodStart: isoDate.optional(),
      }),
      matterIds: (i) => (i.matterId ? [i.matterId] : []),
      handler: ({ matterId, injuryDate, ...rest }, ctx) => {
        const date = injuryDate ?? (matterId ? getMatter(ctx, matterId).injuryDate : undefined);
        if (!date) throw invalid("Give an injury date or a matter");
        return engine(() => centrelinkPreclusionEstimate({ ...rest, injuryDate: date }));
      },
    }),
  ];
}
