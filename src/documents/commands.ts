import { randomUUID } from "node:crypto";
import { z } from "zod";
import { settingsFor } from "../admin/settings.js";
import { usersOf } from "../admin/commands.js";
import { NameConflictError, type DocumentStore, type FileRef } from "../connectors/types.js";
import { conflict, invalid, notFound } from "../core/errors.js";
import { defineCommand } from "../core/registry.js";
import type { InvocationContext } from "../core/types.js";
import type { StoredAuthority, StoredDamages } from "../damages/commands.js";
import type { DamagesModel } from "../damages/engine.js";
import { fillFirmAuthorityForm } from "../docgen/authority.js";
import { fillTagged } from "../docgen/docx.js";
import { buildListOfDocuments, categoriseForForm17 } from "../docgen/form17.js";
import { buildLetterOnLetterhead } from "../docgen/letter.js";
import { tracksToMarkup } from "../docgen/markup.js";
import { checkDocumentName, formatDocumentName, type DocumentNameSpec } from "../docgen/naming.js";
import { renderParticulars, type ParticularsBlock, type ParticularsDocument } from "../docgen/particulars.js";
import { buildMasterBook } from "../docgen/pdf.js";
import type { Matter } from "../domain/model.js";
import type { Store } from "../domain/store.js";
import { clientSortName } from "../filing/service.js";
import type { IntegrationHub } from "../integrations/hub.js";
import { documentsOf, type MatterDocument } from "./model.js";

export interface Template {
  id: string;
  tenantId: string;
  kind: "authority_form" | "letterhead" | "tagged";
  name: string;
  base64: string;
  uploadedAt: string;
  uploadedBy: string;
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const STAFF = ["principal", "solicitor", "paralegal"] as const;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const todayIso = () => new Date().toISOString().slice(0, 10);
const dotted = (iso: string) => iso.slice(0, 10).replaceAll("-", ".");
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmt = (cents: number) => `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nameSpec = z.record(z.string(), z.unknown());

/**
 * Document handling: the matter document index, imports from the firm's document
 * store, uploads, and generation from the firm's own templates. Everything generated
 * is saved as a draft in the matter folder; sending or filing it is a separate,
 * approved step.
 */
export function documentCommands(store: Store, hub: IntegrationHub) {
  const docs = documentsOf(store);
  const templates = store.collection<Template>("template");

  const matterOf = (ctx: InvocationContext, matterId: string): Matter => {
    const m = store.matters.find(ctx.actor.tenantId, matterId);
    if (!m) throw notFound("Matter");
    return m;
  };
  const partiesOf = (m: Matter) => m.parties.map((l) => ({ role: l.role, party: store.parties.get(l.partyId)! })).filter((p) => p.party);
  const clientOf = (m: Matter) => partiesOf(m).find((p) => p.role === "client")?.party;

  async function matterFolder(ds: DocumentStore, m: Matter): Promise<string> {
    if (m.links.boxFolderId && ds.kind === "box") return m.links.boxFolderId;
    const s = settingsFor(store, m.tenantId);
    const found = await ds.findMatterFolder(m.number);
    const folder = found ?? (await ds.ensureMatterFolder({ number: m.number, clientSortName: clientSortName(clientOf(m)?.name ?? m.title), schemeLabel: s.documents.schemeLabels[m.scheme] }));
    if (ds.kind === "box") store.matters.set({ ...m, links: { ...m.links, boxFolderId: folder.id } });
    return folder.id;
  }

  /** Saves bytes into the matter (never overwriting: a clash adds the time) and indexes them. */
  async function save(ctx: InvocationContext, m: Matter, name: string, bytes: Uint8Array, contentType: string, extra: Partial<MatterDocument> = {}, subfolder?: string): Promise<MatterDocument> {
    const ds = hub.requireDocuments(ctx.actor.tenantId);
    const root = await matterFolder(ds, m);
    const sub = subfolder ?? settingsFor(store, m.tenantId).documents.generatedSubfolder;
    const folderId = sub ? (await ds.ensureSubfolder(root, sub)).id : root;
    let file: FileRef;
    try {
      file = await ds.upload(folderId, name, bytes, contentType);
    } catch (err) {
      if (!(err instanceof NameConflictError)) throw err;
      const t = new Date().toISOString().slice(11, 16).replace(":", "");
      file = await ds.upload(folderId, name.replace(/^(\d{4}\.\d{2}\.\d{2}) /, `$1 ${t} `).replace(/^(?!\d{4}\.)/, `${t} `), bytes, contentType);
    }
    return docs.set({
      id: randomUUID(), tenantId: ctx.actor.tenantId, matterId: m.id, store: ds.kind, storeFileId: file.id, folderId, name: file.name, contentType,
      size: bytes.length, sha1: file.sha1, docDate: todayIso(), source: "generated", createdAt: new Date().toISOString(), createdBy: ctx.actor.userId, ...extra,
    });
  }

  const template = (tenantId: string, kind: Template["kind"], id?: string) => {
    const list = templates.list(tenantId, (t) => t.kind === kind && (!id || t.id === id)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    if (!list[0]) throw conflict(`Upload the firm's ${kind.replace("_", " ")} template first (Settings → Templates)`);
    return new Uint8Array(Buffer.from(list[0].base64, "base64"));
  };

  const loadPdf = async (ctx: InvocationContext, matterId: string, documentId: string) => {
    const d = docs.find(ctx.actor.tenantId, documentId);
    if (!d || d.matterId !== matterId) throw notFound(`Document ${documentId}`);
    if (!/pdf/i.test(d.contentType) && !d.name.toLowerCase().endsWith(".pdf")) throw invalid(`${d.name} is not a PDF`);
    return { doc: d, bytes: await hub.requireDocuments(ctx.actor.tenantId).download(d.storeFileId) };
  };

  return [
    defineCommand({
      name: "list_documents",
      title: "Matter documents",
      description: "Documents indexed for a matter (Box or local store), with type, date, category, and evidence / AI-exclusion flags.",
      tier: 0,
      input: z.object({ matterId: z.string(), category: z.string().optional() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, category }, ctx) =>
        docs.list(ctx.actor.tenantId, (d) => d.matterId === matterId && (!category || d.category === category)).sort((a, b) => (b.docDate ?? "").localeCompare(a.docDate ?? "")),
    }),

    defineCommand({
      name: "get_document",
      title: "Document details",
      description: "Metadata for one matter document.",
      tier: 0,
      input: z.object({ matterId: z.string(), documentId: z.string() }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, documentId }, ctx) => {
        const d = docs.find(ctx.actor.tenantId, documentId);
        if (!d || d.matterId !== matterId) throw notFound("Document");
        return d;
      },
    }),

    defineCommand({
      name: "upload_document",
      title: "Upload a document",
      description: "Upload a file into the matter folder and index it. Name it to the firm convention (see suggest_document_name).",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        name: z.string().min(1),
        base64: z.string().min(1),
        contentType: z.string().default("application/octet-stream"),
        subfolder: z.string().optional(),
        docDate: z.iso.date().optional(),
        category: z.string().optional(),
      }),
      matterIds: (i) => [i.matterId],
      handler: ({ matterId, name, base64, contentType, subfolder, docDate, category }, ctx) =>
        save(ctx, matterOf(ctx, matterId), name, new Uint8Array(Buffer.from(base64, "base64")), contentType, { source: "upload", docDate, category }, subfolder ?? ""),
    }),

    defineCommand({
      name: "sync_matter_documents",
      title: "Index existing matter files",
      description: "Index the files already in the matter's folder (and subfolders, three levels deep) so they can be searched, chronologised and listed.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ matterId: z.string() }),
      matterIds: (i) => [i.matterId],
      handler: async ({ matterId }, ctx) => {
        const m = matterOf(ctx, matterId);
        const ds = hub.requireDocuments(ctx.actor.tenantId);
        const known = new Set(docs.list(ctx.actor.tenantId, (d) => d.matterId === matterId).map((d) => d.storeFileId));
        let added = 0;
        const walk = async (folderId: string, path: string, depth: number) => {
          const { folders, files } = await ds.listFolder(folderId);
          for (const f of files) {
            if (known.has(f.id)) continue;
            const date = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(f.name);
            docs.set({
              id: randomUUID(), tenantId: ctx.actor.tenantId, matterId, store: ds.kind, storeFileId: f.id, folderId, name: f.name,
              contentType: f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : f.name.toLowerCase().endsWith(".docx") ? DOCX : "application/octet-stream",
              size: f.size, sha1: f.sha1, docDate: date ? `${date[1]}-${date[2]}-${date[3]}` : undefined, category: path || undefined, source: "import",
              createdAt: new Date().toISOString(), createdBy: ctx.actor.userId,
            });
            added++;
          }
          if (depth < 3) for (const sub of folders) await walk(sub.id, path ? `${path}/${sub.name}` : sub.name, depth + 1);
        };
        await walk(await matterFolder(ds, m), "", 0);
        return { added };
      },
    }),

    defineCommand({
      name: "suggest_document_name",
      title: "Suggest a document name",
      description:
        "Name a document to the firm convention. spec.kind is email | invoice | report | ime | referral | letter | payslip | other, with date (YYYY-MM-DD or 'Various'), and author, profession, practice, recipient, amountCents, externalParty, direction, re, sierNumber as relevant.",
      tier: 0,
      input: z.object({ spec: nameSpec }),
      handler: ({ spec }, ctx) => ({ name: formatDocumentName(spec as unknown as DocumentNameSpec, { feeEarnerNames: usersOf(store).list(ctx.actor.tenantId).map((u) => u.displayName) }) }),
    }),

    defineCommand({
      name: "check_document_name",
      title: "Check a document name",
      description: "Check a file name against the firm naming convention and list any problems.",
      tier: 0,
      input: z.object({ name: z.string().min(1) }),
      handler: ({ name }, ctx) => ({ issues: checkDocumentName(name, { feeEarnerNames: usersOf(store).list(ctx.actor.tenantId).map((u) => u.displayName) }) }),
    }),

    defineCommand({
      name: "upload_template",
      title: "Upload a firm template",
      description: "Upload the firm's Authority to Settle form, letterhead, or a tagged ({{ }}) Word template. Stored as firm data, never shared.",
      tier: 1,
      roles: ["principal"],
      input: z.object({ kind: z.enum(["authority_form", "letterhead", "tagged"]), name: z.string().min(1), base64: z.string().min(1) }),
      handler: (t, ctx) => {
        const r = templates.set({ ...t, id: randomUUID(), tenantId: ctx.actor.tenantId, uploadedAt: new Date().toISOString(), uploadedBy: ctx.actor.userId });
        return { id: r.id, kind: r.kind, name: r.name };
      },
    }),

    defineCommand({
      name: "list_templates",
      title: "Firm templates",
      description: "The firm's uploaded templates.",
      tier: 0,
      input: z.object({}),
      handler: (_i, ctx) => templates.list(ctx.actor.tenantId).map(({ id, kind, name, uploadedAt }) => ({ id, kind, name, uploadedAt })),
    }),

    defineCommand({
      name: "generate_authority_document",
      title: "Prepare the Authority to Settle",
      description: "Fill the firm's Authority to Settle form from the latest (or given) authority draft and save it to the matter as a draft. Bank details and signatures stay blank for the client.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ matterId: z.string(), draftId: z.string().optional() }),
      matterIds: (i) => [i.matterId],
      handler: async ({ matterId, draftId }, ctx) => {
        const m = matterOf(ctx, matterId);
        const drafts = store.collection<StoredAuthority>("authority_draft").list(ctx.actor.tenantId, (d) => d.matterId === matterId && (!draftId || d.id === draftId));
        const draft = drafts.sort((a, b) => b.version - a.version)[0];
        if (!draft) throw conflict("Compute the authority figures first (compute_authority_to_settle)");
        const responsible = usersOf(store).get(m.responsibleUserId);
        const bytes = fillFirmAuthorityForm(template(ctx.actor.tenantId, "authority_form"), {
          clientName: draft.input.clientName ?? clientOf(m)?.name ?? "",
          injuryDate: draft.input.injuryDate ?? "",
          solicitor: draft.input.solicitor ?? responsible?.displayName ?? "",
          otherTerms: draft.result.otherTerms,
          cells: draft.result.cells,
          disbursementsNote: draft.result.disbursementsBlank,
        });
        const doc = await save(ctx, m, `${dotted(todayIso())} Authority to Settle – ${clientOf(m)?.name ?? m.title}.docx`, bytes, DOCX, { docType: "Authority to Settle" });
        return { document: doc, totals: { totalOffer: fmt(draft.result.totalOfferCents), netInHand: fmt(draft.result.netInHandCents), netTotal: fmt(draft.result.netTotalCents) } };
      },
    }),

    defineCommand({
      name: "generate_letter",
      title: "Draft a letter on letterhead",
      description: "Draft a letter on the firm's letterhead and save it to the matter as a draft Word document.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        addressee: z.array(z.string()).min(1).describe("Name, then postal address lines"),
        salutation: z.string().min(1),
        body: z.array(z.string()).min(1).describe("One string per paragraph"),
        byEmail: z.string().optional(),
        referenceLine: z.string().optional(),
        enclosure: z.boolean().default(false),
        date: z.iso.date().optional(),
      }),
      matterIds: (i) => [i.matterId],
      handler: async ({ matterId, date, ...letter }, ctx) => {
        const m = matterOf(ctx, matterId);
        const s = settingsFor(store, m.tenantId);
        const me = usersOf(store).get(ctx.actor.userId);
        const bytes = buildLetterOnLetterhead(
          template(ctx.actor.tenantId, "letterhead"),
          { ...letter, date: longDate(date ?? todayIso()), contactRef: m.number, referenceLine: letter.referenceLine ?? `[${m.number}] ${m.title}` },
          {
            sender: { name: s.letter.senderName || me?.displayName || ctx.actor.displayName, title: s.letter.senderTitle, email: s.letter.senderEmail || me?.email || "", phone: s.letter.senderPhone },
            signOff: { text: s.letter.signoff || s.firmName, font: s.letter.signoffFont, sizePt: s.letter.signoffSizePt, color: s.letter.signoffColor },
            closing: s.letter.closing,
            accentColor: s.letter.accentColor,
          },
        );
        const to = letter.addressee[0]!;
        return save(ctx, m, `${dotted(date ?? todayIso())} LTR to ${to}.docx`.replace(/[\\/:*?"<>|]/g, "-"), bytes, DOCX, { docType: "Letter" });
      },
    }),

    defineCommand({
      name: "generate_from_template",
      title: "Fill a tagged template",
      description: "Fill one of the firm's tagged ({{field}}) Word templates with matter data plus any extra fields, and save it to the matter as a draft.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ matterId: z.string(), templateId: z.string(), fileName: z.string().min(1), fields: z.record(z.string(), z.unknown()).default({}) }),
      matterIds: (i) => [i.matterId],
      handler: async ({ matterId, templateId, fileName, fields }, ctx) => {
        const m = matterOf(ctx, matterId);
        const client = clientOf(m);
        const data = { matter: { number: m.number, title: m.title, injuryDate: m.injuryDate, references: (m.references ?? []).join(", ") }, client, today: longDate(todayIso()), firm: settingsFor(store, m.tenantId).firmName, ...fields };
        const bytes = fillTagged(template(ctx.actor.tenantId, "tagged", templateId), data);
        return save(ctx, m, fileName.endsWith(".docx") ? fileName : `${fileName}.docx`, bytes, DOCX);
      },
    }),

    defineCommand({
      name: "generate_list_of_documents",
      title: "Prepare List of Documents (Form 17)",
      description: "Build the WA Form 17 List of Documents from the matter's indexed documents (categorised and dated for review) and save it as a draft.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        actionNumber: z.string().min(1).describe("e.g. CIV 501 of 2026, copied from the writ"),
        court: z.array(z.string()).default(["District Court of Western Australia", "Held at Perth"]),
        parties: z.array(z.object({ name: z.string(), role: z.string() })).optional().describe("Exact names from the writ; defaults to the matter's parties"),
      }),
      matterIds: (i) => [i.matterId],
      handler: async ({ matterId, actionNumber, court, parties }, ctx) => {
        const m = matterOf(ctx, matterId);
        const files = docs.list(ctx.actor.tenantId, (d) => d.matterId === matterId && d.source !== "generated").map((d) => ({ name: d.name, folder: d.category, date: d.docDate }));
        const { categories, excluded } = categoriseForForm17(files, { courtName: court[0], actionNumber });
        const defaultParties = partiesOf(m)
          .filter((p) => p.role === "client" || p.role === "defendant" || p.role === "insurer")
          .map((p, i) => ({ name: p.party.name, role: p.role === "client" ? "Plaintiff" : i === 1 ? "Defendant" : "Defendant" }));
        const bytes = await buildListOfDocuments({
          court: { nameLines: court, actionNumber },
          parties: parties ?? defaultParties,
          to: "The Defendant and its practitioners.",
          from: "The Plaintiff",
          firmName: settingsFor(store, m.tenantId).firmName,
          inspectionAddress: settingsFor(store, m.tenantId).firmAddress,
          categories,
        });
        const doc = await save(ctx, m, `${dotted(todayIso())} Plaintiff's List of Documents – ${actionNumber}.docx`, bytes, DOCX, { docType: "List of Documents" });
        return { document: doc, items: categories.reduce((n, c) => n + c.items.length, 0), excluded: excluded.length, note: "Check names and ABNs against the writ, the categories, and Parts 2A/2B before serving." };
      },
    }),

    defineCommand({
      name: "generate_particulars",
      title: "Prepare particulars of damages",
      description: "Render the latest (or given) damages model as Particulars / Schedule of Damages (r 45C(3), Stott format) and save it as a draft.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        version: z.number().int().optional(),
        actionNumber: z.string().optional(),
        mediation: z.boolean().default(false),
        parties: z.array(z.object({ name: z.string(), role: z.string() })).optional(),
      }),
      matterIds: (i) => [i.matterId],
      handler: async ({ matterId, version, actionNumber, mediation, parties }, ctx) => {
        const m = matterOf(ctx, matterId);
        const all = store.collection<StoredDamages>("damages_model").list(ctx.actor.tenantId, (d) => d.matterId === matterId && (!version || d.version === version));
        const stored = all.sort((a, b) => b.version - a.version)[0];
        if (!stored) throw conflict("Compute the damages model first (compute_damages)");
        const doc = particularsFromModel(stored.model, {
          actionNumber: actionNumber ?? m.references?.find((r) => /civ|dc/i.test(r)) ?? "",
          parties: parties ?? partiesOf(m).filter((p) => p.role === "client" || p.role === "defendant").map((p) => ({ name: p.party.name, role: p.role === "client" ? "Plaintiff" : "Defendant" })),
          mediation,
          firmName: settingsFor(store, m.tenantId).firmName,
        });
        const title = mediation ? "Plaintiff Schedule of Damages" : "Particulars of Damages";
        const saved = await save(ctx, m, `${dotted(todayIso())} ${title}.docx`, await renderParticulars(doc), DOCX, { docType: title });
        return { document: saved, version: stored.version, total: fmt(stored.model.summary.totalCents), flags: stored.model.flags, audit: stored.audit };
      },
    }),

    defineCommand({
      name: "build_court_book",
      title: "Compile a court book or affidavit with annexures",
      description:
        "Compile PDFs from the matter into one document. mode 'book': cover, table of contents and page numbers. mode 'house': the first document is the affidavit (with its index), the rest are annexures marked with the deponent's initials.",
      tier: 1,
      roles: [...STAFF],
      input: z.object({
        matterId: z.string(),
        mode: z.enum(["book", "house"]),
        title: z.string().min(1),
        documentIds: z.array(z.string()).min(1),
        descriptions: z.array(z.string()).optional().describe("Index wording per document (defaults to file names)"),
        markPrefix: z.string().optional().describe("Deponent initials for annexure marks, e.g. KW"),
        date: z.string().optional(),
      }),
      matterIds: (i) => [i.matterId],
      handler: async ({ matterId, mode, title, documentIds, descriptions, markPrefix, date }, ctx) => {
        const m = matterOf(ctx, matterId);
        const pdfs: { doc: MatterDocument; bytes: Uint8Array }[] = [];
        for (const id of documentIds) pdfs.push(await loadPdf(ctx, matterId, id));
        const label = (i: number) => descriptions?.[i] ?? pdfs[i]!.doc.name.replace(/\.pdf$/i, "");
        const result =
          mode === "book"
            ? await buildMasterBook({ mode: "book", title, date, includeCover: true, documents: pdfs.map((p, i) => ({ bytes: p.bytes, displayName: label(i) })) })
            : await buildMasterBook({
                mode: "house",
                affidavit: pdfs[0]!.bytes,
                affidavitTitle: label(0),
                markPrefix,
                annexures: pdfs.slice(1).map((p, i) => ({ description: label(i + 1), sources: [{ bytes: p.bytes }] })),
              });
        const doc = await save(ctx, m, `${dotted(todayIso())} ${title}.pdf`.replace(/[\\/:*?"<>|]/g, "-"), result.bytes, "application/pdf", { docType: mode === "book" ? "Court book" : "Affidavit with annexures" });
        return { document: doc, pages: result.pageCount, entries: result.entries };
      },
    }),

    defineCommand({
      name: "remove_tracked_changes",
      title: "Convert tracked changes to markup",
      description: "Make a copy of a Word document with tracked changes turned into static underline/strikethrough, with no revision data (for eCourts filing).",
      tier: 1,
      roles: [...STAFF],
      input: z.object({ matterId: z.string(), documentId: z.string() }),
      matterIds: (i) => [i.matterId],
      handler: async ({ matterId, documentId }, ctx) => {
        const m = matterOf(ctx, matterId);
        const d = docs.find(ctx.actor.tenantId, documentId);
        if (!d || d.matterId !== matterId) throw notFound("Document");
        if (!d.name.toLowerCase().endsWith(".docx")) throw invalid("Only .docx files have tracked changes");
        const { bytes, report } = tracksToMarkup(await hub.requireDocuments(ctx.actor.tenantId).download(d.storeFileId));
        const doc = await save(ctx, m, d.name.replace(/\.docx$/i, " (markup for filing).docx"), bytes, DOCX, { docType: d.docType, docDate: d.docDate });
        return { document: doc, report };
      },
    }),
  ];
}

/** Maps the damages engine's model onto the particulars renderer (Stott CPC-A1 layout). */
export function particularsFromModel(model: DamagesModel, opts: { actionNumber: string; parties: { name: string; role: string }[]; mediation: boolean; firmName: string }): ParticularsDocument {
  const blocksFor = (head: DamagesModel["heads"][number]): ParticularsBlock[] => {
    const blocks: ParticularsBlock[] = head.lines.map((line) => {
      const lettered = /^\(([a-z])\)\s*(.*)$/.exec(line);
      if (lettered) return { kind: "paragraph", label: `(${lettered[1]})`, text: lettered[2]! };
      return /=/.test(line) ? { kind: "calc", text: line } : { kind: "paragraph", text: line };
    });
    for (const t of head.tables) blocks.push({ kind: "table", columns: t.columns.map((c, i) => ({ header: c, align: i === t.columns.length - 1 ? "right" : "left" })), rows: t.rows, total: t.totalRow });
    return blocks;
  };
  const top = (id: string) => id.split(".")[0]!;
  const groups = new Map<string, DamagesModel["heads"]>();
  for (const h of model.heads) groups.set(top(h.id), [...(groups.get(top(h.id)) ?? []), h]);
  const GROUP_TITLES: Record<string, string> = { "1": "Loss of earning capacity", "2": "Loss of superannuation", "6": "Future needs" };
  const heads: ParticularsDocument["heads"] = [...groups].map(([n, hs]) =>
    hs.length === 1 && hs[0]!.id === n
      ? { number: n, title: hs[0]!.title, blocks: blocksFor(hs[0]!), amount: { label: hs[0]!.placeholder ? "To be advised" : "Total", amount: fmt(hs[0]!.amountCents) } }
      : {
          number: n,
          title: GROUP_TITLES[n] ?? hs[0]!.title,
          blocks: hs.map((h) => ({ kind: "section" as const, number: h.id, title: h.title, blocks: blocksFor(h), amount: { label: "Total", amount: fmt(h.amountCents) } })),
          amount: { label: "Total", amount: fmt(hs.reduce((s, h) => s + h.amountCents, 0)) },
        },
  );
  return {
    heading: { court: "District Court of Western Australia", actionNumber: opts.actionNumber, parties: opts.parties },
    title: [opts.mediation ? "PLAINTIFF'S SCHEDULE OF DAMAGES" : "PARTICULARS OF DAMAGES"],
    ...(opts.mediation ? { confidentialHeader: "CONFIDENTIAL FOR THE PURPOSES OF MEDIATION ONLY" } : {}),
    intro: `The plaintiff provides the following particulars pursuant to rule 45C(3) of the District Court Rules 2005, calculated to ${longDate(model.calculationDate)}. These particulars supersede any particulars previously provided.`,
    heads,
    summary: {
      heading: "Summary",
      rows: model.summary.lines.map((l) => ({ label: `${l.id} ${l.title}`, amount: fmt(l.amountCents), level: l.id.includes(".") ? 1 : 0 })),
      total: { label: "Total", amount: fmt(model.summary.totalCents) },
      notes: [model.summary.statement],
    },
    signature: [opts.firmName, "Solicitors for the plaintiff"],
  };
}
