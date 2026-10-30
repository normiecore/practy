import { NameConflictError, type DocumentStore, type FileRef, type FolderRef, type MailAttachment, type MailMessage, type MailQuery, type MailSource, type MatterFolderSpec, type OutgoingMail } from "../src/connectors/types.js";

/** In-memory DocumentStore with the same never-overwrite semantics as Box. */
export class FakeDocumentStore implements DocumentStore {
  readonly kind = "box" as const;
  readonly folders = new Map<string, { name: string; parent: string }>([["root", { name: "Matters", parent: "" }]]);
  readonly files = new Map<string, { ref: FileRef; bytes: Uint8Array }>();
  private seq = 0;

  async findMatterFolder(number: string): Promise<FolderRef | null> {
    const hits = [...this.folders].filter(([, f]) => f.parent === "root" && f.name.startsWith(`${number} - `));
    return hits.length === 1 ? { id: hits[0]![0], name: hits[0]![1].name } : null;
  }
  async ensureMatterFolder(spec: MatterFolderSpec) {
    return (await this.findMatterFolder(spec.number)) ?? this.ensureSubfolder("root", `${spec.number} - ${spec.clientSortName} - ${spec.schemeLabel}`);
  }
  async ensureSubfolder(parentId: string, name: string) {
    const hit = [...this.folders].find(([, f]) => f.parent === parentId && f.name === name);
    if (hit) return { id: hit[0], name };
    const id = `fo${++this.seq}`;
    this.folders.set(id, { name, parent: parentId });
    return { id, name };
  }
  async listFolder(folderId: string) {
    return {
      folders: [...this.folders].filter(([, f]) => f.parent === folderId).map(([id, f]) => ({ id, name: f.name })),
      files: [...this.files.values()].filter((f) => f.ref.folderId === folderId).map((f) => f.ref),
    };
  }
  async upload(folderId: string, name: string, bytes: Uint8Array) {
    const existing = [...this.files.values()].find((f) => f.ref.folderId === folderId && f.ref.name === name);
    if (existing) throw new NameConflictError(existing.ref);
    const ref: FileRef = { id: `fi${++this.seq}`, name, folderId, size: bytes.length, modifiedAt: new Date().toISOString() };
    this.files.set(ref.id, { ref, bytes });
    return ref;
  }
  async download(fileId: string) {
    return this.files.get(fileId)!.bytes;
  }
  async move(fileId: string, toFolderId: string) {
    const f = this.files.get(fileId)!;
    f.ref = { ...f.ref, folderId: toFolderId };
    return f.ref;
  }
  async rename(fileId: string, newName: string) {
    const f = this.files.get(fileId)!;
    f.ref = { ...f.ref, name: newName };
    return f.ref;
  }
  async setMetadata() {}
  namesIn(folderName: string): string[] {
    const ids = [...this.folders].filter(([, f]) => f.name === folderName).map(([id]) => id);
    return [...this.files.values()].filter((f) => ids.includes(f.ref.folderId)).map((f) => f.ref.name).sort();
  }
}

export class FakeMailSource implements MailSource {
  readonly kind = "gmail" as const;
  readonly labels = new Map<string, string[]>();
  readonly sent: OutgoingMail[] = [];
  constructor(
    readonly address: string,
    readonly messages: MailMessage[],
  ) {}
  async mailbox() {
    return this.address;
  }
  async listMessages(q: MailQuery) {
    return this.messages.filter((m) => !q.since || m.date >= q.since).map((m) => ({ id: m.id, threadId: m.threadId }));
  }
  async getMessage(id: string) {
    return this.messages.find((m) => m.id === id)!;
  }
  async getAttachment(_id: string, a: MailAttachment) {
    return a.bytes ?? new Uint8Array(a.size);
  }
  async getRaw(id: string) {
    return new TextEncoder().encode(`Message-ID: <${id}>\r\n\r\nraw`);
  }
  async addLabel(id: string, label: string) {
    this.labels.set(id, [...(this.labels.get(id) ?? []), label]);
  }
  async removeLabel() {}
  async send(m: OutgoingMail) {
    this.sent.push(m);
    const id = `s${this.sent.length}`;
    const threadId = m.threadId ?? `t-${id}`;
    this.messages.push({ id, threadId, from: { email: this.address }, to: m.to, cc: m.cc ?? [], subject: m.subject, date: new Date().toISOString(), text: m.text, attachments: [], labels: [] });
    return { id, threadId };
  }
}

export const mail = (p: Partial<MailMessage> & Pick<MailMessage, "id" | "subject">): MailMessage => ({
  threadId: `t-${p.id}`,
  from: { email: "someone@example.com" },
  to: [{ email: "kevin@soullegal.com.au", name: "Kevin Wong" }],
  cc: [],
  date: "2026-10-28T01:30:00.000Z",
  text: "",
  attachments: [],
  labels: [],
  ...p,
});
