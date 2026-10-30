import type { DocumentStore, FolderRef, MatterFolderSpec } from "../connectors/types.js";
import { conflict, invalid } from "../core/errors.js";
import type { Matter } from "../domain/model.js";
import type { Store } from "../domain/store.js";

const linkedElsewhere = (store: Store, m: Pick<Matter, "id" | "tenantId">, folderId: string) =>
  store.matters.list(m.tenantId, (o) => o.id !== m.id && o.links.boxFolderId === folderId).length > 0;

/**
 * A matter's Box folder link must be that matter's own folder: a direct child of the
 * matters root named for its number, and linked to no other matter. Otherwise a staff
 * member could point an ordinary matter at the root, or at a walled matter's folder, and
 * index its files under a matter they can see.
 */
export async function checkMatterFolderLink(store: Store, ds: DocumentStore, m: Pick<Matter, "id" | "tenantId" | "number">, folderId: string): Promise<FolderRef> {
  if (linkedElsewhere(store, m, folderId)) throw conflict("That folder is already linked to another matter");
  const folder = await ds.getMatterFolder(folderId, m.number);
  if (!folder) throw invalid(`Folder ${folderId} is not the folder for matter ${m.number} in the matters root`);
  return folder;
}

/** The matter's folder id: the checked Box link, else found by number (or created) and, on Box, linked. */
export async function matterFolderId(store: Store, ds: DocumentStore, m: Matter, spec: () => MatterFolderSpec): Promise<string> {
  if (m.links.boxFolderId && ds.kind === "box") return (await checkMatterFolderLink(store, ds, m, m.links.boxFolderId)).id;
  const folder = (await ds.findMatterFolder(m.number)) ?? (await ds.ensureMatterFolder(spec()));
  if (linkedElsewhere(store, m, folder.id)) throw conflict(`The folder for matter ${m.number} is already linked to another matter`);
  if (ds.kind === "box") store.matters.set({ ...m, links: { ...m.links, boxFolderId: folder.id } });
  return folder.id;
}
