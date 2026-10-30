import { randomUUID } from "node:crypto";
import { z } from "zod";
import { addDays, type IsoDate } from "../core/calendar.js";
import { notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import { visibleMatters } from "../domain/commands.js";
import type { Store } from "../domain/store.js";

/**
 * Day-to-day work on matters: tasks, file notes, and evidence requests (medical
 * records, reports, wage records) with automatic chase-up dates.
 */
export interface Task {
  id: string;
  tenantId: string;
  matterId?: string;
  title: string;
  detail?: string;
  assigneeId: string;
  dueOn?: IsoDate;
  status: "open" | "done" | "cancelled";
  source: "manual" | "request_chaser" | "assistant";
  requestId?: string;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

export interface FileNote {
  id: string;
  tenantId: string;
  matterId: string;
  kind: "attendance" | "phone" | "conference" | "note";
  text: string;
  occurredAt: string;
  minutes?: number;
  authorId: string;
  createdAt: string;
}

export interface EvidenceRequest {
  id: string;
  tenantId: string;
  matterId: string;
  kind: "medical_records" | "medical_report" | "police_report" | "wage_records" | "tax_records" | "insurer_file" | "other";
  provider: string;
  providerEmail?: string;
  description: string;
  requestedOn: IsoDate;
  /** Follow-up dates (default 14 and 28 days after the request). */
  chaseOn: IsoDate[];
  status: "requested" | "received" | "cancelled";
  receivedOn?: IsoDate;
  documentId?: string;
  invoiceCents?: number;
  createdBy: string;
}

const STAFF = ["principal", "solicitor", "paralegal", "accounts"] as const;
const today = () => new Date().toISOString().slice(0, 10);

export function workCommands(store: Store) {
  const tasks = store.collection<Task>("task");
  const notes = store.collection<FileNote>("file_note");
  const requests = store.collection<EvidenceRequest>("evidence_request");

  return [
    defineCommand({
      name: "create_task",
      title: "Create a task",
      description: "Create a task, optionally on a matter, assigned to a staff member (default: you).",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ matterId: z.string().optional(), title: z.string().min(1), detail: z.string().optional(), assigneeId: z.string().optional(), dueOn: z.iso.date().optional() }),
      matterIds: (i) => (i.matterId ? [i.matterId] : []),
      handler: (t, ctx) =>
        tasks.set({ ...t, id: randomUUID(), tenantId: ctx.actor.tenantId, assigneeId: t.assigneeId ?? ctx.actor.userId, status: "open", source: ctx.surface === "agent" || ctx.surface === "mcp" ? "assistant" : "manual", createdBy: ctx.actor.userId, createdAt: new Date().toISOString() }),
    }),
    defineCommand({
      name: "list_tasks",
      title: "Tasks",
      description: "Open tasks: yours by default, or for a matter. Overdue tasks are flagged.",
      tier: 0,
      input: z.object({ matterId: z.string().optional(), mine: z.boolean().default(true), includeDone: z.boolean().default(false) }),
      matterIds: (i) => (i.matterId ? [i.matterId] : []),
      handler: ({ matterId, mine, includeDone }, ctx) => {
        const visible = new Set(visibleMatters(store, ctx).map((m) => m.id));
        return tasks
          .list(ctx.actor.tenantId, (t) => (!matterId || t.matterId === matterId) && (!mine || !!matterId || t.assigneeId === ctx.actor.userId) && (includeDone || t.status === "open") && (!t.matterId || visible.has(t.matterId)))
          .map((t) => ({ ...t, overdue: t.status === "open" && !!t.dueOn && t.dueOn < today() }))
          .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
      },
    }),
    defineCommand({
      name: "update_task",
      title: "Update a task",
      description: "Complete, cancel, reassign or reschedule a task.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ taskId: z.string(), status: z.enum(["open", "done", "cancelled"]).optional(), assigneeId: z.string().optional(), dueOn: z.iso.date().optional(), title: z.string().optional() }),
      handler: ({ taskId, ...change }, ctx) => {
        const t = tasks.find(ctx.actor.tenantId, taskId);
        if (!t) throw notFound("Task");
        if (t.matterId && !visibleMatters(store, ctx).some((m) => m.id === t.matterId)) throw notFound("Task");
        const defined = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined));
        return tasks.set({ ...t, ...defined, ...(change.status === "done" ? { completedAt: new Date().toISOString() } : {}) });
      },
    }),

    defineCommand({
      name: "add_file_note",
      title: "Add a file note",
      description: "Record an attendance, phone call, conference or note on the matter file.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ matterId: z.string(), kind: z.enum(["attendance", "phone", "conference", "note"]).default("note"), text: z.string().min(1), occurredAt: z.iso.datetime().optional(), minutes: z.number().int().positive().optional() }),
      matterIds: (i) => [i.matterId],
      handler: (n, ctx) => notes.set({ ...n, id: randomUUID(), tenantId: ctx.actor.tenantId, occurredAt: n.occurredAt ?? new Date().toISOString(), authorId: ctx.actor.userId, createdAt: new Date().toISOString() }),
    }),
    defineCommand({
      name: "list_file_notes",
      title: "File notes",
      description: "File notes on a matter, newest first.",
      tier: 0,
      input: z.object({ matterId: z.string() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId }, ctx) => notes.list(ctx.actor.tenantId, (n) => n.matterId === matterId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    }),

    defineCommand({
      name: "log_evidence_request",
      title: "Log an evidence request",
      description: "Record a request for records or a report (e.g. hospital records, specialist report, wage records). Creates chase-up tasks at 14 and 28 days unless other dates are given.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        kind: z.enum(["medical_records", "medical_report", "police_report", "wage_records", "tax_records", "insurer_file", "other"]),
        provider: z.string().min(1),
        providerEmail: z.email().optional(),
        description: z.string().min(1),
        requestedOn: z.iso.date().optional(),
        chaseAfterDays: z.array(z.number().int().positive()).default([14, 28]),
      }),
      matterIds: (i) => [i.matterId],
      handler: ({ chaseAfterDays, requestedOn, ...r }, ctx) => {
        const on = requestedOn ?? today();
        const req = requests.set({ ...r, id: randomUUID(), tenantId: ctx.actor.tenantId, requestedOn: on, chaseOn: chaseAfterDays.map((d) => addDays(on, d)), status: "requested", createdBy: ctx.actor.userId });
        for (const due of req.chaseOn) {
          tasks.set({
            id: randomUUID(), tenantId: ctx.actor.tenantId, matterId: r.matterId, title: `Chase ${r.provider}: ${r.description}`, assigneeId: ctx.actor.userId, dueOn: due,
            status: "open", source: "request_chaser", requestId: req.id, createdBy: ctx.actor.userId, createdAt: new Date().toISOString(),
          });
        }
        return req;
      },
    }),
    defineCommand({
      name: "list_evidence_requests",
      title: "Evidence requests",
      description: "Outstanding (or all) evidence requests on a matter, or across your matters, with chase dates.",
      tier: 0,
      input: z.object({ matterId: z.string().optional(), outstandingOnly: z.boolean().default(true) }),
      matterIds: (i) => (i.matterId ? [i.matterId] : []),
      handler: ({ matterId, outstandingOnly }, ctx) => {
        const visible = new Set(visibleMatters(store, ctx).map((m) => m.id));
        return requests
          .list(ctx.actor.tenantId, (r) => visible.has(r.matterId) && (!matterId || r.matterId === matterId) && (!outstandingOnly || r.status === "requested"))
          .map((r) => ({ ...r, nextChase: r.chaseOn.find((d) => d >= today()) ?? null, overdue: r.status === "requested" && r.chaseOn.every((d) => d < today()) }))
          .sort((a, b) => a.requestedOn.localeCompare(b.requestedOn));
      },
    }),
    defineCommand({
      name: "mark_evidence_received",
      title: "Mark evidence received",
      description: "Mark a request as received (optionally linking the filed document and the provider's invoice) and close its chase-up tasks.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ matterId: z.string(), requestId: z.string(), documentId: z.string().optional(), invoiceCents: z.number().int().nonnegative().optional(), receivedOn: z.iso.date().optional() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, requestId, documentId, invoiceCents, receivedOn }, ctx) => {
        const r = requests.find(ctx.actor.tenantId, requestId);
        if (!r || r.matterId !== matterId) throw notFound("Request");
        for (const t of tasks.list(ctx.actor.tenantId, (t) => t.requestId === requestId && t.status === "open")) tasks.set({ ...t, status: "done", completedAt: new Date().toISOString() });
        return requests.set({ ...r, status: "received", receivedOn: receivedOn ?? today(), documentId, invoiceCents });
      },
    }),
  ];
}
