import { describe, expect, it } from "vitest";
import { BoxDocumentStore, boxClientCredentialsToken } from "../../src/connectors/documents/box.js";
import { cachedToken } from "../../src/connectors/http.js";
import { NameConflictError } from "../../src/connectors/types.js";
import { fakeFetch, json, token } from "./fake-fetch.js";

const API = "https://api.box.com/2.0";
const UPLOAD = "https://upload.box.com/api/2.0/files/content";
const ROOT = "11111";

function store() {
  const f = fakeFetch();
  const box = new BoxDocumentStore({ getAccessToken: token, fetch: f.fetch, mattersRootFolderId: ROOT });
  return { f, box };
}

const folder = (id: string, name: string, parent = ROOT) => ({ type: "folder", id, name, parent: { type: "folder", id: parent } });
const file = (id: string, name: string, parent: string, extra: object = {}) => ({
  type: "file",
  id,
  name,
  size: 2048,
  modified_at: "2026-10-29T09:15:00-07:00",
  sha1: "85136c79cbf9fe36bb9d05d0639c70c265c18d37",
  parent: { type: "folder", id: parent },
  ...extra,
});

describe("BoxDocumentStore", () => {
  it("finds a matter folder by search, keeping only exact number prefixes directly under the root", async () => {
    const { f, box } = store();
    f.on("GET", `${API}/search`, {
      total_count: 4,
      entries: [
        folder("201", "19980 - Someone, Else - WC"),
        folder("202", "1998 - Priestley, Toni - MVA"),
        folder("203", "1998 - Correspondence", "202"),
        folder("204", "Re 1998 - notes"),
      ],
    });
    const found = await box.findMatterFolder("1998");
    expect(found).toEqual({ id: "202", name: "1998 - Priestley, Toni - MVA", url: "https://app.box.com/folder/202" });
    const url = new URL(f.calls[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      query: "1998",
      type: "folder",
      ancestor_folder_ids: ROOT,
      content_types: "name",
      limit: "200",
      offset: "0",
    });
    expect(f.calls[0]!.headers.Authorization).toBe("Bearer test-token");
  });

  it("returns null for zero or several prefix matches, paging through search results", async () => {
    const { f, box } = store();
    f.once("GET", `${API}/search`, { total_count: 3, entries: [folder("1", "2001 - A, B - MVA"), folder("2", "2001 - A, B - WC")] });
    f.once("GET", `${API}/search`, { total_count: 3, entries: [folder("3", "unrelated 2001")] });
    expect(await box.findMatterFolder("2001")).toBeNull();
    expect(new URL(f.calls[1]!.url).searchParams.get("offset")).toBe("2");

    f.once("GET", `${API}/search`, { total_count: 0, entries: [] });
    expect(await box.findMatterFolder("3000")).toBeNull();
  });

  it("ensureMatterFolder confirms a search miss against the root listing (marker paging) before creating", async () => {
    const { f, box } = store();
    f.on("GET", `${API}/search`, { total_count: 0, entries: [] });
    f.once("GET", `${API}/folders/${ROOT}/items`, { entries: [folder("5", "1000 - X, Y - MVA")], next_marker: "m2" });
    f.once("GET", `${API}/folders/${ROOT}/items`, { entries: [file("9", "readme.txt", ROOT)], next_marker: null });
    f.on("POST", `${API}/folders`, (c) => json({ ...folder("777", c.json.name), size: 0 }, 201));

    const created = await box.ensureMatterFolder({ number: "1998", clientSortName: "Priestley, Toni", schemeLabel: "MVA" });
    expect(created.id).toBe("777");
    const listing = f.calls.filter((c) => c.url.includes("/items"));
    expect(new URL(listing[0]!.url).searchParams.get("usemarker")).toBe("true");
    expect(new URL(listing[1]!.url).searchParams.get("marker")).toBe("m2");
    const post = f.calls.find((c) => c.method === "POST")!;
    expect(post.json).toEqual({ name: "1998 - Priestley, Toni - MVA", parent: { id: ROOT } });
    expect(post.headers["Content-Type"]).toBe("application/json");
  });

  it("ensureMatterFolder finds the folder in the listing when search has not indexed it yet", async () => {
    const { f, box } = store();
    f.on("GET", `${API}/search`, { total_count: 0, entries: [] });
    f.on("GET", `${API}/folders/${ROOT}/items`, { entries: [folder("5", "1998 - Priestley, Toni - MVA")], next_marker: "" });
    const got = await box.ensureMatterFolder({ number: "1998", clientSortName: "Priestley, Toni", schemeLabel: "MVA" });
    expect(got.id).toBe("5");
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("ensureSubfolder returns the existing folder from a 409 conflict", async () => {
    const { f, box } = store();
    f.on("POST", `${API}/folders`, json({
      type: "error",
      status: 409,
      code: "item_name_in_use",
      message: "Item with the same name already exists",
      context_info: { conflicts: [{ type: "folder", id: "303", sequence_id: "0", etag: "0", name: "Emails" }] },
    }, 409));
    expect(await box.ensureSubfolder("202", "Emails")).toEqual({ id: "303", name: "Emails", url: "https://app.box.com/folder/303" });
  });

  it("uploads multipart with attributes before the file", async () => {
    const { f, box } = store();
    f.on("POST", UPLOAD, { total_count: 1, entries: [file("9001", "2026.10.29 EM from ICWA.pdf", "303", { size: 5 })] });
    const ref = await box.upload("303", "2026.10.29 EM from ICWA.pdf", new TextEncoder().encode("%PDF-"), "application/pdf");
    expect(ref).toMatchObject({ id: "9001", folderId: "303", size: 5, sha1: expect.any(String) });
    const call = f.calls[0]!;
    expect(call.url.startsWith(UPLOAD)).toBe(true);
    const form = call.body as FormData;
    expect([...form.keys()]).toEqual(["attributes", "file"]);
    expect(JSON.parse(form.get("attributes") as string)).toEqual({ name: "2026.10.29 EM from ICWA.pdf", parent: { id: "303" } });
    const blob = form.get("file") as File;
    expect(blob.type).toBe("application/pdf");
    expect(await blob.text()).toBe("%PDF-");
  });

  it("throws NameConflictError with the existing file when the upload name is taken", async () => {
    const { f, box } = store();
    f.on("POST", UPLOAD, json({
      type: "error",
      status: 409,
      code: "item_name_in_use",
      context_info: { conflicts: { type: "file", id: "8888", name: "a.pdf", sha1: "abc", file_version: { type: "file_version", id: "1" } } },
    }, 409));
    f.on("GET", `${API}/files/8888`, file("8888", "a.pdf", "303"));
    const err = await box.upload("303", "a.pdf", new Uint8Array([1])).catch((e) => e);
    expect(err).toBeInstanceOf(NameConflictError);
    expect(err.existing).toMatchObject({ id: "8888", name: "a.pdf", folderId: "303", size: 2048 });
  });

  it("renames and moves with PUT, mapping 409 to NameConflictError", async () => {
    const { f, box } = store();
    f.once("PUT", `${API}/files/9001`, file("9001", "new.pdf", "303"));
    f.once("PUT", `${API}/files/9001`, json({
      type: "error",
      status: 409,
      code: "item_name_in_use",
      context_info: { conflicts: [{ type: "file", id: "4444", name: "new.pdf" }] },
    }, 409));
    f.on("GET", `${API}/files/4444`, file("4444", "new.pdf", "404"));

    expect((await box.rename("9001", "new.pdf")).name).toBe("new.pdf");
    expect(f.calls[0]!.json).toEqual({ name: "new.pdf" });

    const err = await box.move("9001", "404").catch((e) => e);
    expect(err).toBeInstanceOf(NameConflictError);
    expect(err.existing.id).toBe("4444");
    expect(f.calls[1]!.json).toEqual({ parent: { id: "404" } });
  });

  it("rejects names Box cannot hold before calling the API", async () => {
    const { f, box } = store();
    await expect(box.rename("1", "a/b.pdf")).rejects.toThrow(/Invalid/);
    expect(f.calls).toHaveLength(0);
  });

  it("downloads by following the redirect without the bearer token", async () => {
    const { f, box } = store();
    const signed = "https://dl.boxcloud.com/d/1/abc/download";
    f.on("GET", `${API}/files/9001/content`, new Response(null, { status: 302, headers: { Location: signed } }));
    f.on("GET", signed, new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }));
    expect(await box.download("9001")).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(f.calls[1]!.headers.Authorization).toBeUndefined();
  });

  it("creates global properties metadata, or patches on 409", async () => {
    const { f, box } = store();
    const path = `${API}/files/9001/metadata/global/properties`;
    f.once("POST", path, json({ matter: "1998", $type: "properties" }, 201));
    await box.setMetadata("9001", { matter: "1998" });
    expect(f.calls[0]!.json).toEqual({ matter: "1998" });

    f.once("POST", path, json({ type: "error", status: 409, code: "tuple_already_exists" }, 409));
    f.once("GET", path, { matter: "1990", source: "gmail", $type: "properties", $parent: "file_9001" });
    f.once("PUT", path, { matter: "1998", source: "gmail", docType: "letter" });
    await box.setMetadata("9001", { matter: "1998", source: "gmail", docType: "letter" });
    const put = f.calls.at(-1)!;
    expect(put.headers["Content-Type"]).toBe("application/json-patch+json");
    expect(put.json).toEqual([
      { op: "replace", path: "/matter", value: "1998" },
      { op: "add", path: "/docType", value: "letter" },
    ]);
  });

  it("gets a CCG token and caches it until near expiry", async () => {
    const f = fakeFetch();
    f.on("POST", "https://api.box.com/oauth2/token", { access_token: "box-at", expires_in: 3600, token_type: "bearer" });
    const getToken = cachedToken(() =>
      boxClientCredentialsToken({ clientId: "cid", clientSecret: "secret", enterpriseId: "12345", fetch: f.fetch }),
    );
    expect(await getToken()).toBe("box-at");
    expect(await getToken()).toBe("box-at");
    expect(f.calls).toHaveLength(1);
    const body = new URLSearchParams(f.calls[0]!.text);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "client_credentials",
      client_id: "cid",
      client_secret: "secret",
      box_subject_type: "enterprise",
      box_subject_id: "12345",
    });
    expect(f.calls[0]!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const api = fakeFetch().on("GET", `${API}/folders`, { entries: [] });
    await new BoxDocumentStore({ getAccessToken: getToken, fetch: api.fetch, mattersRootFolderId: ROOT }).listFolder("1");
    expect(api.calls[0]!.headers.Authorization).toBe("Bearer box-at");
  });

  it("refuses an ambiguous subject for CCG", async () => {
    await expect(boxClientCredentialsToken({ clientId: "a", clientSecret: "b" })).rejects.toThrow(/exactly one/);
  });
});
