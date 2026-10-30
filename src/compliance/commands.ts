import { randomUUID } from "node:crypto";
import { z } from "zod";
import { settingsFor } from "../admin/settings.js";
import type { AiRun } from "../ai/chronology.js";
import type { AuditLog } from "../core/audit.js";
import { addDays, addYears, type IsoDate } from "../core/calendar.js";
import { conflict, notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import { visibleMatters } from "../domain/commands.js";
import type { Store } from "../domain/store.js";
import { documentsOf } from "../documents/model.js";

/**
 * Compliance registers for the Privacy Act (APPs, NDB scheme, ADM transparency from
 * 10 Dec 2026), Cyber Security Act ransomware reporting, AML/CTF designated-service
 * screening, retention and legal hold, and AI-use records for court practice notes.
 * Statutory periods are recorded with their source; dates are computed, never sent
 * anywhere automatically.
 */

export interface PrivacyRequest {
  id: string;
  tenantId: string;
  kind: "access" | "correction" | "complaint" | "other";
  requesterName: string;
  requesterEmail?: string;
  matterId?: string;
  details: string;
  receivedOn: IsoDate;
  /** APP 12.4 / 13.5: respond within a reasonable period, generally 30 days. */
  dueBy: IsoDate;
  status: "open" | "responded" | "refused" | "withdrawn";
  outcome?: string;
  closedOn?: IsoDate;
  loggedBy: string;
}

export interface Breach {
  id: string;
  tenantId: string;
  discoveredAt: string;
  description: string;
  dataKinds: string[];
  individualsAffected?: number;
  /** NDB scheme: assess a suspected eligible breach within 30 days (s 26WH). */
  assessmentDue: IsoDate;
  status: "assessing" | "not_eligible" | "eligible" | "closed";
  assessment?: { eligible: boolean; reasoning: string; by: string; at: string };
  oaicNotifiedAt?: string;
  individualsNotifiedAt?: string;
  ransomware?: { paidAt: string; reportDueAt: string; reportedAt?: string };
  loggedBy: string;
}

export interface AdmEntry {
  id: string;
  tenantId: string;
  system: string;
  /** Kinds of decisions made or substantially assisted by the program. */
  decisions: string;
  /** Kinds of personal information used. */
  personalInformation: string;
  humanReview: string;
  active: boolean;
  updatedAt: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Practy features that make or substantially assist decisions about individuals (APP 1.7–1.9). */
export const DEFAULT_ADM: Omit<AdmEntry, "id" | "tenantId" | "updatedAt">[] = [
  {
    system: "Key-date rule pack (limitation and statutory deadlines)",
    decisions: "Proposes limitation and statutory deadline dates for a client's claim",
    personalInformation: "Date of injury, date of birth, claim type and events such as settlement",
    humanReview: "Every date is proposed only; a practitioner confirms it before it is diarised",
    active: true,
  },
  {
    system: "Email filing",
    decisions: "Matches incoming and outgoing email to a client's matter file",
    personalInformation: "Names, email addresses, subject lines and message content",
    humanReview: "Only strong evidence is filed automatically; everything else is reviewed by staff",
    active: true,
  },
  {
    system: "AI medical chronology and assistant",
    decisions: "Summarises medical evidence and drafts documents that inform advice about a client's claim",
    personalInformation: "Health information, employment and financial information in the matter file",
    humanReview: "Outputs are drafts with page citations, reviewed by a practitioner before use",
    active: true,
  },
];

export function admPolicyClause(firmName: string, entries: AdmEntry[]): string {
  const active = entries.filter((e) => e.active);
  if (!active.length) return `${firmName} does not use computer programs to make, or substantially assist in making, decisions that could reasonably be expected to significantly affect individuals' rights or interests.`;
  const items = active.map((e) => `- ${e.system}: ${e.decisions}. Information used: ${e.personalInformation}. ${e.humanReview}.`).join("\n");
  return `Automated decision-making\n\n${firmName} uses computer programs that make, or substantially assist in making, decisions that could reasonably be expected to significantly affect the rights or interests of individuals. The kinds of decisions and the kinds of personal information used are:\n\n${items}\n\nA lawyer remains responsible for every decision about your matter. Contact our Privacy Officer to ask about these processes.`;
}

/** AML/CTF Act Table 6 professional services (summarised). Answers drive designated-service status. */
export const AML_QUESTIONS = {
  real_estate: "Assisting a client to buy, sell or transfer real estate",
  body_corporate: "Creating, restructuring or selling a company or other body corporate",
  trust_arrangement: "Creating or restructuring a trust or similar arrangement for the client",
  business_sale: "Assisting with the sale or purchase of a business",
  managing_client_money: "Holding or managing client money other than fees, court-ordered sums, or money from/to a licensed insurer, government body or court",
  investments: "Managing or investing client funds, securities or other assets (e.g. investing settlement proceeds)",
  nominee: "Acting as or arranging a nominee director, shareholder, trustee or registered office",
} as const;

export function complianceCommands(store: Store, audit: AuditLog) {
  const requests = store.collection<PrivacyRequest>("privacy_request");
  const breaches = store.collection<Breach>("breach");
  const adm = store.collection<AdmEntry>("adm_entry");
  const PRINCIPAL = ["principal"] as const;

  const admFor = (tenantId: string) => {
    const list = adm.list(tenantId);
    if (list.length) return list;
    return DEFAULT_ADM.map((e, i) => adm.set({ ...e, id: `${tenantId}:adm:${i}`, tenantId, updatedAt: new Date().toISOString() }));
  };

  const admOwned = (tenantId: string, id?: string) => {
    // admFor seeds the default entries so their ids can be edited before the register is first listed.
    if (id && !admFor(tenantId).some((e) => e.id === id)) throw notFound("Register entry");
  };

  return [
    // ------------------------------------------------------------ APP 12/13 requests
    defineCommand({
      name: "log_privacy_request",
      title: "Log a privacy request",
      description: "Record an access or correction request or a privacy complaint. Sets a 30-day response target (APP 12.4, 13.5).",
      tier: 1,
      input: z.object({
        kind: z.enum(["access", "correction", "complaint", "other"]),
        requesterName: z.string().min(1),
        requesterEmail: z.email().optional(),
        matterId: z.string().optional(),
        details: z.string().min(1),
        receivedOn: z.iso.date(),
      }),
      matterIds: (i) => (i.matterId ? [i.matterId] : []),
      handler: (input, ctx) =>
        requests.set({ ...input, id: randomUUID(), tenantId: ctx.actor.tenantId, dueBy: addDays(input.receivedOn, 30), status: "open", loggedBy: ctx.actor.userId }),
    }),
    defineCommand({
      name: "close_privacy_request",
      title: "Close a privacy request",
      description: "Record the outcome of a privacy request.",
      tier: 1,
      input: z.object({ requestId: z.string(), status: z.enum(["responded", "refused", "withdrawn"]), outcome: z.string().min(1) }),
      handler: ({ requestId, status, outcome }, ctx) => {
        const r = requests.find(ctx.actor.tenantId, requestId);
        if (!r) throw notFound("Privacy request");
        return requests.set({ ...r, status, outcome, closedOn: today() });
      },
    }),
    defineCommand({
      name: "list_privacy_requests",
      title: "Privacy requests",
      description: "Privacy requests with due dates and overdue flags.",
      tier: 0,
      input: z.object({ openOnly: z.boolean().default(true) }),
      handler: ({ openOnly }, ctx) => {
        const visible = new Set(visibleMatters(store, ctx).map((m) => m.id));
        return requests
          .list(ctx.actor.tenantId, (r) => (!openOnly || r.status === "open") && (!r.matterId || visible.has(r.matterId)))
          .map((r) => ({ ...r, overdue: r.status === "open" && r.dueBy < today() }))
          .sort((a, b) => a.dueBy.localeCompare(b.dueBy));
      },
    }),

    // ------------------------------------------------------------ NDB scheme and ransomware
    defineCommand({
      name: "report_breach",
      title: "Report a data breach",
      description: "Record a suspected data breach. Starts the 30-day NDB assessment clock (Privacy Act s 26WH).",
      tier: 1,
      input: z.object({
        discoveredAt: z.iso.datetime(),
        description: z.string().min(1),
        dataKinds: z.array(z.string()).default([]),
        individualsAffected: z.number().int().nonnegative().optional(),
      }),
      handler: (input, ctx) =>
        breaches.set({
          ...input, id: randomUUID(), tenantId: ctx.actor.tenantId, assessmentDue: addDays(input.discoveredAt.slice(0, 10), 30), status: "assessing", loggedBy: ctx.actor.userId,
        }),
    }),
    defineCommand({
      name: "assess_breach",
      title: "Assess a data breach",
      description: "Record whether the breach is an eligible data breach (likely serious harm). Requires principal approval.",
      tier: 2,
      approverRoles: ["principal"],
      input: z.object({ breachId: z.string(), eligible: z.boolean(), reasoning: z.string().min(1) }),
      handler: ({ breachId, eligible, reasoning }, ctx) => {
        const b = breaches.find(ctx.actor.tenantId, breachId);
        if (!b) throw notFound("Breach");
        return breaches.set({ ...b, status: eligible ? "eligible" : "not_eligible", assessment: { eligible, reasoning, by: ctx.actor.userId, at: new Date().toISOString() } });
      },
    }),
    defineCommand({
      name: "record_breach_notification",
      title: "Record breach notifications",
      description: "Record when the OAIC and affected individuals were notified of an eligible breach.",
      tier: 1,
      input: z.object({ breachId: z.string(), oaicNotifiedAt: z.iso.datetime().optional(), individualsNotifiedAt: z.iso.datetime().optional() }),
      handler: ({ breachId, ...dates }, ctx) => {
        const b = breaches.find(ctx.actor.tenantId, breachId);
        if (!b) throw notFound("Breach");
        if (b.status !== "eligible") throw conflict("Notifications are recorded for eligible breaches; assess the breach first");
        return breaches.set({ ...b, ...dates });
      },
    }),
    defineCommand({
      name: "record_ransomware_payment",
      title: "Record a ransomware payment",
      description: "Record a ransomware payment. A report to the ASD is due within 72 hours (Cyber Security Act 2024 Pt 3, turnover above $3m).",
      tier: 1,
      roles: [...PRINCIPAL],
      input: z.object({ breachId: z.string(), paidAt: z.iso.datetime(), reportedAt: z.iso.datetime().optional() }),
      handler: ({ breachId, paidAt, reportedAt }, ctx) => {
        const b = breaches.find(ctx.actor.tenantId, breachId);
        if (!b) throw notFound("Breach");
        const reportDueAt = new Date(Date.parse(paidAt) + 72 * 3_600_000).toISOString();
        return breaches.set({ ...b, ransomware: { paidAt, reportDueAt, reportedAt } });
      },
    }),
    defineCommand({
      name: "list_breaches",
      title: "Breach register",
      description: "Data breaches with NDB assessment and ransomware reporting deadlines.",
      tier: 0,
      roles: [...PRINCIPAL],
      input: z.object({}),
      handler: (_i, ctx) => {
        const now = new Date().toISOString();
        return breaches.list(ctx.actor.tenantId).map((b) => ({
          ...b,
          assessmentOverdue: b.status === "assessing" && b.assessmentDue < now.slice(0, 10),
          ransomwareReportOverdue: !!b.ransomware && !b.ransomware.reportedAt && b.ransomware.reportDueAt < now,
        }));
      },
    }),

    // ------------------------------------------------------------ ADM transparency (APP 1, from 10 Dec 2026)
    defineCommand({
      name: "list_adm_register",
      title: "Automated decision register",
      description: "Computer programs that make or substantially assist decisions about individuals, for the APP 1 privacy policy disclosure.",
      tier: 0,
      input: z.object({}),
      handler: (_i, ctx) => admFor(ctx.actor.tenantId),
    }),
    defineCommand({
      name: "upsert_adm_entry",
      title: "Update automated decision register",
      description: "Add or change an entry in the automated decision register. Requires principal approval.",
      tier: 2,
      approverRoles: ["principal"],
      input: z.object({ id: z.string().optional(), system: z.string().min(1), decisions: z.string().min(1), personalInformation: z.string().min(1), humanReview: z.string().min(1), active: z.boolean().default(true) }),
      precheck: ({ id }, ctx) => admOwned(ctx.actor.tenantId, id),
      handler: ({ id, ...e }, ctx) => {
        // A caller-supplied id must name this tenant's entry, never another tenant's.
        admOwned(ctx.actor.tenantId, id);
        return adm.set({ ...e, id: id ?? randomUUID(), tenantId: ctx.actor.tenantId, updatedAt: new Date().toISOString() });
      },
    }),
    defineCommand({
      name: "privacy_policy_adm_clause",
      title: "Privacy policy ADM clause",
      description: "Generate the automated decision-making section of the firm's privacy policy from the register.",
      tier: 0,
      input: z.object({}),
      handler: (_i, ctx) => ({ text: admPolicyClause(settingsFor(store, ctx.actor.tenantId).firmName, admFor(ctx.actor.tenantId)) }),
    }),

    // ------------------------------------------------------------ AML/CTF designated services
    defineCommand({
      name: "aml_screen_matter",
      title: "AML/CTF designated-service screening",
      description:
        "Screen a matter against the AML/CTF Act Table 6 professional services. Personal injury work alone is not a designated service; any 'yes' means the firm is (or becomes) a reporting entity.",
      tier: 1,
      input: z.object({ matterId: z.string(), answers: z.object(Object.fromEntries(Object.keys(AML_QUESTIONS).map((k) => [k, z.boolean()])) as Record<keyof typeof AML_QUESTIONS, z.ZodBoolean>) }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, answers }, ctx) => {
        const m = store.matters.find(ctx.actor.tenantId, matterId);
        if (!m) throw notFound("Matter");
        const designatedService = Object.values(answers).some(Boolean);
        store.matters.set({ ...m, amlScreening: { designatedService, answers, screenedBy: ctx.actor.userId, screenedAt: new Date().toISOString() } });
        return {
          designatedService,
          message: designatedService
            ? "This matter involves a designated service. The firm must be enrolled with AUSTRAC and apply its AML/CTF program (customer due diligence) before providing it."
            : "No designated service identified. Re-screen if the matter's scope changes (e.g. investing settlement funds or setting up a trust).",
        };
      },
    }),
    defineCommand({
      name: "aml_status",
      title: "AML/CTF status",
      description: "Matters screened and unscreened, and matters involving designated services.",
      tier: 0,
      input: z.object({}),
      handler: (_i, ctx) => {
        const open = visibleMatters(store, ctx).filter((m) => m.status === "open");
        return {
          questions: AML_QUESTIONS,
          openMatters: open.length,
          unscreened: open.filter((m) => !m.amlScreening).map((m) => ({ id: m.id, number: m.number, title: m.title })),
          designated: open.filter((m) => m.amlScreening?.designatedService).map((m) => ({ id: m.id, number: m.number, title: m.title })),
        };
      },
    }),

    // ------------------------------------------------------------ document handling flags
    defineCommand({
      name: "restrict_document_ai",
      title: "Exclude a document from AI",
      description: "Exclude a document from all AI processing (suppressed, privileged or implied-undertaking material).",
      tier: 1,
      input: z.object({ matterId: z.string(), documentId: z.string(), reason: z.string().min(1) }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, documentId, reason }, ctx) => {
        const d = documentsOf(store).find(ctx.actor.tenantId, documentId);
        if (!d || d.matterId !== matterId) throw notFound("Document");
        return documentsOf(store).set({ ...d, aiExcluded: true, aiExcludedReason: reason });
      },
    }),
    defineCommand({
      name: "clear_document_ai_restriction",
      title: "Allow AI on a document",
      description: "Remove an AI exclusion from a document. Requires practitioner approval.",
      tier: 2,
      input: z.object({ matterId: z.string(), documentId: z.string() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, documentId }, ctx) => {
        const d = documentsOf(store).find(ctx.actor.tenantId, documentId);
        if (!d || d.matterId !== matterId) throw notFound("Document");
        return documentsOf(store).set({ ...d, aiExcluded: false, aiExcludedReason: undefined });
      },
    }),
    defineCommand({
      name: "mark_evidence_document",
      title: "Mark as evidence",
      description: "Flag an affidavit, witness statement or expert report as evidence: AI may format it but must not draft its substance, and AI use must be disclosed where a court requires.",
      tier: 1,
      input: z.object({ matterId: z.string(), documentId: z.string(), evidence: z.boolean() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, documentId, evidence }, ctx) => {
        const d = documentsOf(store).find(ctx.actor.tenantId, documentId);
        if (!d || d.matterId !== matterId) throw notFound("Document");
        return documentsOf(store).set({ ...d, evidence });
      },
    }),

    // ------------------------------------------------------------ retention and legal hold
    defineCommand({
      name: "set_legal_hold",
      title: "Legal hold",
      description: "Place or release a legal hold on a matter. A hold suspends retention-based destruction. Requires principal approval.",
      tier: 2,
      approverRoles: ["principal"],
      input: z.object({ matterId: z.string(), on: z.boolean(), reason: z.string().min(1) }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, on, reason }, ctx) => {
        const m = store.matters.find(ctx.actor.tenantId, matterId);
        if (!m) throw notFound("Matter");
        return store.matters.set({ ...m, legalHold: { on, reason, setBy: ctx.actor.userId, setAt: new Date().toISOString() } });
      },
    }),
    defineCommand({
      name: "retention_report",
      title: "Retention report",
      description:
        "Closed matters with their earliest destruction date (7 years after closure; for clients injured as minors, not before age 25) and holds. Practy never destroys files automatically.",
      tier: 0,
      roles: [...PRINCIPAL],
      input: z.object({}),
      handler: (_i, ctx) =>
        visibleMatters(store, ctx)
          .filter((m) => m.status === "closed")
          .map((m) => {
            const closed = m.closedOn ?? m.openedOn;
            let notBefore = addYears(closed, 7).date;
            const client = m.parties.find((p) => p.role === "client");
            const dob = client && store.parties.get(client.partyId)?.dateOfBirth;
            if (dob) {
              const age25 = addYears(dob, 25).date;
              if (age25 > notBefore) notBefore = age25;
            }
            return { matterId: m.id, number: m.number, title: m.title, closedOn: closed, destroyNotBefore: notBefore, legalHold: !!m.legalHold?.on, eligible: !m.legalHold?.on && notBefore <= today() };
          }),
    }),

    // ------------------------------------------------------------ AI use records (court practice notes)
    defineCommand({
      name: "export_ai_use_log",
      title: "AI-use log for a matter",
      description:
        "Every AI action on a matter (assistant and MCP tool calls, chronology runs with model and provider) for disclosure under court practice notes or to the client.",
      tier: 0,
      roles: ["principal", "solicitor"],
      input: z.object({ matterId: z.string() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId }, ctx) => ({
        toolCalls: audit
          .list({ tenantId: ctx.actor.tenantId, matterId, aiOnly: true })
          .map(({ at, userId, surface, command, outcome, inputHash, approvalId }) => ({ at, userId, surface, command, outcome, inputHash, approvalId })),
        modelRuns: store.collection<AiRun>("ai_run").list(ctx.actor.tenantId, (r) => r.matterId === matterId),
      }),
    }),
  ];
}
