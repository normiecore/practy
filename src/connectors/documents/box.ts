import { createHttp, HttpError, readBody, type ExpiringToken, type HttpClient } from "../http.js";
import {
  NameConflictError,
  type ConnectorDeps,
  type DocumentStore,
  type FileRef,
  type FolderRef,
  type MatterFolderSpec,
} from "../types.js";
import { assertItemName, isMatterFolderFor, matterFolderName } from "./naming.js";

/**
 * Box Content API v2.0 document store.
 *
 * No-overwrite is enforced by Box itself: uploads go to `POST /files/content` (never the
 * new-version endpoint) and renames/moves are a plain `PUT /files/:id`, all of which fail
 * with 409 `item_name_in_use` when the name is taken. There is no delete code path.
 */
export interface BoxDocumentStoreOptions extends ConnectorDeps {
  /** Folder holding the matter folders (Soul Legal: the PracticePanther root, ~2,000 folders). */
  mattersRootFolderId: string;
  baseUrl?: string;
  uploadUrl?: string;
}

interface BoxItem {
  type: "file" | "folder" | "web_link";
  id: string;
  name: string;
  size?: number;
  modified_at?: string;
  sha1?: string;
  parent?: { id: string } | null;
}

interface BoxError {
  code?: string;
  context_info?: { conflicts?: BoxItem | BoxItem[] };
}

const ITEM_FIELDS = "id,type,name,size,modified_at,sha1,parent";
const SEARCH_PAGE = 200;
/** Search is a lookup, not a crawl: a number matching more than this many folders is a bad query. */
const SEARCH_MAX_PAGES = 5;
const LIST_PAGE = 1000;

export class BoxDocumentStore implements DocumentStore {
  readonly kind = "box" as const;
  private readonly http: HttpClient;
  private readonly uploadUrl: string;

  constructor(private readonly opts: BoxDocumentStoreOptions) {
    this.http = createHttp({
      service: "Box",
      baseUrl: opts.baseUrl ?? "https://api.box.com/2.0",
      getAccessToken: opts.getAccessToken,
      fetch: opts.fetch,
    });
    this.uploadUrl = opts.uploadUrl ?? "https://upload.box.com/api/2.0/files/content";
  }

  /**
   * Uses the search API scoped to the root rather than listing ~2,000 folders. Search
   * matches anywhere in the tree and tokenises loosely, so results are narrowed to direct
   * children whose name starts with `<number> - `. Zero or several matches return null.
   */
  async findMatterFolder(number: string): Promise<FolderRef | null> {
    const matches = await this.searchMatterFolders(number);
    return matches.length === 1 ? matches[0]! : null;
  }

  /**
   * Box search indexing lags new folders by minutes, so before creating, a miss is
   * confirmed by listing the root. Several folders with the same number is a data problem
   * for a person to fix, so it throws rather than guessing.
   */
  async ensureMatterFolder(spec: MatterFolderSpec): Promise<FolderRef> {
    let matches = await this.searchMatterFolders(spec.number);
    if (matches.length === 0) {
      const { folders } = await this.listFolder(this.opts.mattersRootFolderId);
      matches = folders.filter((f) => isMatterFolderFor(f.name, spec.number));
    }
    if (matches.length > 1) {
      throw new Error(`Several Box folders are numbered ${spec.number}: ${matches.map((m) => m.name).join("; ")}`);
    }
    if (matches[0]) return matches[0];
    return this.createFolder(this.opts.mattersRootFolderId, matterFolderName(spec));
  }

  /** Fetches the folder and accepts it only as a direct child of the matters root named for `number`. */
  async getMatterFolder(folderId: string, number: string): Promise<FolderRef | null> {
    if (!folderId || folderId === this.opts.mattersRootFolderId) return null;
    const res = await this.http.raw(`/folders/${enc(folderId)}?fields=id,type,name,parent`, { allow: [404] });
    if (res.status === 404) return null;
    const item = (await res.json()) as BoxItem;
    if (item.type !== "folder" || item.parent?.id !== this.opts.mattersRootFolderId || !isMatterFolderFor(item.name, number)) return null;
    return folderRef(item);
  }

  ensureSubfolder(parentId: string, name: string): Promise<FolderRef> {
    return this.createFolder(parentId, name);
  }

  async listFolder(folderId: string): Promise<{ folders: FolderRef[]; files: FileRef[] }> {
    const folders: FolderRef[] = [];
    const files: FileRef[] = [];
    let marker: string | undefined;
    do {
      const params = new URLSearchParams({ fields: ITEM_FIELDS, limit: String(LIST_PAGE), usemarker: "true" });
      if (marker) params.set("marker", marker);
      const page = await this.http.json<{ entries: BoxItem[]; next_marker?: string | null }>(
        `/folders/${enc(folderId)}/items?${params}`,
      );
      for (const item of page.entries) {
        if (item.type === "folder") folders.push(folderRef(item));
        else if (item.type === "file") files.push(fileRef(item, folderId));
      }
      marker = page.next_marker || undefined;
    } while (marker);
    return { folders, files };
  }

  async upload(folderId: string, name: string, bytes: Uint8Array, contentType?: string): Promise<FileRef> {
    assertItemName(name);
    const form = new FormData();
    // Box requires the attributes part before the file part.
    form.append("attributes", JSON.stringify({ name, parent: { id: folderId } }));
    form.append("file", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType ?? "application/octet-stream" }), name);
    const res = await this.http.raw(`${this.uploadUrl}?fields=${ITEM_FIELDS}`, { method: "POST", body: form, allow: [409] });
    if (res.status === 409) throw await this.conflict(res, folderId, "POST", this.uploadUrl);
    const body = (await res.json()) as { entries: BoxItem[] };
    return fileRef(body.entries[0]!, folderId);
  }

  async download(fileId: string): Promise<Uint8Array> {
    // fetch follows Box's 302 to the pre-signed dl.boxcloud.com URL (dropping the bearer
    // cross-origin); a fetch that hands back the redirect is followed here without auth.
    const res = await this.http.raw(`/files/${enc(fileId)}/content`, { allow: [301, 302, 303, 307, 308] });
    const location = res.headers.get("location");
    if (res.status >= 300 && location) return this.http.bytes(location, { noAuth: true });
    if (res.status === 202) throw new Error(`Box file ${fileId} is not ready for download yet; retry later`);
    return new Uint8Array(await res.arrayBuffer());
  }

  move(fileId: string, toFolderId: string): Promise<FileRef> {
    return this.updateFile(fileId, { parent: { id: toFolderId } }, toFolderId);
  }

  async rename(fileId: string, newName: string): Promise<FileRef> {
    assertItemName(newName);
    return this.updateFile(fileId, { name: newName });
  }

  /**
   * Writes to the `global.properties` instance (free-form string key/values, no template
   * needed). Box rejects a second create with 409, so existing instances are patched:
   * `replace` for keys present, `add` for new ones.
   */
  async setMetadata(fileId: string, metadata: Record<string, string>): Promise<void> {
    const path = `/files/${enc(fileId)}/metadata/global/properties`;
    const created = await this.http.raw(path, { method: "POST", json: metadata, allow: [409] });
    if (created.status !== 409) return;
    const existing = await this.http.json<Record<string, unknown>>(path);
    const ops = Object.entries(metadata)
      .filter(([k, v]) => existing[k] !== v)
      .map(([k, v]) => ({ op: k in existing ? "replace" : "add", path: `/${jsonPointer(k)}`, value: v }));
    if (ops.length === 0) return;
    await this.http.raw(path, { method: "PUT", json: ops, headers: { "Content-Type": "application/json-patch+json" } });
  }

  private async searchMatterFolders(number: string): Promise<FolderRef[]> {
    const n = number.trim();
    if (!n) return [];
    const root = this.opts.mattersRootFolderId;
    const found: FolderRef[] = [];
    for (let page = 0, offset = 0; page < SEARCH_MAX_PAGES; page++) {
      const params = new URLSearchParams({
        query: n,
        type: "folder",
        ancestor_folder_ids: root,
        content_types: "name",
        fields: "id,type,name,parent",
        limit: String(SEARCH_PAGE),
        offset: String(offset),
      });
      const res = await this.http.json<{ entries: BoxItem[]; total_count: number }>(`/search?${params}`);
      for (const item of res.entries) {
        if (item.type === "folder" && item.parent?.id === root && isMatterFolderFor(item.name, n)) found.push(folderRef(item));
      }
      offset += res.entries.length;
      if (res.entries.length === 0 || offset >= res.total_count) break;
    }
    return found;
  }

  /** Create, or return the folder already holding that name (Box reports it in the 409). */
  private async createFolder(parentId: string, name: string): Promise<FolderRef> {
    assertItemName(name);
    const res = await this.http.raw(`/folders?fields=${ITEM_FIELDS}`, {
      method: "POST",
      json: { name, parent: { id: parentId } },
      allow: [409],
    });
    const body = (await readBody(res)) as BoxItem & BoxError;
    if (res.status !== 409) return folderRef(body);
    const existing = conflicts(body).find((c) => c.type === "folder");
    if (body.code === "item_name_in_use" && existing) return folderRef(existing);
    throw new HttpError("Box", "POST", "/folders", 409, body);
  }

  private async updateFile(fileId: string, change: object, folderId?: string): Promise<FileRef> {
    const path = `/files/${enc(fileId)}?fields=${ITEM_FIELDS}`;
    const res = await this.http.raw(path, { method: "PUT", json: change, allow: [409] });
    if (res.status === 409) throw await this.conflict(res, folderId, "PUT", path);
    const item = (await res.json()) as BoxItem;
    return fileRef(item, item.parent?.id ?? folderId ?? "");
  }

  /** Turns a 409 into NameConflictError carrying the existing file (fetched for full details). */
  private async conflict(res: Response, folderId: string | undefined, method: string, url: string): Promise<Error> {
    const body = (await readBody(res)) as BoxError;
    const hit = conflicts(body)[0];
    if (body?.code !== "item_name_in_use" || !hit) return new HttpError("Box", method, url, 409, body);
    if (hit.type !== "file") return new NameConflictError(fileRef(hit, folderId ?? ""), `A folder named "${hit.name}" already exists`);
    const full = await this.http.json<BoxItem>(`/files/${enc(hit.id)}?fields=${ITEM_FIELDS}`);
    return new NameConflictError(fileRef(full, folderId ?? ""));
  }
}

/** Box Client Credentials Grant: a service token for the enterprise, or acting as one user. */
export async function boxClientCredentialsToken(opts: {
  clientId: string;
  clientSecret: string;
  enterpriseId?: string;
  userId?: string;
  fetch?: typeof fetch;
  tokenUrl?: string;
}): Promise<ExpiringToken> {
  if (!opts.enterpriseId === !opts.userId) throw new Error("Give exactly one of enterpriseId or userId");
  const url = opts.tokenUrl ?? "https://api.box.com/oauth2/token";
  const res = await (opts.fetch ?? fetch)(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      box_subject_type: opts.enterpriseId ? "enterprise" : "user",
      box_subject_id: (opts.enterpriseId ?? opts.userId)!,
    }).toString(),
  });
  if (!res.ok) throw new HttpError("Box", "POST", url, res.status, await readBody(res));
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
}

const enc = encodeURIComponent;

/** RFC 6901 escaping for metadata keys used as JSON Patch paths. */
const jsonPointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

function conflicts(body: BoxError | undefined): BoxItem[] {
  const c = body?.context_info?.conflicts;
  return c ? (Array.isArray(c) ? c : [c]) : [];
}

function folderRef(item: BoxItem): FolderRef {
  return { id: item.id, name: item.name, url: `https://app.box.com/folder/${item.id}` };
}

function fileRef(item: BoxItem, fallbackFolderId: string): FileRef {
  return {
    id: item.id,
    name: item.name,
    folderId: item.parent?.id ?? fallbackFolderId,
    size: item.size ?? 0,
    modifiedAt: item.modified_at ?? "",
    ...(item.sha1 ? { sha1: item.sha1 } : {}),
    url: `https://app.box.com/file/${item.id}`,
  };
}
