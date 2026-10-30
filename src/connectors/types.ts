/**
 * Contracts for external systems. Every connector takes `getAccessToken` and an
 * injectable `fetch` so tests run against fakes. Implementations live beside this file:
 *   documents/box.ts, documents/local.ts
 *   mail/gmail.ts, mail/graph.ts
 *   calendar/google.ts, calendar/graph.ts
 *   importers/practicepanther.ts, importers/csv.ts
 */

import type { Scheme } from "../domain/model.js";

export interface ConnectorDeps {
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
}

// ---------------------------------------------------------------- documents

export interface FolderRef {
  id: string;
  name: string;
  /** Web link for humans (Box URL or local path). */
  url?: string;
}

export interface FileRef {
  id: string;
  name: string;
  folderId: string;
  size: number;
  /** ISO timestamp of last modification in the store. */
  modifiedAt: string;
  sha1?: string;
  url?: string;
}

export interface MatterFolderSpec {
  /** e.g. "1998" */
  number: string;
  /** "Priestley, Toni" */
  clientSortName: string;
  /** Short scheme label used by the firm, e.g. "MVA", "WC". */
  schemeLabel: string;
}

export class NameConflictError extends Error {
  constructor(
    readonly existing: FileRef,
    message = `A file named "${existing.name}" already exists`,
  ) {
    super(message);
    this.name = "NameConflictError";
  }
}

/**
 * Document system of record (Box for the pilot; local/S3 storage for firms without a DMS).
 * Hard rules: never delete, never overwrite. Uploading or renaming onto an existing
 * name throws NameConflictError carrying the existing file.
 */
export interface DocumentStore {
  readonly kind: "box" | "local";
  /** Find the matter folder by its number (the name part before " - ") under the configured matters root. */
  findMatterFolder(number: string): Promise<FolderRef | null>;
  /** Create `<number> - <clientSortName> - <schemeLabel>` under the root if missing. */
  ensureMatterFolder(spec: MatterFolderSpec): Promise<FolderRef>;
  /** The folder with this id if it is the matter folder for `number` directly under the matters root, else null. */
  getMatterFolder(folderId: string, number: string): Promise<FolderRef | null>;
  ensureSubfolder(parentId: string, name: string): Promise<FolderRef>;
  listFolder(folderId: string): Promise<{ folders: FolderRef[]; files: FileRef[] }>;
  upload(folderId: string, name: string, bytes: Uint8Array, contentType?: string): Promise<FileRef>;
  download(fileId: string): Promise<Uint8Array>;
  move(fileId: string, toFolderId: string): Promise<FileRef>;
  rename(fileId: string, newName: string): Promise<FileRef>;
  /** Optional structured metadata (Box metadata templates); no-op where unsupported. */
  setMetadata(fileId: string, metadata: Record<string, string>): Promise<void>;
}

// ---------------------------------------------------------------- mail

export interface MailAddress {
  name?: string;
  email: string;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  size: number;
  /** Fetched lazily by getAttachment where the provider requires a second call. */
  bytes?: Uint8Array;
  providerAttachmentId?: string;
}

export interface MailMessage {
  id: string;
  threadId: string;
  /** RFC 2822 Message-ID header, for de-duplication across mailboxes. */
  internetMessageId?: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  /** ISO timestamp. */
  date: string;
  text: string;
  html?: string;
  attachments: MailAttachment[];
  labels: string[];
}

export interface MailQuery {
  /** ISO timestamp lower bound (inclusive). */
  since?: string;
  /** Provider-native query (Gmail search syntax / Graph $search). */
  q?: string;
  /** Gmail label name or Outlook category (labels map to categories, as in addLabel). */
  label?: string;
  max?: number;
}

export interface OutgoingMail {
  to: MailAddress[];
  cc?: MailAddress[];
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; contentType: string; bytes: Uint8Array }[];
  /** Reply within this thread when set. */
  threadId?: string;
}

export interface MailSource {
  readonly kind: "gmail" | "graph";
  /** The mailbox owner's address. */
  mailbox(): Promise<string>;
  listMessages(query: MailQuery): Promise<{ id: string; threadId: string }[]>;
  getMessage(id: string): Promise<MailMessage>;
  getAttachment(messageId: string, attachment: MailAttachment): Promise<Uint8Array>;
  /** Raw RFC 822 (.eml) bytes. */
  getRaw(id: string): Promise<Uint8Array>;
  addLabel(messageId: string, label: string): Promise<void>;
  removeLabel(messageId: string, label: string): Promise<void>;
  send(mail: OutgoingMail): Promise<{ id: string; threadId: string }>;
}

// ---------------------------------------------------------------- calendar

export interface CalendarEvent {
  /** Practy key date id; stored on the event so sync is idempotent. */
  practyId: string;
  title: string;
  /** All-day event date (YYYY-MM-DD). */
  date: string;
  description: string;
  /** Reminder minutes before start. */
  reminders?: number[];
}

export interface CalendarSink {
  readonly kind: "google" | "graph";
  /** Create or update the event carrying `practyId`; returns the provider event id. */
  upsert(event: CalendarEvent): Promise<string>;
  remove(practyId: string): Promise<void>;
}

// ---------------------------------------------------------------- importers

export interface ImportedMatter {
  externalId: string;
  number: string;
  title: string;
  /** Raw matter type / practice area text from the source system. */
  matterType?: string;
  /** Pilot scheme recognised from the matter type, when it is one Practy has rules for. */
  scheme?: Scheme;
  status: "open" | "closed";
  openedOn?: string;
  injuryDate?: string;
  client: { name: string; email?: string; phone?: string; dateOfBirth?: string; address?: string };
  otherParties: { name: string; role: string }[];
  responsibleStaff?: string;
  notes?: string;
}

export interface MatterImporter {
  readonly kind: "practicepanther" | "csv";
  listMatters(): Promise<ImportedMatter[]>;
}
