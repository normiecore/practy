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
  createdAt: string;
  createdBy: string;
}

export const documentsOf = (store: { collection<T extends { id: string; tenantId: string }>(k: string): import("../core/collection.js").Collection<T> }) =>
  store.collection<MatterDocument>("document");
