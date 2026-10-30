import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDocumentStore } from "../../src/connectors/documents/local.js";
import { NameConflictError } from "../../src/connectors/types.js";

let root: string;
let store: LocalDocumentStore;
const bytes = (s: string) => new TextEncoder().encode(s);
const spec = { number: "1998", clientSortName: "Priestley, Toni", schemeLabel: "MVA" };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "practy-local-"));
  store = new LocalDocumentStore({ root, mattersFolder: "Matters" });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("LocalDocumentStore", () => {
  it("creates and finds matter folders by number prefix", async () => {
    expect(await store.findMatterFolder("1998")).toBeNull();
    const created = await store.ensureMatterFolder(spec);
    expect(created).toMatchObject({ id: "Matters/1998 - Priestley, Toni - MVA", name: "1998 - Priestley, Toni - MVA" });
    expect(await store.ensureMatterFolder(spec)).toEqual(created);
    await mkdir(path.join(root, "Matters", "19980 - Other, Person - WC"));
    expect(await store.findMatterFolder("1998")).toEqual(created);

    await mkdir(path.join(root, "Matters", "1998 - Priestley, Toni - WC"));
    expect(await store.findMatterFolder("1998")).toBeNull();
    await expect(store.ensureMatterFolder(spec)).rejects.toThrow(/Several folders/);
  });

  it("uploads, lists, downloads, renames and moves with root-relative ids", async () => {
    const matter = await store.ensureMatterFolder(spec);
    const emails = await store.ensureSubfolder(matter.id, "Emails");
    expect(await store.ensureSubfolder(matter.id, "Emails")).toEqual(emails);

    const up = await store.upload(emails.id, "2026.10.29 EM from ICWA.pdf", bytes("%PDF-1.7"));
    expect(up).toMatchObject({
      id: "Matters/1998 - Priestley, Toni - MVA/Emails/2026.10.29 EM from ICWA.pdf",
      folderId: emails.id,
      size: 8,
      sha1: createHash("sha1").update("%PDF-1.7").digest("hex"),
    });
    expect(new TextDecoder().decode(await store.download(up.id))).toBe("%PDF-1.7");

    const listing = await store.listFolder(matter.id);
    expect(listing.folders.map((f) => f.name)).toEqual(["Emails"]);
    expect(listing.files).toEqual([]);
    expect((await store.listFolder(emails.id)).files.map((f) => f.name)).toEqual(["2026.10.29 EM from ICWA.pdf"]);

    const renamed = await store.rename(up.id, "2026.10.29 EM from ICWA – liability.pdf");
    expect(renamed.folderId).toBe(emails.id);
    const medical = await store.ensureSubfolder(matter.id, "Medical Reports");
    const moved = await store.move(renamed.id, medical.id);
    expect(moved.id).toBe(`${medical.id}/2026.10.29 EM from ICWA – liability.pdf`);
    expect((await store.listFolder(emails.id)).files).toEqual([]);
  });

  it("never overwrites on upload, rename or move, and leaves no temp files behind", async () => {
    const folder = await store.ensureSubfolder("", "Inbox");
    const a = await store.upload(folder.id, "a.pdf", bytes("original"));
    const b = await store.upload(folder.id, "b.pdf", bytes("other"));

    const err = await store.upload(folder.id, "a.pdf", bytes("replacement")).catch((e) => e);
    expect(err).toBeInstanceOf(NameConflictError);
    expect(err.existing).toMatchObject({ id: a.id, size: 8 });
    expect(await readFile(path.join(root, "Inbox", "a.pdf"), "utf8")).toBe("original");

    await expect(store.rename(b.id, "a.pdf")).rejects.toBeInstanceOf(NameConflictError);
    const other = await store.ensureSubfolder("", "Other");
    await writeFile(path.join(root, "Other", "a.pdf"), "elsewhere");
    await expect(store.move(a.id, other.id)).rejects.toBeInstanceOf(NameConflictError);

    expect((await readdir(path.join(root, "Inbox"))).sort()).toEqual(["a.pdf", "b.pdf"]);
    expect(await readFile(path.join(root, "Other", "a.pdf"), "utf8")).toBe("elsewhere");
  });

  it("refuses ids that escape the root and names with separators", async () => {
    await expect(store.download("../etc/passwd")).rejects.toThrow(/escapes/);
    await expect(store.download("/etc/passwd")).rejects.toThrow(/Invalid document id/);
    await expect(store.upload("", "a/b.pdf", bytes("x"))).rejects.toThrow(/Invalid document or folder name/);
  });

  it("treats setMetadata as a no-op", async () => {
    await expect(store.setMetadata("x", { a: "b" })).resolves.toBeUndefined();
  });
});
