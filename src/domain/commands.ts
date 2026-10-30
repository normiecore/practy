import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { MatterGuard } from "../core/bus.js";
import { conflict, notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import { AI_SURFACES, type InvocationContext } from "../core/types.js";
import { CONFLICT_THRESHOLD, nameSimilarity } from "./conflicts.js";
import { PARTY_ROLES, SCHEMES, type KeyDate, type Matter, type Party } from "./model.js";
import { DEFAULT_FIRM_POLICY, RULE_PACK_VERSION, proposeKeyDates, type FirmPolicy, type MatterEvent } from "./rules/wa-pi.js";
import type { Store } from "./store.js";

const isoDate = z.iso.date();
const today = () => new Date().toISOString().slice(0, 10);

/** Walls, no-AI consent and tenant isolation. Hidden matters are reported as not found. */
export function matterGuard(store: Store): MatterGuard {
  return (ctx, matterId) => {
    const m = store.matters.get(matterId);
    const hidden =
      !m ||
      m.tenantId !== ctx.actor.tenantId ||
      (m.restrictedTo && !m.restrictedTo.includes(ctx.actor.userId)) ||
      (!m.aiPermitted && AI_SURFACES.includes(ctx.surface));
    if (hidden) throw notFound(`Matter ${matterId}`);
  };
}

export function visibleMatters(store: Store, ctx: InvocationContext): Matter[] {
  const guard = matterGuard(store);
  return store.mattersFor(ctx.actor.tenantId).filter((m) => {
    try {
      guard(ctx, m.id);
      return true;
    } catch {
      return false;
    }
  });
}

interface ConflictHit {
  searchedName: string;
  partyName: string;
  score: number;
  role: string;
  /** Null when the matter is walled from the searcher: the hit is reported without details. */
  matter: { id: string; number: string; title: string } | null;
}

function conflictSearch(store: Store, ctx: InvocationContext, names: string[], excludeMatterId?: string): ConflictHit[] {
  const visible = new Set(visibleMatters(store, { ...ctx, surface: "ui" }).map((m) => m.id));
  const hits: ConflictHit[] = [];
  for (const m of store.mattersFor(ctx.actor.tenantId)) {
    if (m.id === excludeMatterId) continue;
    for (const link of m.parties) {
      const party = store.parties.get(link.partyId);
      if (!party) continue;
      for (const name of names) {
        const score = nameSimilarity(name, party.name);
        if (score >= CONFLICT_THRESHOLD) {
          hits.push({
            searchedName: name,
            partyName: visible.has(m.id) ? party.name : "[restricted]",
            score: Math.round(score * 1000) / 1000,
            role: link.role,
            matter: visible.has(m.id) ? { id: m.id, number: m.number, title: m.title } : null,
          });
        }
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

function applyEvent(store: Store, matter: Matter, event: MatterEvent, policy: FirmPolicy): KeyDate[] {
  const client = matter.parties.find((p) => p.role === "client");
  const proposed = proposeKeyDates({
    matter,
    client: client && store.parties.get(client.partyId),
    event,
    firmPolicy: policy,
  });
  return proposed.map((p) => {
    const kd: KeyDate = {
      id: randomUUID(),
      tenantId: matter.tenantId,
      matterId: matter.id,
      rulePackVersion: RULE_PACK_VERSION,
      status: p.date === null ? "manual_required" : "proposed",
      ...p,
    };
    store.keyDates.set(kd);
    return kd;
  });
}

const STAFF = ["principal", "solicitor", "paralegal"] as const;

export function domainCommands(store: Store, policy: FirmPolicy = DEFAULT_FIRM_POLICY) {
  const getMatter = (id: string) => {
    const m = store.matters.get(id);
    if (!m) throw notFound(`Matter ${id}`);
    return m;
  };

  const confirmableKeyDate = (matterId: string, keyDateId: string): KeyDate => {
    const kd = store.keyDates.get(keyDateId);
    if (!kd || kd.matterId !== matterId) throw notFound("Key date");
    if (kd.date === null) throw conflict("Enter the date before confirming");
    if (kd.status === "dismissed") throw conflict("This key date was dismissed");
    return kd;
  };

  return [
    defineCommand({
      name: "create_matter",
      title: "Open a matter",
      description:
        "Open an ICWA motor vehicle or WorkCover WA matter. Runs a conflict search across all parties and proposes key dates from the WA PI rule pack (each needs practitioner confirmation).",
      tier: 1,
      roles: [...STAFF],
      resultMatterIds: (r: { matter: Matter }) => [r.matter.id],
      input: z.object({
        number: z.string().min(1),
        title: z.string().min(1),
        scheme: z.enum(SCHEMES),
        injuryDate: isoDate.optional(),
        client: z.object({ name: z.string().min(1), dateOfBirth: isoDate.optional(), email: z.email().optional(), phone: z.string().optional(), address: z.string().optional() }),
        otherParties: z
          .array(z.object({ name: z.string().min(1), role: z.enum(PARTY_ROLES).exclude(["client"]), kind: z.enum(["person", "organisation"]).default("person"), email: z.email().optional() }))
          .default([]),
        references: z.array(z.string()).default([]),
        responsibleUserId: z.string().optional(),
        aiPermitted: z.boolean().default(true),
        boxFolderId: z.string().optional(),
      }),
      handler: (input, ctx) => {
        const tenantId = ctx.actor.tenantId;
        if (store.matterByNumber(tenantId, input.number)) {
          throw conflict(`Matter number ${input.number} already exists`);
        }
        const conflicts = conflictSearch(store, ctx, [input.client.name, ...input.otherParties.map((p) => p.name)]);
        const mkParty = (name: string, kind: Party["kind"], extra: Partial<Party> = {}): Party => {
          const p: Party = { id: randomUUID(), tenantId, name, kind, ...extra, ...(extra.email ? { email: extra.email.toLowerCase() } : {}) };
          return store.parties.set(p);
        };
        const { name: _n, ...clientExtra } = input.client;
        const client = mkParty(input.client.name, "person", clientExtra);
        const matter: Matter = {
          id: randomUUID(),
          tenantId,
          number: input.number,
          title: input.title,
          scheme: input.scheme,
          status: "open",
          injuryDate: input.injuryDate,
          openedOn: today(),
          parties: [
            { partyId: client.id, role: "client" },
            ...input.otherParties.map((p) => ({ partyId: mkParty(p.name, p.kind, p.email ? { email: p.email } : {}).id, role: p.role })),
          ],
          references: input.references,
          responsibleUserId: input.responsibleUserId ?? ctx.actor.userId,
          aiPermitted: input.aiPermitted,
          links: input.boxFolderId ? { boxFolderId: input.boxFolderId } : {},
        };
        store.matters.set(matter);
        const keyDates = applyEvent(store, matter, { type: "matter_opened" }, policy);
        return { matter, conflicts, keyDates };
      },
    }),

    defineCommand({
      name: "update_matter",
      title: "Update matter",
      description: "Change a matter's title, status, references (action/claim numbers), responsible user or Box folder link.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        title: z.string().min(1).optional(),
        status: z.enum(["open", "closed"]).optional(),
        references: z.array(z.string()).optional(),
        responsibleUserId: z.string().optional(),
        boxFolderId: z.string().optional(),
      }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, boxFolderId, status, ...rest }) => {
        const m = getMatter(matterId);
        const next: Matter = { ...m, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
        if (boxFolderId) next.links = { ...m.links, boxFolderId };
        if (status && status !== m.status) {
          next.status = status;
          next.closedOn = status === "closed" ? today() : undefined;
        }
        return store.matters.set(next);
      },
    }),

    defineCommand({
      name: "add_party",
      title: "Add a party",
      description: "Add a person or organisation to a matter (defendant, insurer, employer, driver, witness, other). Runs a conflict search on the name.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        name: z.string().min(1),
        role: z.enum(PARTY_ROLES).exclude(["client"]),
        kind: z.enum(["person", "organisation"]).default("person"),
        email: z.email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
      }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, role, ...p }, ctx) => {
        const m = getMatter(matterId);
        const conflicts = conflictSearch(store, ctx, [p.name], matterId);
        const party = store.parties.set({ id: randomUUID(), tenantId: m.tenantId, ...p, ...(p.email ? { email: p.email.toLowerCase() } : {}) });
        store.matters.set({ ...m, parties: [...m.parties, { partyId: party.id, role }] });
        return { party, conflicts };
      },
    }),

    defineCommand({
      name: "get_matter",
      title: "Get matter",
      description: "Full matter record with parties, key dates and links to Box/Xero.",
      tier: 0,
      input: z.object({ matterId: z.string() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId }) => {
        const m = getMatter(matterId);
        return {
          ...m,
          parties: m.parties.map((l) => ({ ...l, party: store.parties.get(l.partyId) })),
          keyDates: store.keyDatesFor(m.tenantId, m.id),
        };
      },
    }),

    defineCommand({
      name: "search_matters",
      title: "Search matters",
      description: "Search matters by number, title or party name. Only matters you are permitted to see are returned.",
      tier: 0,
      input: z.object({ query: z.string().default(""), scheme: z.enum(SCHEMES).optional() }),
      handler: ({ query, scheme }, ctx) => {
        const q = query.toLowerCase();
        return visibleMatters(store, ctx)
          .filter((m) => !scheme || m.scheme === scheme)
          .filter(
            (m) =>
              !q ||
              m.number.toLowerCase().includes(q) ||
              m.title.toLowerCase().includes(q) ||
              m.parties.some((l) => store.parties.get(l.partyId)?.name.toLowerCase().includes(q)),
          )
          .map(({ id, number, title, scheme: s, status, injuryDate }) => ({ id, number, title, scheme: s, status, injuryDate }));
      },
    }),

    defineCommand({
      name: "conflict_search",
      title: "Conflict search",
      description:
        "Fuzzy search of names against every party on every matter in the firm, including walled matters (reported without details).",
      tier: 0,
      roles: [...STAFF],
      input: z.object({ names: z.array(z.string().min(1)).min(1) }),
      handler: ({ names }, ctx) => conflictSearch(store, ctx, names),
    }),

    defineCommand({
      name: "list_key_dates",
      title: "List key dates",
      description:
        "Key dates for a matter, or upcoming dates across all visible matters. Includes status (proposed/confirmed/manual_required) and rule provenance.",
      tier: 0,
      input: z.object({ matterId: z.string().optional(), withinDays: z.number().int().positive().optional() }),
      matterIds: (i) => (i.matterId ? [i.matterId] : []),
      handler: ({ matterId, withinDays }, ctx) => {
        const visible = new Set(visibleMatters(store, ctx).map((m) => m.id));
        const horizon = withinDays
          ? new Date(Date.now() + withinDays * 86_400_000).toISOString().slice(0, 10)
          : undefined;
        return store
          .keyDatesFor(ctx.actor.tenantId, matterId)
          .filter((k) => visible.has(k.matterId) && k.status !== "dismissed")
          .filter((k) => !horizon || k.date === null || k.date <= horizon)
          .sort((a, b) => (a.date ?? "0000").localeCompare(b.date ?? "0000"));
      },
    }),

    defineCommand({
      name: "record_matter_event",
      title: "Record matter event",
      description:
        "Record a dated event (Medicare NOPB received, settlement) so the rule pack proposes the resulting deadlines.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        event: z.discriminatedUnion("type", [
          z.object({ type: z.literal("nopb_received"), issueDate: isoDate }),
          z.object({ type: z.literal("settlement"), date: isoDate }),
        ]),
      }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, event }) => applyEvent(store, getMatter(matterId), event, policy),
    }),

    defineCommand({
      name: "propose_key_date",
      title: "Propose a key date",
      description: "Add or fill in a key date manually (e.g. a manual_required WorkCover election date). Stays proposed until confirmed.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        keyDateId: z.string().optional(),
        title: z.string().optional(),
        date: isoDate,
        kind: z.enum(["critical", "deadline", "reminder"]).default("deadline"),
        note: z.string().optional(),
      }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, keyDateId, title, date, kind, note }, ctx) => {
        const matter = getMatter(matterId);
        if (keyDateId) {
          const kd = store.keyDates.get(keyDateId);
          if (!kd || kd.matterId !== matterId) throw notFound("Key date");
          kd.date = date;
          kd.status = "proposed";
          kd.notes.push(`Date entered by ${ctx.actor.displayName}${note ? `: ${note}` : ""}`);
          return store.keyDates.set(kd);
        }
        const kd: KeyDate = {
          id: randomUUID(),
          tenantId: matter.tenantId,
          matterId,
          kind,
          title: title ?? "Key date",
          date,
          status: "proposed",
          ruleVerified: false,
          source: `Entered by ${ctx.actor.displayName}`,
          notes: note ? [note] : [],
        };
        store.keyDates.set(kd);
        return kd;
      },
    }),

    defineCommand({
      name: "confirm_key_date",
      title: "Confirm key date",
      description:
        "Confirm a proposed key date so it is diarised. Legal-risk action: requires practitioner approval in Practy.",
      tier: 2,
      input: z.object({ matterId: z.string(), keyDateId: z.string() }),
      matterIds: (i) => [i.matterId],
      // Refuse before the request reaches a practitioner's inbox, not only when it is approved.
      precheck: ({ matterId, keyDateId }) => void confirmableKeyDate(matterId, keyDateId),
      handler: ({ matterId, keyDateId }, ctx) => {
        const kd = confirmableKeyDate(matterId, keyDateId);
        kd.status = "confirmed";
        kd.confirmedBy = ctx.actor.userId;
        kd.confirmedAt = new Date().toISOString();
        return store.keyDates.set(kd);
      },
    }),

    defineCommand({
      name: "set_matter_ai_permission",
      title: "Set AI permission",
      description: "Record the client's consent (or refusal) to AI processing on a matter. Requires principal approval.",
      tier: 2,
      approverRoles: ["principal"],
      input: z.object({ matterId: z.string(), aiPermitted: z.boolean(), note: z.string().optional() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, aiPermitted }) => {
        const m = getMatter(matterId);
        m.aiPermitted = aiPermitted;
        store.matters.set(m);
        return { matterId, aiPermitted };
      },
    }),
  ];
}
