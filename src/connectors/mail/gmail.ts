import { createHttp, HttpError, type HttpClient } from "../http.js";
import type {
  ConnectorDeps,
  MailAttachment,
  MailMessage,
  MailQuery,
  MailSource,
  OutgoingMail,
} from "../types.js";
import { buildMime, decodeEncodedWords, decodeText, headerParam, htmlToText, parseAddressList } from "./mime.js";

/**
 * Gmail API v1 for the signed-in user (`users/me`).
 *
 * `format=full` bodies arrive already transfer-decoded (base64url of the raw octets), so
 * only the charset needs applying. Labels are addressed by name, as the firm's Apps Script
 * uses them (`Box Filed/Refile/1998`), and created on first use.
 */
export interface GmailMailSourceOptions extends ConnectorDeps {
  baseUrl?: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
  raw?: string;
}

interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

const LIST_PAGE_MAX = 500;
const DEFAULT_MAX = 100;

export class GmailMailSource implements MailSource {
  readonly kind = "gmail" as const;
  private readonly http: HttpClient;
  private labels?: Map<string, GmailLabel>;
  private address?: string;

  constructor(opts: GmailMailSourceOptions) {
    this.http = createHttp({
      service: "Gmail",
      baseUrl: opts.baseUrl ?? "https://gmail.googleapis.com/gmail/v1/users/me",
      getAccessToken: opts.getAccessToken,
      fetch: opts.fetch,
    });
  }

  async mailbox(): Promise<string> {
    this.address ??= (await this.http.json<{ emailAddress: string }>("/profile")).emailAddress;
    return this.address;
  }

  async listMessages(query: MailQuery): Promise<{ id: string; threadId: string }[]> {
    const max = query.max ?? DEFAULT_MAX;
    const q = [query.q, query.since ? `after:${Math.floor(Date.parse(query.since) / 1000)}` : undefined]
      .filter(Boolean)
      .join(" ");
    let labelId: string | undefined;
    if (query.label) {
      labelId = (await this.findLabel(query.label))?.id;
      if (!labelId) return [];
    }
    const out: { id: string; threadId: string }[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ maxResults: String(Math.min(LIST_PAGE_MAX, max - out.length)) });
      if (q) params.set("q", q);
      if (labelId) params.set("labelIds", labelId);
      if (pageToken) params.set("pageToken", pageToken);
      const page = await this.http.json<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(
        `/messages?${params}`,
      );
      for (const m of page.messages ?? []) out.push({ id: m.id, threadId: m.threadId });
      pageToken = page.nextPageToken;
    } while (pageToken && out.length < max);
    return out.slice(0, max);
  }

  async getMessage(id: string): Promise<MailMessage> {
    const m = await this.http.json<GmailMessage>(`/messages/${enc(id)}?format=full`);
    return toMailMessage(m);
  }

  async getAttachment(messageId: string, attachment: MailAttachment): Promise<Uint8Array> {
    if (attachment.bytes) return attachment.bytes;
    if (!attachment.providerAttachmentId) throw new Error(`Attachment "${attachment.filename}" has no Gmail attachment id`);
    const body = await this.http.json<{ data: string }>(
      `/messages/${enc(messageId)}/attachments/${enc(attachment.providerAttachmentId)}`,
    );
    return fromB64url(body.data);
  }

  async getRaw(id: string): Promise<Uint8Array> {
    const m = await this.http.json<GmailMessage>(`/messages/${enc(id)}?format=raw`);
    return fromB64url(m.raw ?? "");
  }

  async addLabel(messageId: string, label: string): Promise<void> {
    const l = await this.ensureLabel(label);
    await this.http.json(`/messages/${enc(messageId)}/modify`, { method: "POST", json: { addLabelIds: [l.id] } });
  }

  /** Removing a label that does not exist is a no-op, not a reason to create it. */
  async removeLabel(messageId: string, label: string): Promise<void> {
    const l = await this.findLabel(label);
    if (!l) return;
    await this.http.json(`/messages/${enc(messageId)}/modify`, { method: "POST", json: { removeLabelIds: [l.id] } });
  }

  /**
   * Replies thread by `threadId` plus In-Reply-To/References taken from the thread's last
   * message. Gmail only keeps the reply in the thread when the subject matches, so callers
   * replying should pass the thread's subject ("Re: …").
   */
  async send(mail: OutgoingMail): Promise<{ id: string; threadId: string }> {
    let reply: { inReplyTo?: string; references?: string } = {};
    if (mail.threadId) {
      const thread = await this.http.json<{ messages?: GmailMessage[] }>(
        `/threads/${enc(mail.threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
      );
      const last = thread.messages?.at(-1);
      const msgId = header(last?.payload, "Message-ID");
      if (msgId) reply = { inReplyTo: msgId, references: [header(last?.payload, "References"), msgId].filter(Boolean).join(" ") };
    }
    const raw = Buffer.from(buildMime(mail, reply)).toString("base64url");
    const sent = await this.http.json<{ id: string; threadId: string }>("/messages/send", {
      method: "POST",
      json: mail.threadId ? { raw, threadId: mail.threadId } : { raw },
    });
    return { id: sent.id, threadId: sent.threadId };
  }

  private async loadLabels(refresh = false): Promise<Map<string, GmailLabel>> {
    if (!this.labels || refresh) {
      const body = await this.http.json<{ labels?: GmailLabel[] }>("/labels");
      this.labels = new Map((body.labels ?? []).map((l) => [l.name.toLowerCase(), l]));
    }
    return this.labels;
  }

  /** Gmail label names are unique case-insensitively; system labels match by their id-name (INBOX). */
  private async findLabel(name: string): Promise<GmailLabel | undefined> {
    return (await this.loadLabels()).get(name.toLowerCase());
  }

  private async ensureLabel(name: string): Promise<GmailLabel> {
    const found = await this.findLabel(name);
    if (found) return found;
    try {
      const created = await this.http.json<GmailLabel>("/labels", {
        method: "POST",
        json: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
      });
      this.labels!.set(created.name.toLowerCase(), created);
      return created;
    } catch (e) {
      // Another process created it between our list and create.
      if (!(e instanceof HttpError) || e.status !== 409) throw e;
      const again = (await this.loadLabels(true)).get(name.toLowerCase());
      if (!again) throw e;
      return again;
    }
  }
}

/** Maps a `format=full` Gmail message. `labels` carries Gmail label ids (system labels are their own names). */
export function toMailMessage(m: GmailMessage): MailMessage {
  const p = m.payload;
  const body: { text?: string; html?: string; attachments: MailAttachment[] } = { attachments: [] };
  if (p) walk(p, body);
  const internetMessageId = header(p, "Message-ID");
  return {
    id: m.id,
    threadId: m.threadId,
    ...(internetMessageId ? { internetMessageId } : {}),
    from: parseAddressList(header(p, "From"))[0] ?? { email: "" },
    to: parseAddressList(header(p, "To")),
    cc: parseAddressList(header(p, "Cc")),
    subject: decodeEncodedWords(header(p, "Subject") ?? ""),
    date: messageDate(m),
    text: body.text ?? (body.html ? htmlToText(body.html) : ""),
    ...(body.html !== undefined ? { html: body.html } : {}),
    attachments: body.attachments,
    labels: m.labelIds ?? [],
  };
}

/**
 * Depth-first over the MIME tree. The first non-attachment text/plain and text/html leaves
 * are the body (the usual mixed → alternative → plain/html layout); every other leaf with
 * a filename, an attachment disposition, or a non-text type is an attachment.
 */
function walk(part: GmailPart, out: { text?: string; html?: string; attachments: MailAttachment[] }): void {
  if (part.parts?.length) {
    for (const child of part.parts) walk(child, out);
    return;
  }
  if (part.mimeType.startsWith("multipart/")) return;
  const disposition = header(part, "Content-Disposition") ?? "";
  const type = part.mimeType.toLowerCase();
  const isBodyText = (type === "text/plain" || type === "text/html") && !part.filename && !/^\s*attachment/i.test(disposition);
  if (isBodyText) {
    const charset = headerParam(header(part, "Content-Type"), "charset");
    const text = decodeText(fromB64url(part.body?.data ?? ""), charset);
    if (type === "text/plain") out.text ??= text;
    else out.html ??= text;
    return;
  }
  const filename =
    part.filename ||
    decodeEncodedWords(headerParam(header(part, "Content-Type"), "name") ?? headerParam(disposition, "filename") ?? "") ||
    "attachment";
  out.attachments.push({
    filename,
    contentType: part.mimeType,
    size: part.body?.size ?? 0,
    ...(part.body?.attachmentId ? { providerAttachmentId: part.body.attachmentId } : {}),
    ...(part.body?.data ? { bytes: fromB64url(part.body.data) } : {}),
  });
}

function header(part: GmailPart | undefined, name: string): string | undefined {
  const n = name.toLowerCase();
  return part?.headers?.find((h) => h.name.toLowerCase() === n)?.value;
}

function messageDate(m: GmailMessage): string {
  if (m.internalDate) return new Date(Number(m.internalDate)).toISOString();
  const d = Date.parse(header(m.payload, "Date") ?? "");
  return Number.isNaN(d) ? "" : new Date(d).toISOString();
}

const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const enc = encodeURIComponent;
