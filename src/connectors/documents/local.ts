import { createHash, randomUUID } from "node:crypto";
import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import {
  NameConflictError,
  type DocumentStore,
  type FileRef,
  type FolderRef,
  type MatterFolderSpec,
} from "../types.js";
import { assertItemName, matterFolderName } from "./naming.js";

/**
 * Filesystem document store for firms without a DMS, and for development.
 *
 * Ids are root-relative POSIX paths ("" is the root). Never deletes or overwrites:
 * bytes are written to a temp file and published with `link()`, which fails with EEXIST
 * instead of clobbering, so readers never see a partial file and a racing writer loses
 * cleanly. Moves and renames use the same link-then-unlink step.
 */
export interface LocalDocumentStoreOptions {
  root: string;
  /** Root-relative folder holding the matter folders; defaults to the root itself. */
  mattersFolder?: string;
}

const TEMP_PREFIX = ".practy-tmp-";

export class LocalDocumentStore implements DocumentStore {
  readonly kind = "local" as const;
  private readonly root: string;
  private readonly mattersFolder: string;

  constructor(opts: LocalDocumentStoreOptions) {
    this.root = path.resolve(opts.root);
    this.mattersFolder = normaliseId(opts.mattersFolder ?? "");
  }

  async findMatterFolder(number: string): Promise<FolderRef | null> {
    const matches = await this.matterFolders(number);
    return matches.length === 1 ? matches[0]! : null;
  }

  async ensureMatterFolder(spec: MatterFolderSpec): Promise<FolderRef> {
    const matches = await this.matterFolders(spec.number);
    if (matches.length > 1) {
      throw new Error(`Several folders are numbered ${spec.number}: ${matches.map((m) => m.name).join("; ")}`);
    }
    return matches[0] ?? this.ensureSubfolder(this.mattersFolder, matterFolderName(spec));
  }

  async ensureSubfolder(parentId: string, name: string): Promise<FolderRef> {
    assertItemName(name);
    const id = join(parentId, name);
    await fs.mkdir(this.abs(parentId), { recursive: true });
    try {
      await fs.mkdir(this.abs(id));
    } catch (e) {
      if (code(e) !== "EEXIST") throw e;
      if (!(await fs.stat(this.abs(id))).isDirectory()) throw new Error(`"${id}" exists and is not a folder`);
    }
    return this.folderRef(id);
  }

  async listFolder(folderId: string): Promise<{ folders: FolderRef[]; files: FileRef[] }> {
    const entries = await fs.readdir(this.abs(folderId), { withFileTypes: true });
    const folders: FolderRef[] = [];
    const files: FileRef[] = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(TEMP_PREFIX)) continue;
      const id = join(folderId, e.name);
      if (e.isDirectory()) folders.push(this.folderRef(id));
      else if (e.isFile()) files.push(this.fileRef(id, await fs.stat(this.abs(id))));
    }
    return { folders, files };
  }

  async upload(folderId: string, name: string, bytes: Uint8Array): Promise<FileRef> {
    assertItemName(name);
    const id = join(folderId, name);
    const dest = this.abs(id);
    const tmp = path.join(this.abs(folderId), `${TEMP_PREFIX}${randomUUID()}`);
    await fs.writeFile(tmp, bytes, { flag: "wx" });
    try {
      await this.linkNoClobber(tmp, dest, id);
    } finally {
      await fs.rm(tmp, { force: true });
    }
    const sha1 = createHash("sha1").update(bytes).digest("hex");
    return { ...this.fileRef(id, await fs.stat(dest)), sha1 };
  }

  async download(fileId: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(this.abs(fileId)));
  }

  move(fileId: string, toFolderId: string): Promise<FileRef> {
    return this.relocate(fileId, join(toFolderId, path.posix.basename(normaliseId(fileId))));
  }

  rename(fileId: string, newName: string): Promise<FileRef> {
    assertItemName(newName);
    return this.relocate(fileId, join(parentOf(fileId), newName));
  }

  /** Filesystems have no structured metadata store; a deliberate no-op. */
  async setMetadata(_fileId: string, _metadata: Record<string, string>): Promise<void> {}

  private async matterFolders(number: string): Promise<FolderRef[]> {
    const prefix = `${number.trim()} - `;
    let entries;
    try {
      entries = await fs.readdir(this.abs(this.mattersFolder), { withFileTypes: true });
    } catch (e) {
      if (code(e) === "ENOENT") return [];
      throw e;
    }
    return entries
      .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
      .map((e) => this.folderRef(join(this.mattersFolder, e.name)));
  }

  private async relocate(fromId: string, toId: string): Promise<FileRef> {
    const from = this.abs(fromId);
    if (!(await fs.stat(from)).isFile()) throw new Error(`"${fromId}" is not a file`);
    if (normaliseId(fromId) === toId) return this.fileRef(toId, await fs.stat(from));
    await this.linkNoClobber(from, this.abs(toId), toId);
    await fs.unlink(from);
    return this.fileRef(toId, await fs.stat(this.abs(toId)));
  }

  /**
   * `link()` is atomic and refuses to replace. Where hard links are unsupported (some
   * network or FAT volumes) fall back to an exclusive copy, which is still no-clobber.
   */
  private async linkNoClobber(src: string, dest: string, destId: string): Promise<void> {
    try {
      await fs.link(src, dest);
    } catch (e) {
      const c = code(e);
      if (c === "EEXIST") throw new NameConflictError(this.fileRef(destId, await fs.stat(dest)));
      if (c !== "EPERM" && c !== "ENOTSUP" && c !== "EXDEV" && c !== "EOPNOTSUPP") throw e;
      try {
        await fs.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
      } catch (e2) {
        if (code(e2) === "EEXIST") throw new NameConflictError(this.fileRef(destId, await fs.stat(dest)));
        throw e2;
      }
    }
  }

  /** Resolves an id under the root, refusing anything that escapes it. */
  private abs(id: string): string {
    const rel = normaliseId(id);
    return rel ? path.join(this.root, ...rel.split("/")) : this.root;
  }

  private folderRef(id: string): FolderRef {
    return { id, name: path.posix.basename(id) || path.basename(this.root), url: this.abs(id) };
  }

  private fileRef(id: string, st: Stats): FileRef {
    return {
      id,
      name: path.posix.basename(id),
      folderId: parentOf(id),
      size: st.size,
      modifiedAt: st.mtime.toISOString(),
      url: this.abs(id),
    };
  }
}

function normaliseId(id: string): string {
  const s = id.replaceAll("\\", "/");
  if (s === "" || s === ".") return "";
  if (s.startsWith("/") || s.includes("\0")) throw new Error(`Invalid document id: ${JSON.stringify(id)}`);
  const n = path.posix.normalize(s).replace(/\/$/, "");
  if (n === ".") return "";
  if (n === ".." || n.startsWith("../")) throw new Error(`Document id escapes the store root: ${JSON.stringify(id)}`);
  return n;
}

const join = (folderId: string, name: string) => normaliseId(path.posix.join(normaliseId(folderId), name));

function parentOf(id: string): string {
  const d = path.posix.dirname(normaliseId(id));
  return d === "." ? "" : d;
}

const code = (e: unknown) => (e as NodeJS.ErrnoException)?.code;
