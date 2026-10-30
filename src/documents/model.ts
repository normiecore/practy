/**
 * Practy's index of matter documents. The bytes live in the firm's document store
 * (Box for the pilot); Practy keeps the pointer plus legal metadata.
 */
export interface MatterDocument {
  id: string;
  tenantId: string;
  matterId: string;
  store: "box" | "local";
  storeFileId: string;
  folderId: string;
  name: string;
  contentType: string;
  size: number;
  sha1?: string;
  /** The document's own date (naming convention), not the upload date. */
  docDate?: string;
  docType?: string;
  /** Form 17 / filing category, e.g. "Medical Reports". */
  category?: string;
  source: "email" | "upload" | "generated" | "import";
  emailMessageId?: string;
  /** Affidavit, witness statement or expert evidence: generative drafting is blocked. */
  evidence?: boolean;
  /** Suppressed, privileged or implied-undertaking material: excluded from AI processing. */
  aiExcluded?: boolean;
  aiExcludedReason?: string;
  /** Source documents this one was compiled or converted from; their evidence and AI-exclusion flags carry over. */
  derivedFrom?: string[];
  createdAt: string;
  createdBy: string;
}

export const documentsOf = (store: { collection<T extends { id: string; tenantId: string }>(k: string): import("../core/collection.js").Collection<T> }) =>
  store.collection<MatterDocument>("document");

/**
 * An AI-excluded document with the same content, anywhere in the firm. Copies of excluded content
 * (re-filed email, files a firm's own automation put in another matter's folder) stay excluded.
 */
export const excludedTwin = (
  store: Parameters<typeof documentsOf>[0],
  tenantId: string,
  f: { sha1?: string; emailMessageId?: string; name?: string },
): MatterDocument | undefined =>
  documentsOf(store).list(
    tenantId,
    (d) => !!d.aiExcluded && ((!!f.sha1 && d.sha1 === f.sha1) || (!!f.emailMessageId && d.emailMessageId === f.emailMessageId && d.name === f.name)),
  )[0];
