import { randomUUID } from "node:crypto";
import { z } from "zod";
import { settingsFor } from "../admin/settings.js";
import { NameConflictError, type DocumentStore, type FileRef, type MailMessage } from "../connectors/types.js";
import { conflict, invalid, notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import type { Actor } from "../core/types.js";
import type { Matter } from "../domain/model.js";
import type { Store } from "../domain/store.js";
import { documentsOf, type MatterDocument } from "../documents/model.js";
import type { IntegrationHub } from "../integrations/hub.js";
import { DEFAULT_MISC, matchEmail, normaliseActionNumber, type MatchDecision, type MatterIndexEntry } from "./matcher.js";
import { attachmentName, emailBaseName } from "./naming.js";

export interface MailItem {
  id: string;
  tenantId: string;
  userId: string;
  mailbox: string;
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  decision: MatchDecision["decision"];
  confidence: number;
  evidence: string[];
  candidates: string[];
  matterId?: string;
  status: "filed" | "review" | "misc" | "dismissed" | "duplicate" | "error";
  filedVia?: "practy" | "label_bridge";
  filedBy?: string;
  filedAt?: string;
  documentIds?: string[];
  error?: string;
}

interface ThreadLink {
  id: string;
  tenantId: string;
  matterId: string;
}

interface Cursor {
  id: string;
  tenantId: string;
  since: string;
}

export interface SweepResult {
  processed: number;
  filed: number;
  review: number;
  misc: number;
  errors: number;
  capReached: boolean;
}

const surnameOf = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[parts.length - 1]! : parts[0]!).toLowerCase();
};

export const clientSortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts.at(-1)}, ${parts.slice(0, -1).join(" ")}` : name;
};

/**
 * Files mail into matters. Two modes (firm setting):
 *  - practy: renders the email to PDF and saves PDF, .eml and attachments into the
 *    matter's Emails folder, indexed as matter documents;
 *  - label_bridge: applies the firm's existing refile label so their current automation files it.
 * Never deletes and never overwrites: a name collision with identical size is a duplicate.
 */
export class FilingService {
  readonly items;
  private readonly threads;
  private readonly cursors;

  constructor(
    readonly store: Store,
    readonly hub: IntegrationHub,
    private readonly renderPdf: (m: MailMessage) => Promise<Uint8Array>,
  ) {
    this.items = store.collection<MailItem>("mail_item");
    this.threads = store.collection<ThreadLink>("mail_thread");
    this.cursors = store.collection<Cursor>("mail_cursor");
  }

  index(tenantId: string): MatterIndexEntry[] {
    return this.store.mattersFor(tenantId).map((m) => {
      const parties = m.parties.map((l) => ({ ...l, party: this.store.parties.get(l.partyId) }));
      const client = parties.find((p) => p.role === "client")?.party;
      return {
        matterId: m.id,
        number: m.number,
        status: m.status,
        clientName: client?.name ?? "",
        surnames: client ? [surnameOf(client.name)] : [],
        emails: parties.flatMap((p) => (p.party?.email ? [p.party.email.toLowerCase()] : [])),
        references: (m.references ?? []).flatMap((r) => normaliseActionNumber(r).concat(r.toLowerCase().trim())),
      };
    });
  }

  private firmDomains(tenantId: string, mailbox: string): string[] {
    const s = settingsFor(this.store, tenantId);
    const own = mailbox.split("@")[1]?.toLowerCase();
    return [...new Set([...s.identity.allowedDomains, ...(own ? [own] : [])])];
  }

  async sweep(actor: Actor, opts: { since?: string; max?: number } = {}): Promise<SweepResult> {
    const settings = settingsFor(this.store, actor.tenantId);
    if (settings.mail.filingMode === "off") throw conflict("Email filing is switched off (Settings → Email)");
    const mail = this.hub.mail(actor.tenantId, actor.userId);
    if (!mail) throw conflict("Your mailbox is not connected (Settings → Integrations)");
    const mailbox = (await mail.mailbox()).toLowerCase();
    const cursorId = `${actor.tenantId}:${mailbox}`;
    const since = opts.since ?? this.cursors.get(cursorId)?.since ?? new Date(Date.now() - 3 * 86_400_000).toISOString();
    const startedAt = new Date().toISOString();
    const ids = await mail.listMessages({ since, max: opts.max ?? 500 });
    const index = this.index(actor.tenantId);
    const cfg = { firmDomains: this.firmDomains(actor.tenantId, mailbox), ...DEFAULT_MISC };
    const result: SweepResult = { processed: 0, filed: 0, review: 0, misc: 0, errors: 0, capReached: false };

    for (const { id } of ids) {
      const itemId = `${actor.tenantId}:${mailbox}:${id}`;
      if (this.items.get(itemId)) continue;
      result.processed++;
      try {
        const msg = await mail.getMessage(id);
        const thread = this.threads.get(`${actor.tenantId}:${msg.threadId}`)?.matterId;
        const d = matchEmail(
          { subject: msg.subject, from: msg.from.email, to: msg.to.map((a) => a.email), cc: msg.cc.map((a) => a.email), body: msg.text, threadId: msg.threadId },
          index,
          thread,
          cfg,
        );
        let item: MailItem = this.items.set({
          id: itemId, tenantId: actor.tenantId, userId: actor.userId, mailbox, messageId: id, threadId: msg.threadId, subject: msg.subject,
          from: msg.from.email, date: msg.date, decision: d.decision, confidence: d.confidence, evidence: d.evidence, candidates: d.candidates,
          matterId: d.matterId, status: d.decision === "misc" ? "misc" : "review",
        });
        if (d.decision === "file" && settings.mail.autoFile) {
          if (result.filed >= settings.mail.autoFileCap) {
            result.capReached = true;
            result.review++;
            continue;
          }
          item = await this.file(actor, item, d.matterId!, msg);
          result.filed++;
        } else if (d.decision === "misc") result.misc++;
        else result.review++;
      } catch (err) {
        result.errors++;
        this.items.set({
          id: itemId, tenantId: actor.tenantId, userId: actor.userId, mailbox, messageId: id, threadId: "", subject: "", from: "", date: "",
          decision: "review", confidence: 0, evidence: [], candidates: [], status: "error", error: (err as Error).message,
        });
      }
    }
    if (!result.errors) this.cursors.set({ id: cursorId, tenantId: actor.tenantId, since: startedAt });
    return result;
  }

  /** Files one item to a matter (automatic or a human's choice from the review queue). */
  async file(actor: Actor, item: MailItem, matterId: string, msg?: MailMessage): Promise<MailItem> {
    const matter = this.store.matters.find(actor.tenantId, matterId);
    if (!matter) throw notFound("Matter");
    const settings = settingsFor(this.store, actor.tenantId);
    const mail = this.hub.mail(actor.tenantId, item.userId);
    if (!mail) throw conflict("Mailbox is not connected");

    if (settings.mail.filingMode === "label_bridge") {
      await mail.addLabel(item.messageId, `${settings.mail.refileLabelPrefix}${matter.number}`);
      this.threads.set({ id: `${actor.tenantId}:${item.threadId}`, tenantId: actor.tenantId, matterId });
      return this.items.set({ ...item, matterId, status: "filed", filedVia: "label_bridge", filedBy: actor.userId, filedAt: new Date().toISOString() });
    }

    const docs = this.hub.requireDocuments(actor.tenantId);
    const message = msg ?? (await mail.getMessage(item.messageId));
    const folder = await this.emailsFolder(docs, matter, settings.documents.schemeLabels[matter.scheme], settings.documents.emailsSubfolder);
    const domains = this.firmDomains(actor.tenantId, item.mailbox);
    const base = emailBaseName(message, domains);
    const time = message.date.slice(11, 16).replace(":", "");
    const files: { name: string; bytes: Uint8Array; type: string; kind: "email" | "eml" | "attachment" }[] = [
      { name: `${base}.pdf`, bytes: await this.renderPdf(message), type: "application/pdf", kind: "email" },
      { name: `${base}.eml`, bytes: await mail.getRaw(item.messageId), type: "message/rfc822", kind: "eml" },
    ];
    for (const att of message.attachments) {
      files.push({ name: attachmentName(message.date, att.filename), bytes: att.bytes ?? (await mail.getAttachment(item.messageId, att)), type: att.contentType, kind: "attachment" });
    }

    const documentIds: string[] = [];
    let duplicates = 0;
    for (const f of files) {
      const stored = await this.uploadOnce(docs, folder, f.name, f.bytes, f.type, time);
      if (stored.duplicate) duplicates++;
      if (f.kind === "eml") continue;
      const doc: MatterDocument = documentsOf(this.store).set({
        id: randomUUID(), tenantId: actor.tenantId, matterId, store: docs.kind, storeFileId: stored.file.id, folderId: folder,
        name: stored.file.name, contentType: f.type, size: f.bytes.length, sha1: stored.file.sha1, docDate: message.date.slice(0, 10),
        docType: f.kind === "email" ? "Email" : undefined, category: "Correspondence", source: "email", emailMessageId: item.messageId,
        createdAt: new Date().toISOString(), createdBy: actor.userId,
      });
      documentIds.push(doc.id);
    }
    this.threads.set({ id: `${actor.tenantId}:${item.threadId}`, tenantId: actor.tenantId, matterId });
    return this.items.set({
      ...item, matterId, status: duplicates === files.length ? "duplicate" : "filed", filedVia: "practy", filedBy: actor.userId,
      filedAt: new Date().toISOString(), documentIds,
    });
  }

  private async emailsFolder(docs: DocumentStore, matter: Matter, schemeLabel: string, sub: string): Promise<string> {
    let folderId = matter.links.boxFolderId;
    if (!folderId || docs.kind !== "box") {
      const found = await docs.findMatterFolder(matter.number);
      const client = matter.parties.find((p) => p.role === "client");
      const clientName = client ? (this.store.parties.get(client.partyId)?.name ?? matter.title) : matter.title;
      folderId = (found ?? (await docs.ensureMatterFolder({ number: matter.number, clientSortName: clientSortName(clientName), schemeLabel }))).id;
      if (docs.kind === "box") this.store.matters.set({ ...matter, links: { ...matter.links, boxFolderId: folderId } });
    }
    return (await docs.ensureSubfolder(folderId, sub)).id;
  }

  /** Upload without overwriting: identical size at the same name is a duplicate; otherwise add the time to the name. */
  private async uploadOnce(docs: DocumentStore, folderId: string, name: string, bytes: Uint8Array, type: string, time: string): Promise<{ file: FileRef; duplicate: boolean }> {
    try {
      return { file: await docs.upload(folderId, name, bytes, type), duplicate: false };
    } catch (err) {
      if (!(err instanceof NameConflictError)) throw err;
      if (err.existing.size === bytes.length) return { file: err.existing, duplicate: true };
      const timed = name.replace(/^(\d{4}\.\d{2}\.\d{2}) /, `$1 ${time} `);
      try {
        return { file: await docs.upload(folderId, timed, bytes, type), duplicate: false };
      } catch (err2) {
        if (err2 instanceof NameConflictError) return { file: err2.existing, duplicate: true };
        throw err2;
      }
    }
  }
}

/** Addresses an outbound email may go to: parties on the matter and anyone already corresponding on it. */
export function allowedRecipients(svc: FilingService, tenantId: string, matterId: string): Set<string> {
  const m = svc.store.matters.find(tenantId, matterId);
  const out = new Set<string>();
  for (const l of m?.parties ?? []) {
    const e = svc.store.parties.get(l.partyId)?.email;
    if (e) out.add(e.toLowerCase());
  }
  for (const i of svc.items.list(tenantId, (i) => i.matterId === matterId && i.status === "filed")) if (i.from) out.add(i.from.toLowerCase());
  return out;
}

export function filingCommands(svc: FilingService) {
  const checkRecipients = (tenantId: string, matterId: string, addresses: string[]) => {
    const allowed = allowedRecipients(svc, tenantId, matterId);
    const blocked = addresses.filter((a) => !allowed.has(a.toLowerCase()));
    if (blocked.length) throw invalid(`Not a party or correspondent on this matter: ${blocked.join(", ")}. Add them as a party first.`);
  };
  const own = (tenantId: string, userId: string, id: string) => {
    const item = svc.items.find(tenantId, id);
    if (!item || item.userId !== userId) throw notFound("Email");
    return item;
  };
  const STAFF = ["principal", "solicitor", "paralegal", "accounts"] as const;
  return [
    defineCommand({
      name: "run_mail_sweep",
      title: "File my email",
      description: "Check your mailbox for new mail, file strongly-matched emails to their matters and queue the rest for review.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ since: z.iso.datetime().optional(), max: z.number().int().positive().max(2000).optional() }),
      handler: (input, ctx) => svc.sweep(ctx.actor, input),
    }),
    defineCommand({
      name: "list_filing_queue",
      title: "Email review queue",
      description: "Emails from your mailbox waiting for a filing decision, with candidate matters and the evidence found.",
      tier: 0,
      input: z.object({ status: z.enum(["review", "filed", "misc", "dismissed", "duplicate", "error"]).default("review"), limit: z.number().int().positive().max(500).default(100) }),
      handler: ({ status, limit }, ctx) =>
        svc.items
          .list(ctx.actor.tenantId, (i) => i.userId === ctx.actor.userId && i.status === status)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, limit),
    }),
    defineCommand({
      name: "file_email",
      title: "File an email to a matter",
      description: "File an email from the review queue to the chosen matter (PDF, .eml and attachments, or the refile label in bridge mode).",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ itemId: z.string(), matterId: z.string() }),
      matterIds: (i) => [i.matterId],
      handler: async ({ itemId, matterId }, ctx) => {
        const item = own(ctx.actor.tenantId, ctx.actor.userId, itemId);
        if (item.status === "filed" && item.matterId === matterId) throw invalid("Already filed to this matter");
        return svc.file(ctx.actor, item, matterId);
      },
    }),
    defineCommand({
      name: "send_email",
      title: "Send an email on a matter",
      description:
        "Send an email from the approving practitioner's mailbox to parties or existing correspondents on the matter, optionally attaching matter documents. Outward-facing: requires practitioner approval. The sent email is filed to the matter.",
      tier: 2,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        to: z.array(z.email()).min(1),
        cc: z.array(z.email()).default([]),
        subject: z.string().min(1),
        body: z.string().min(1),
        attachDocumentIds: z.array(z.string()).default([]),
      }),
      matterIds: (i) => [i.matterId],
      precheck: ({ matterId, to, cc }, ctx) => checkRecipients(ctx.actor.tenantId, matterId, [...to, ...cc]),
      handler: async ({ matterId, to, cc, subject, body, attachDocumentIds }, ctx) => {
        checkRecipients(ctx.actor.tenantId, matterId, [...to, ...cc]);
        const mail = svc.hub.mail(ctx.actor.tenantId, ctx.actor.userId);
        if (!mail) throw conflict("Connect your mailbox first (Settings → Integrations)");
        const attachments = [];
        for (const id of attachDocumentIds) {
          const d = documentsOf(svc.store).find(ctx.actor.tenantId, id);
          if (!d || d.matterId !== matterId) throw notFound(`Document ${id}`);
          attachments.push({ filename: d.name, contentType: d.contentType, bytes: await svc.hub.requireDocuments(ctx.actor.tenantId).download(d.storeFileId) });
        }
        const sent = await mail.send({ to: to.map((email) => ({ email })), cc: cc.map((email) => ({ email })), subject, text: body, attachments });
        const mailbox = (await mail.mailbox()).toLowerCase();
        const item: MailItem = svc.items.set({
          id: `${ctx.actor.tenantId}:${mailbox}:${sent.id}`, tenantId: ctx.actor.tenantId, userId: ctx.actor.userId, mailbox, messageId: sent.id, threadId: sent.threadId,
          subject, from: mailbox, date: new Date().toISOString(), decision: "file", confidence: 1, evidence: ["sent from Practy"], candidates: [matterId], matterId, status: "review",
        });
        try {
          return await svc.file(ctx.actor, item, matterId);
        } catch (err) {
          // Sent successfully; filing can be retried from the review queue.
          return svc.items.set({ ...item, error: `Sent, but filing failed: ${(err as Error).message}` });
        }
      },
    }),
    defineCommand({
      name: "dismiss_email",
      title: "Not matter mail",
      description: "Mark an email in the review queue as not belonging to any matter.",
      tier: 1,
      input: z.object({ itemId: z.string() }),
      handler: ({ itemId }, ctx) => svc.items.set({ ...own(ctx.actor.tenantId, ctx.actor.userId, itemId), status: "dismissed" }),
    }),
  ];
}
