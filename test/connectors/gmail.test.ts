import { describe, expect, it } from "vitest";
import { GmailMailSource, type GmailMessage } from "../../src/connectors/mail/gmail.js";
import {
  buildMime,
  decodeEncodedWords,
  decodeQuotedPrintable,
  formatAddress,
  parseAddressList,
} from "../../src/connectors/mail/mime.js";
import { b64url, fakeFetch, json, token } from "./fake-fetch.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

function gmail() {
  const f = fakeFetch();
  return { f, mail: new GmailMailSource({ getAccessToken: token, fetch: f.fetch }) };
}

const LABELS = {
  labels: [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "Label_12", name: "Box Filed", type: "user" },
    { id: "Label_31", name: "Box Filed/Refile/1998", type: "user" },
  ],
};

/** Recorded shape of a `format=full` message: mixed → (alternative → plain, html) + PDF + inline image. */
const FULL: GmailMessage = {
  id: "18c2f0a1b2c3d4e5",
  threadId: "18c2f0a1b2c3d4e5",
  labelIds: ["INBOX", "Label_12", "IMPORTANT"],
  internalDate: "1793606400000",
  payload: {
    partId: "",
    mimeType: "multipart/mixed",
    filename: "",
    headers: [
      { name: "From", value: '"Insurance Commission of WA" <claims@icwa.wa.gov.au>' },
      { name: "To", value: '"Priestley, Toni" <toni@example.com>, Kevin <kevin@soullegal.com.au>' },
      { name: "Cc", value: "=?UTF-8?B?Sm9zw6kgw4FsdmFyZXo=?= <jose@example.com>" },
      { name: "Subject", value: "=?UTF-8?Q?Claim_1998_=E2=80=93_liability?= accepted" },
      { name: "Message-ID", value: "<CAB123@mail.gmail.com>" },
      { name: "Content-Type", value: 'multipart/mixed; boundary="000"' },
    ],
    body: { size: 0 },
    parts: [
      {
        partId: "0",
        mimeType: "multipart/alternative",
        filename: "",
        headers: [{ name: "Content-Type", value: 'multipart/alternative; boundary="001"' }],
        body: { size: 0 },
        parts: [
          {
            partId: "0.0",
            mimeType: "text/plain",
            filename: "",
            headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }, { name: "Content-Transfer-Encoding", value: "quoted-printable" }],
            body: { size: 29, data: b64url("Liability accepted – thanks.\n") },
          },
          {
            partId: "0.1",
            mimeType: "text/html",
            filename: "",
            headers: [{ name: "Content-Type", value: "text/html; charset=ISO-8859-1" }],
            body: { size: 30, data: b64url(Buffer.from("<p>Liability accepted - café</p>", "latin1")) },
          },
        ],
      },
      {
        partId: "1",
        mimeType: "application/pdf",
        filename: "Letter 29.10.2026.pdf",
        headers: [
          { name: "Content-Type", value: 'application/pdf; name="Letter 29.10.2026.pdf"' },
          { name: "Content-Disposition", value: 'attachment; filename="Letter 29.10.2026.pdf"' },
        ],
        body: { attachmentId: "ANGjdJ8abc", size: 48213 },
      },
      {
        partId: "2",
        mimeType: "image/png",
        filename: "",
        headers: [{ name: "Content-Type", value: 'image/png; name="logo.png"' }, { name: "Content-ID", value: "<logo>" }],
        body: { size: 4, data: b64url(new Uint8Array([137, 80, 78, 71])) },
      },
    ],
  },
};

describe("GmailMailSource", () => {
  it("lists with q, after: and a label id, paging until max", async () => {
    const { f, mail } = gmail();
    f.on("GET", `${API}/labels`, LABELS);
    f.once("GET", `${API}/messages?`, { messages: [{ id: "a", threadId: "t1" }, { id: "b", threadId: "t1" }], nextPageToken: "p2", resultSizeEstimate: 5 });
    f.once("GET", `${API}/messages?`, { messages: [{ id: "c", threadId: "t2" }, { id: "d", threadId: "t3" }], nextPageToken: "p3" });

    const ids = await mail.listMessages({ q: "from:icwa.wa.gov.au", since: "2026-10-01T00:00:00Z", label: "box filed/refile/1998", max: 3 });
    expect(ids).toEqual([{ id: "a", threadId: "t1" }, { id: "b", threadId: "t1" }, { id: "c", threadId: "t2" }]);
    const lists = f.calls.filter((c) => c.url.includes("/messages?")).map((c) => new URL(c.url).searchParams);
    expect(lists).toHaveLength(2);
    expect(lists[0]!.get("q")).toBe("from:icwa.wa.gov.au after:1790812800");
    expect(lists[0]!.get("labelIds")).toBe("Label_31");
    expect(lists[0]!.get("maxResults")).toBe("3");
    expect(lists[1]!.get("pageToken")).toBe("p2");
    expect(lists[1]!.get("maxResults")).toBe("1");
    expect(f.calls[0]!.headers.Authorization).toBe("Bearer test-token");
  });

  it("returns nothing for an unknown label without creating it", async () => {
    const { f, mail } = gmail();
    f.on("GET", `${API}/labels`, LABELS);
    expect(await mail.listMessages({ label: "Nope" })).toEqual([]);
    expect(f.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("decodes multipart/alternative inside multipart/mixed, charsets, encoded words and attachments", async () => {
    const { f, mail } = gmail();
    f.on("GET", `${API}/messages/18c2f0a1b2c3d4e5?format=full`, FULL);
    const m = await mail.getMessage("18c2f0a1b2c3d4e5");
    expect(m.subject).toBe("Claim 1998 – liability accepted");
    expect(m.from).toEqual({ name: "Insurance Commission of WA", email: "claims@icwa.wa.gov.au" });
    expect(m.to).toEqual([{ name: "Priestley, Toni", email: "toni@example.com" }, { name: "Kevin", email: "kevin@soullegal.com.au" }]);
    expect(m.cc).toEqual([{ name: "José Álvarez", email: "jose@example.com" }]);
    expect(m.text).toBe("Liability accepted – thanks.\n");
    expect(m.html).toBe("<p>Liability accepted - café</p>");
    expect(m.date).toBe("2026-11-02T08:00:00.000Z");
    expect(m.internetMessageId).toBe("<CAB123@mail.gmail.com>");
    expect(m.labels).toEqual(["INBOX", "Label_12", "IMPORTANT"]);
    expect(m.attachments).toEqual([
      { filename: "Letter 29.10.2026.pdf", contentType: "application/pdf", size: 48213, providerAttachmentId: "ANGjdJ8abc" },
      { filename: "logo.png", contentType: "image/png", size: 4, bytes: new Uint8Array([137, 80, 78, 71]) },
    ]);

    f.on("GET", `${API}/messages/18c2f0a1b2c3d4e5/attachments/ANGjdJ8abc`, { size: 5, data: b64url("%PDF-") });
    expect(new TextDecoder().decode(await mail.getAttachment(m.id, m.attachments[0]!))).toBe("%PDF-");
    expect(await mail.getAttachment(m.id, m.attachments[1]!)).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("falls back to text from HTML for HTML-only mail", async () => {
    const { f, mail } = gmail();
    f.on("GET", `${API}/messages/h1`, {
      id: "h1",
      threadId: "h1",
      payload: {
        mimeType: "text/html",
        headers: [{ name: "From", value: "a@b.com" }, { name: "Date", value: "Thu, 29 Oct 2026 10:00:00 +0800" }],
        body: { size: 20, data: b64url("<div>Hi&nbsp;Toni<br>Regards</div>") },
      },
    });
    const m = await mail.getMessage("h1");
    expect(m.text).toBe("Hi Toni\nRegards");
    expect(m.date).toBe("2026-10-29T02:00:00.000Z");
  });

  it("gets raw .eml bytes", async () => {
    const { f, mail } = gmail();
    const eml = "From: a@b.com\r\nSubject: x\r\n\r\nbody";
    f.on("GET", `${API}/messages/r1?format=raw`, { id: "r1", threadId: "r1", raw: b64url(eml) });
    expect(new TextDecoder().decode(await mail.getRaw("r1"))).toBe(eml);
  });

  it("creates a missing nested label once, then labels the message; removing an unknown label is a no-op", async () => {
    const { f, mail } = gmail();
    f.on("GET", `${API}/labels`, LABELS);
    f.on("POST", `${API}/labels`, (c) => json({ id: "Label_99", name: c.json.name, type: "user" }));
    f.on("POST", /\/messages\/[^/]+\/modify$/, { id: "m1", labelIds: ["Label_99"] });

    await mail.addLabel("m1", "Box Filed/Refile/2001");
    await mail.addLabel("m2", "Box Filed/Refile/2001");
    await mail.removeLabel("m1", "Box Filed/Refile/1998");
    await mail.removeLabel("m1", "Never Existed");

    const creates = f.calls.filter((c) => c.method === "POST" && c.url.endsWith("/labels"));
    expect(creates).toHaveLength(1);
    expect(creates[0]!.json).toEqual({ name: "Box Filed/Refile/2001", labelListVisibility: "labelShow", messageListVisibility: "show" });
    const modifies = f.calls.filter((c) => c.url.endsWith("/modify"));
    expect(modifies.map((c) => [c.url.split("/messages/")[1], c.json])).toEqual([
      ["m1/modify", { addLabelIds: ["Label_99"] }],
      ["m2/modify", { addLabelIds: ["Label_99"] }],
      ["m1/modify", { removeLabelIds: ["Label_31"] }],
    ]);
  });

  it("recovers when another client created the label first (409)", async () => {
    const { f, mail } = gmail();
    f.once("GET", `${API}/labels`, LABELS);
    f.once("POST", `${API}/labels`, json({ error: { code: 409, message: "Label name exists or conflicts", status: "ALREADY_EXISTS" } }, 409));
    f.once("GET", `${API}/labels`, { labels: [...LABELS.labels, { id: "Label_50", name: "Box Filed/Refile/3000" }] });
    f.on("POST", /modify$/, {});
    await mail.addLabel("m1", "Box Filed/Refile/3000");
    expect(f.calls.at(-1)!.json).toEqual({ addLabelIds: ["Label_50"] });
  });

  it("sends a reply as base64url MIME with threadId, In-Reply-To and References", async () => {
    const { f, mail } = gmail();
    f.on("GET", `${API}/threads/t1`, {
      id: "t1",
      messages: [
        { id: "m0", threadId: "t1", payload: { mimeType: "text/plain", headers: [{ name: "Message-Id", value: "<first@x>" }] } },
        { id: "m1", threadId: "t1", payload: { mimeType: "text/plain", headers: [{ name: "Message-ID", value: "<second@x>" }, { name: "References", value: "<first@x>" }] } },
      ],
    });
    f.on("POST", `${API}/messages/send`, { id: "sent1", threadId: "t1", labelIds: ["SENT"] });

    const res = await mail.send({
      to: [{ name: "Insurance Commission of WA", email: "claims@icwa.wa.gov.au" }],
      cc: [{ email: "kevin@soullegal.com.au" }],
      subject: "Re: Claim 1998 – liability accepted",
      text: "Thank you.",
      html: "<p>Thank you.</p>",
      attachments: [{ filename: "Authority.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7") }],
      threadId: "t1",
    });
    expect(res).toEqual({ id: "sent1", threadId: "t1" });
    expect(new URL(f.calls[0]!.url).searchParams.getAll("metadataHeaders")).toEqual(["Message-ID", "References"]);
    const send = f.calls.at(-1)!;
    expect(send.json.threadId).toBe("t1");
    const raw = Buffer.from(send.json.raw, "base64url").toString();
    expect(raw).toContain("To: Insurance Commission of WA <claims@icwa.wa.gov.au>\r\n");
    expect(raw).toContain("Cc: kevin@soullegal.com.au\r\n");
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain("In-Reply-To: <second@x>\r\n");
    expect(raw).toContain("References: <first@x> <second@x>\r\n");
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="([^"]+)"[\s\S]*Content-Type: multipart\/alternative/);
    expect(raw).toContain('Content-Disposition: attachment; filename="Authority.pdf"');
    expect(raw).toContain(Buffer.from("%PDF-1.7").toString("base64"));
    expect(raw).toContain(Buffer.from("<p>Thank you.</p>").toString("base64"));
  });
});

describe("MIME helpers", () => {
  it("decodes quoted-printable with soft breaks and charset", () => {
    expect(decodeQuotedPrintable("Caf=E9 au lait=\r\n, merci", "iso-8859-1")).toBe("Café au lait, merci");
    expect(decodeQuotedPrintable("Liability =E2=80=93 accepted")).toBe("Liability – accepted");
  });

  it("decodes adjacent encoded words without the gap", () => {
    expect(decodeEncodedWords("=?UTF-8?B?Sm9zw6k=?= =?UTF-8?B?IMOBbHZhcmV6?= <x>")).toBe("José Álvarez <x>");
  });

  it("parses address lists with quoted commas and bare addresses", () => {
    expect(parseAddressList('"Priestley, Toni" <toni@example.com>, bob@example.com; Undisclosed recipients:;')).toEqual([
      { name: "Priestley, Toni", email: "toni@example.com" },
      { email: "bob@example.com" },
    ]);
  });

  it("formats addresses, quoting specials and encoding non-ASCII", () => {
    expect(formatAddress({ name: "Priestley, Toni", email: "t@x.com" })).toBe('"Priestley, Toni" <t@x.com>');
    expect(formatAddress({ name: "José", email: "j@x.com" })).toBe("=?UTF-8?B?Sm9zw6k=?= <j@x.com>");
  });

  it("builds a plain message without multipart when there is only text", () => {
    const raw = buildMime({ to: [{ email: "a@b.com" }], subject: "Hi", text: "Hello" }, { boundary: "b" });
    expect(raw).toBe(
      'To: a@b.com\r\nSubject: Hi\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\nSGVsbG8=\r\n',
    );
  });
});
