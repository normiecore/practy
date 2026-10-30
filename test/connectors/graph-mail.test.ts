import { describe, expect, it } from "vitest";
import { GraphMailSource } from "../../src/connectors/mail/graph.js";
import { empty, fakeFetch, json, token } from "./fake-fetch.js";

const ME = "https://graph.microsoft.com/v1.0/me";

function graph() {
  const f = fakeFetch();
  return { f, mail: new GraphMailSource({ getAccessToken: token, fetch: f.fetch }) };
}

const MESSAGE = {
  "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('x')/messages/$entity",
  id: "AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0AAA=",
  conversationId: "AAQkAGI2TG93AAA=",
  internetMessageId: "<SY4P282MB1234@SY4P282MB1234.AUSP282.PROD.OUTLOOK.COM>",
  subject: "Claim 1998 – liability",
  receivedDateTime: "2026-10-29T01:30:00Z",
  from: { emailAddress: { name: "ICWA Claims", address: "claims@icwa.wa.gov.au" } },
  toRecipients: [{ emailAddress: { name: "Priestley, Toni", address: "toni@example.com" } }],
  ccRecipients: [{ emailAddress: { name: "kevin@soullegal.com.au", address: "kevin@soullegal.com.au" } }],
  body: { contentType: "html", content: "<html><body><p>Liability accepted.</p><p>Regards</p></body></html>" },
  categories: ["Box Filed"],
  hasAttachments: true,
};

describe("GraphMailSource", () => {
  it("lists with a receivedDateTime + category $filter and follows @odata.nextLink up to max", async () => {
    const { f, mail } = graph();
    const next = `${ME}/messages?$skip=2&$top=3`;
    f.once("GET", `${ME}/messages?`, { value: [{ id: "a", conversationId: "c1" }, { id: "b", conversationId: "c1" }], "@odata.nextLink": next });
    f.once("GET", next, { value: [{ id: "c", conversationId: "c2" }, { id: "d", conversationId: "c3" }], "@odata.nextLink": `${ME}/messages?$skip=4` });

    const ids = await mail.listMessages({ since: "2026-10-01T00:00:00+08:00", label: "Box Filed/Refile/1998", max: 3 });
    expect(ids).toEqual([{ id: "a", threadId: "c1" }, { id: "b", threadId: "c1" }, { id: "c", threadId: "c2" }]);
    expect(f.calls).toHaveLength(2);
    const p = new URL(f.calls[0]!.url).searchParams;
    expect(p.get("$filter")).toBe("receivedDateTime ge 2026-09-30T16:00:00.000Z and categories/any(c:c eq 'Box Filed/Refile/1998')");
    expect(p.get("$top")).toBe("3");
    expect(p.get("$orderby")).toBe("receivedDateTime desc");
    expect(f.calls[0]!.headers).toMatchObject({ Authorization: "Bearer test-token", Prefer: 'IdType="ImmutableId"' });
  });

  it("uses $search for provider queries and applies since/label to the results", async () => {
    const { f, mail } = graph();
    f.on("GET", `${ME}/messages?`, {
      value: [
        { id: "new", conversationId: "c1", receivedDateTime: "2026-10-20T00:00:00Z", categories: ["box filed"] },
        { id: "old", conversationId: "c2", receivedDateTime: "2026-09-01T00:00:00Z", categories: ["Box Filed"] },
        { id: "nolabel", conversationId: "c3", receivedDateTime: "2026-10-21T00:00:00Z", categories: [] },
      ],
    });
    const ids = await mail.listMessages({ q: 'from:icwa "1998"', since: "2026-10-01T00:00:00Z", label: "Box Filed" });
    expect(ids).toEqual([{ id: "new", threadId: "c1" }]);
    const p = new URL(f.calls[0]!.url).searchParams;
    expect(p.get("$search")).toBe('"from:icwa \\"1998\\""');
    expect(p.has("$filter")).toBe(false);
  });

  it("maps a message, its HTML body and file/item attachments", async () => {
    const { f, mail } = graph();
    f.on("GET", `${ME}/messages/${encodeURIComponent(MESSAGE.id)}?`, MESSAGE);
    f.on("GET", `${ME}/messages/${encodeURIComponent(MESSAGE.id)}/attachments?`, {
      value: [
        { "@odata.type": "#microsoft.graph.fileAttachment", id: "att1", name: "Letter.pdf", contentType: "application/pdf", size: 48213, isInline: false },
        { "@odata.type": "#microsoft.graph.itemAttachment", id: "att2", name: "Fwd: report", contentType: null, size: 9000, isInline: false },
        { "@odata.type": "#microsoft.graph.referenceAttachment", id: "att3", name: "OneDrive link", contentType: null, size: 0 },
      ],
    });
    const m = await mail.getMessage(MESSAGE.id);
    expect(m).toMatchObject({
      id: MESSAGE.id,
      threadId: "AAQkAGI2TG93AAA=",
      internetMessageId: MESSAGE.internetMessageId,
      from: { name: "ICWA Claims", email: "claims@icwa.wa.gov.au" },
      to: [{ name: "Priestley, Toni", email: "toni@example.com" }],
      cc: [{ email: "kevin@soullegal.com.au" }],
      subject: "Claim 1998 – liability",
      date: "2026-10-29T01:30:00.000Z",
      text: "Liability accepted.\nRegards",
      html: MESSAGE.body.content,
      labels: ["Box Filed"],
    });
    expect(m.attachments).toEqual([
      { filename: "Letter.pdf", contentType: "application/pdf", size: 48213, providerAttachmentId: "att1" },
      { filename: "Fwd: report.eml", contentType: "message/rfc822", size: 9000, providerAttachmentId: "att2" },
    ]);

    f.on("GET", `${ME}/messages/${encodeURIComponent(MESSAGE.id)}/attachments/att1/$value`, new Response("%PDF-"));
    expect(new TextDecoder().decode(await mail.getAttachment(MESSAGE.id, m.attachments[0]!))).toBe("%PDF-");
  });

  it("gets raw MIME via $value", async () => {
    const { f, mail } = graph();
    f.on("GET", `${ME}/messages/m1/$value`, new Response("From: a@b.com\r\n\r\nx"));
    expect(new TextDecoder().decode(await mail.getRaw("m1"))).toBe("From: a@b.com\r\n\r\nx");
  });

  it("adds and removes categories with PATCH, skipping no-op writes", async () => {
    const { f, mail } = graph();
    f.on("GET", `${ME}/messages/m1?$select=categories`, { id: "m1", categories: ["Box Filed"] });
    f.on("PATCH", `${ME}/messages/m1`, { id: "m1" });
    await mail.addLabel("m1", "Box Filed/Refile/1998");
    await mail.addLabel("m1", "box filed");
    await mail.removeLabel("m1", "Box Filed");
    await mail.removeLabel("m1", "Absent");
    const patches = f.calls.filter((c) => c.method === "PATCH").map((c) => c.json);
    expect(patches).toEqual([{ categories: ["Box Filed", "Box Filed/Refile/1998"] }, { categories: [] }]);
  });

  it("sends a new message via draft + send, returning the immutable id", async () => {
    const { f, mail } = graph();
    f.on("POST", `${ME}/messages/draft1/send`, empty(202));
    f.on("POST", `${ME}/messages`, json({ id: "draft1", conversationId: "conv9" }, 201));
    const res = await mail.send({
      to: [{ name: "ICWA Claims", email: "claims@icwa.wa.gov.au" }],
      subject: "Claim 1998",
      text: "Please find attached.",
      attachments: [{ filename: "a.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-") }],
    });
    expect(res).toEqual({ id: "draft1", threadId: "conv9" });
    expect(f.calls[0]!.json).toEqual({
      subject: "Claim 1998",
      body: { contentType: "text", content: "Please find attached." },
      toRecipients: [{ emailAddress: { address: "claims@icwa.wa.gov.au", name: "ICWA Claims" } }],
      ccRecipients: [],
      attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: "a.pdf", contentType: "application/pdf", contentBytes: "JVBERi0=" }],
    });
    expect(f.calls[1]!.url).toBe(`${ME}/messages/draft1/send`);
  });

  it("replies with createReply on the conversation's latest message", async () => {
    const { f, mail } = graph();
    f.on("GET", `${ME}/messages?`, {
      value: [
        { id: "older", receivedDateTime: "2026-10-01T00:00:00Z" },
        { id: "latest", receivedDateTime: "2026-10-29T00:00:00Z" },
      ],
    });
    f.on("POST", `${ME}/messages/latest/createReply`, json({ id: "reply1", conversationId: "conv1" }, 201));
    f.on("PATCH", `${ME}/messages/reply1`, { id: "reply1" });
    f.on("POST", `${ME}/messages/reply1/attachments`, json({ id: "x" }, 201));
    f.on("POST", `${ME}/messages/reply1/send`, empty(202));

    const res = await mail.send({
      to: [{ email: "claims@icwa.wa.gov.au" }],
      subject: "RE: Claim 1998",
      text: "Thanks",
      html: "<p>Thanks</p>",
      attachments: [{ filename: "b.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) }],
      threadId: "conv1",
    });
    expect(res).toEqual({ id: "reply1", threadId: "conv1" });
    expect(new URL(f.calls[0]!.url).searchParams.get("$filter")).toBe("conversationId eq 'conv1'");
    expect(f.calls.map((c) => `${c.method} ${c.url.replace(ME, "")}`).slice(1)).toEqual([
      "POST /messages/latest/createReply",
      "PATCH /messages/reply1",
      "POST /messages/reply1/attachments",
      "POST /messages/reply1/send",
    ]);
    expect(f.calls[2]!.json.body).toEqual({ contentType: "html", content: "<p>Thanks</p>" });
  });

  it("reads the mailbox address once", async () => {
    const { f, mail } = graph();
    f.on("GET", `${ME}?$select=mail,userPrincipalName`, { mail: null, userPrincipalName: "kevin@soullegal.com.au" });
    expect(await mail.mailbox()).toBe("kevin@soullegal.com.au");
    expect(await mail.mailbox()).toBe("kevin@soullegal.com.au");
    expect(f.calls).toHaveLength(1);
  });
});
