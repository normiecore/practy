import { createHttp, odataString, type HttpClient } from "../http.js";
import type {
  ConnectorDeps,
  MailAddress,
  MailAttachment,
  MailMessage,
  MailQuery,
  MailSource,
  OutgoingMail,
} from "../types.js";
import { htmlToText } from "./mime.js";

/**
 * Microsoft Graph v1.0 mail for the signed-in user (`/me`).
 *
 * - Every request asks for immutable ids (`Prefer: IdType="ImmutableId"`), so ids survive
 *   moves between folders and a sent draft keeps its id in Sent Items.
 * - Labels map to Outlook categories (Gmail-style tags on a message, not folders).
 *   Categories need not exist in the master category list to be applied.
 * - `threadId` is the Graph `conversationId`.
 */
export interface GraphMailSourceOptions extends ConnectorDeps {
  baseUrl?: string;
}

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessage {
  id: string;
  conversationId: string;
  internetMessageId?: string;
  subject?: string | null;
  receivedDateTime?: string;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  body?: { contentType: "text" | "html"; content: string };
  categories?: string[];
  hasAttachments?: boolean;
}

interface GraphAttachment {
  "@odata.type": string;
  id: string;
  name: string;
  contentType?: string | null;
  size: number;
  isInline?: boolean;
}

interface Page<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

const DEFAULT_MAX = 100;
const PAGE_MAX = 100;
/** Inline attachments in a create/attach call are limited to 3 MB; larger ones need an upload session. */
const INLINE_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
const MESSAGE_FIELDS =
  "id,conversationId,internetMessageId,subject,receivedDateTime,from,toRecipients,ccRecipients,body,categories,hasAttachments";

export class GraphMailSource implements MailSource {
  readonly kind = "graph" as const;
  private readonly http: HttpClient;
  private address?: string;

  constructor(opts: GraphMailSourceOptions) {
    this.http = createHttp({
      service: "Microsoft Graph",
      baseUrl: opts.baseUrl ?? "https://graph.microsoft.com/v1.0/me",
      getAccessToken: opts.getAccessToken,
      fetch: opts.fetch,
      headers: { Prefer: 'IdType="ImmutableId"' },
    });
  }

  async mailbox(): Promise<string> {
    if (!this.address) {
      const me = await this.http.json<{ mail?: string | null; userPrincipalName: string }>("?$select=mail,userPrincipalName");
      this.address = me.mail || me.userPrincipalName;
    }
    return this.address;
  }

  /**
   * Graph cannot combine `$search` with `$filter`, so with a provider query `since` and
   * `label` are applied to the returned page instead; otherwise both go in `$filter`.
   */
  async listMessages(query: MailQuery): Promise<{ id: string; threadId: string }[]> {
    const max = query.max ?? DEFAULT_MAX;
    const params = new URLSearchParams({
      $select: "id,conversationId,receivedDateTime,categories",
      $top: String(Math.min(PAGE_MAX, max)),
    });
    const filters = [
      query.since ? `receivedDateTime ge ${new Date(query.since).toISOString()}` : undefined,
      query.label ? `categories/any(c:c eq ${odataString(query.label)})` : undefined,
    ].filter(Boolean);
    if (query.q) params.set("$search", `"${query.q.replace(/(["\\])/g, "\\$1")}"`);
    else if (filters.length) {
      params.set("$filter", filters.join(" and "));
      if (query.since) params.set("$orderby", "receivedDateTime desc");
    }
    const sinceMs = query.since ? Date.parse(query.since) : undefined;
    const label = query.label?.toLowerCase();
    const keep = (m: GraphMessage) =>
      !query.q ||
      ((sinceMs === undefined || Date.parse(m.receivedDateTime ?? "") >= sinceMs) &&
        (!label || (m.categories ?? []).some((c) => c.toLowerCase() === label)));

    const out: { id: string; threadId: string }[] = [];
    let url: string | undefined = `/messages?${params}`;
    while (url && out.length < max) {
      const page: Page<GraphMessage> = await this.http.json<Page<GraphMessage>>(url);
      for (const m of page.value) if (keep(m)) out.push({ id: m.id, threadId: m.conversationId });
      url = page["@odata.nextLink"];
    }
    return out.slice(0, max);
  }

  async getMessage(id: string): Promise<MailMessage> {
    const m = await this.http.json<GraphMessage>(`/messages/${enc(id)}?$select=${MESSAGE_FIELDS}`);
    const attachments = m.hasAttachments ? await this.listAttachments(id) : [];
    const html = m.body?.contentType === "html" ? m.body.content : undefined;
    return {
      id: m.id,
      threadId: m.conversationId,
      ...(m.internetMessageId ? { internetMessageId: m.internetMessageId } : {}),
      from: address(m.from) ?? { email: "" },
      to: (m.toRecipients ?? []).flatMap((r) => address(r) ?? []),
      cc: (m.ccRecipients ?? []).flatMap((r) => address(r) ?? []),
      subject: m.subject ?? "",
      date: m.receivedDateTime ? new Date(m.receivedDateTime).toISOString() : "",
      text: html !== undefined ? htmlToText(html) : (m.body?.content ?? ""),
      ...(html !== undefined ? { html } : {}),
      attachments,
      labels: m.categories ?? [],
    };
  }

  async getAttachment(messageId: string, attachment: MailAttachment): Promise<Uint8Array> {
    if (attachment.bytes) return attachment.bytes;
    if (!attachment.providerAttachmentId) throw new Error(`Attachment "${attachment.filename}" has no Graph attachment id`);
    return this.http.bytes(`/messages/${enc(messageId)}/attachments/${enc(attachment.providerAttachmentId)}/$value`);
  }

  getRaw(id: string): Promise<Uint8Array> {
    return this.http.bytes(`/messages/${enc(id)}/$value`);
  }

  addLabel(messageId: string, label: string): Promise<void> {
    return this.updateCategories(messageId, (cs) => (cs.some((c) => same(c, label)) ? undefined : [...cs, label]));
  }

  removeLabel(messageId: string, label: string): Promise<void> {
    return this.updateCategories(messageId, (cs) => (cs.some((c) => same(c, label)) ? cs.filter((c) => !same(c, label)) : undefined));
  }

  /**
   * Sends through a draft (create, then `/send`) rather than `/sendMail`, because
   * `/sendMail` returns no id. Replies use `createReply` on the conversation's latest
   * message so Outlook threads them and sets In-Reply-To/References itself.
   */
  async send(mail: OutgoingMail): Promise<{ id: string; threadId: string }> {
    for (const a of mail.attachments ?? []) {
      if (a.bytes.byteLength > INLINE_ATTACHMENT_LIMIT) {
        throw new Error(`Attachment "${a.filename}" exceeds 3 MB; Graph upload sessions are not supported yet`);
      }
    }
    const content = {
      body: mail.html !== undefined ? { contentType: "html", content: mail.html } : { contentType: "text", content: mail.text },
      toRecipients: mail.to.map(recipient),
      ccRecipients: (mail.cc ?? []).map(recipient),
    };
    const attachments = (mail.attachments ?? []).map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.filename,
      contentType: a.contentType,
      contentBytes: Buffer.from(a.bytes).toString("base64"),
    }));

    let draft: GraphMessage;
    if (mail.threadId) {
      const latest = await this.latestInConversation(mail.threadId);
      draft = await this.http.json<GraphMessage>(`/messages/${enc(latest)}/createReply`, { method: "POST", json: {} });
      await this.http.raw(`/messages/${enc(draft.id)}`, { method: "PATCH", json: { subject: mail.subject, ...content } });
      for (const a of attachments) {
        await this.http.raw(`/messages/${enc(draft.id)}/attachments`, { method: "POST", json: a });
      }
    } else {
      draft = await this.http.json<GraphMessage>("/messages", {
        method: "POST",
        json: { subject: mail.subject, ...content, ...(attachments.length ? { attachments } : {}) },
      });
    }
    await this.http.raw(`/messages/${enc(draft.id)}/send`, { method: "POST" });
    return { id: draft.id, threadId: draft.conversationId };
  }

  private async listAttachments(messageId: string): Promise<MailAttachment[]> {
    const out: MailAttachment[] = [];
    let url: string | undefined = `/messages/${enc(messageId)}/attachments?$select=id,name,contentType,size,isInline`;
    while (url) {
      const page: Page<GraphAttachment> = await this.http.json<Page<GraphAttachment>>(url);
      for (const a of page.value) {
        // Reference attachments are cloud links with no bytes to file.
        if (a["@odata.type"] === "#microsoft.graph.referenceAttachment") continue;
        const item = a["@odata.type"] === "#microsoft.graph.itemAttachment";
        out.push({
          filename: item && !/\.eml$/i.test(a.name) ? `${a.name}.eml` : a.name,
          contentType: a.contentType || (item ? "message/rfc822" : "application/octet-stream"),
          size: a.size,
          providerAttachmentId: a.id,
        });
      }
      url = page["@odata.nextLink"];
    }
    return out;
  }

  /**
   * Filtering on conversationId and ordering by date in one query is rejected as too
   * complex by Exchange, so the newest is picked client-side.
   */
  private async latestInConversation(conversationId: string): Promise<string> {
    const params = new URLSearchParams({
      $filter: `conversationId eq ${odataString(conversationId)}`,
      $select: "id,receivedDateTime",
      $top: "100",
    });
    const all: GraphMessage[] = [];
    let url: string | undefined = `/messages?${params}`;
    while (url) {
      const page: Page<GraphMessage> = await this.http.json<Page<GraphMessage>>(url);
      all.push(...page.value);
      url = page["@odata.nextLink"];
    }
    const latest = all.sort((a, b) => (b.receivedDateTime ?? "").localeCompare(a.receivedDateTime ?? ""))[0];
    if (!latest) throw new Error(`No messages found in conversation ${conversationId}`);
    return latest.id;
  }

  private async updateCategories(messageId: string, change: (current: string[]) => string[] | undefined): Promise<void> {
    const m = await this.http.json<GraphMessage>(`/messages/${enc(messageId)}?$select=categories`);
    const next = change(m.categories ?? []);
    if (!next) return;
    await this.http.raw(`/messages/${enc(messageId)}`, { method: "PATCH", json: { categories: next } });
  }
}

function address(r: GraphRecipient | null | undefined): MailAddress | undefined {
  const a = r?.emailAddress;
  if (!a?.address) return undefined;
  return a.name && a.name !== a.address ? { name: a.name, email: a.address } : { email: a.address };
}

const recipient = (a: MailAddress) => ({ emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) } });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const enc = encodeURIComponent;
