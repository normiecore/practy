import type * as B from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderTranscript, toolsFor, type AgentEvent } from "../src/ai/agent.js";
import { quoteOnPage } from "../src/ai/chronology.js";
import type { ChatModel, JsonParams, TurnParams } from "../src/ai/gateway.js";
import { documentsOf } from "../src/documents/model.js";
import { createApp } from "../src/server/app.js";
import { as, TENANT, users } from "./helpers.js";

const usage = { input_tokens: 100, output_tokens: 50 } as B.BetaUsage;
const msg = (content: B.BetaContentBlock[], stop_reason: B.BetaMessage["stop_reason"]): B.BetaMessage =>
  ({ id: "m", type: "message", role: "assistant", model: "fake", content, stop_reason, stop_sequence: null, usage }) as unknown as B.BetaMessage;

class ScriptedModel implements ChatModel {
  readonly provider = "anthropic" as const;
  readonly model = "fake-model";
  readonly turns: TurnParams[] = [];
  constructor(
    private readonly script: B.BetaMessage[] = [],
    private readonly jsonOut: unknown[] = [],
  ) {}
  async turn(p: TurnParams, onText?: (d: string) => void) {
    this.turns.push(structuredClone({ ...p, signal: undefined }));
    const next = this.script.shift();
    if (!next) throw new Error("script exhausted");
    for (const b of next.content) if (b.type === "text") onText?.(b.text);
    return next;
  }
  async json<T>(p: JsonParams<T>) {
    return { value: p.schema.parse(this.jsonOut.shift()), usage };
  }
}

describe("in-app assistant", () => {
  it("operates Practy through the command registry as the user, surfacing approvals", async () => {
    const model = new ScriptedModel([
      msg([{ type: "text", text: "Opening the matter." } as B.BetaTextBlock, { type: "tool_use", id: "t1", name: "create_matter", input: { number: "2100", title: "Lee v ICWA", scheme: "icwa_mva", injuryDate: "2026-02-01", client: { name: "Sam Lee" } } } as B.BetaToolUseBlock], "tool_use"),
      msg([{ type: "tool_use", id: "t2", name: "decide_approval", input: { approvalId: "x", decision: "approve" } } as B.BetaToolUseBlock], "tool_use"),
      msg([{ type: "text", text: "Done. The limitation date is proposed and needs confirmation." } as B.BetaTextBlock], "end_turn"),
    ]);
    const app = createApp({ chatModel: () => model });
    const convo = app.agent.start(users.solicitor);
    const events: AgentEvent[] = [];
    await app.agent.send(users.solicitor, convo.id, "Open a new ICWA matter for Sam Lee, injured 1 Feb 2026", (e) => events.push(e));

    expect(events.filter((e) => e.type === "tool_result").map((e: any) => [e.name, e.status])).toEqual([
      ["create_matter", "executed"],
      ["decide_approval", "error"],
    ]);
    expect(events.at(-1)).toEqual({ type: "done", conversationId: convo.id });
    // Tools exclude human-only commands; second turn saw the tool results.
    expect(model.turns[0]!.tools!.map((t: any) => t.name)).not.toContain("decide_approval");
    expect(JSON.stringify(model.turns[1]!.messages.at(-1))).toContain("tool_result");
    // Audit shows the agent surface.
    const matter = app.store.matterByNumber(TENANT, "2100")!;
    expect(app.bus.audit.list({ tenantId: TENANT, matterId: matter.id, aiOnly: true }).map((e) => e.surface)).toEqual(["agent"]);
    const transcript = renderTranscript(app.agent.get(users.solicitor, convo.id));
    expect(transcript.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(transcript[1]!.tools).toEqual([{ name: "create_matter", status: "executed" }, { name: "decide_approval", status: "error" }]);
  });

  it("refuses matter-scoped chats on matters without AI consent", async () => {
    const app = createApp({ chatModel: () => new ScriptedModel() });
    const created = await app.bus.execute("create_matter", { number: "1", title: "No AI", scheme: "icwa_mva", injuryDate: "2026-01-01", client: { name: "X Y" }, aiPermitted: false }, as(users.solicitor));
    const matterId = (created as any).result.matter.id;
    const convo = app.agent.start(users.solicitor, matterId);
    await expect(app.agent.send(users.solicitor, convo.id, "hi", () => {})).rejects.toMatchObject({ code: "not_found" });
  });

  it("produces valid JSON-schema tool definitions for every command", () => {
    const app = createApp({ chatModel: () => new ScriptedModel() });
    for (const t of toolsFor(app.bus) as B.BetaTool[]) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).not.toHaveProperty("$schema");
    }
  });
});

async function samplePdf(pages: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = pdf.addPage([595, 842]);
    text.split("\n").forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 16, size: 11, font }));
  }
  return pdf.save();
}

describe("medical chronology", () => {
  it("verifies each event's quote against the cited page and flags the rest", async () => {
    const pdf = await samplePdf([
      "Perth Hospital ED 14/03/2025\nPatient presented after MVA with neck pain.\nDiagnosis: whiplash injury C5-C6.",
      "Dr A Smith, GP 20/03/2025\nUnfit for work 14 days. Prior history of lower back pain noted.",
    ]);
    const event = (page: number, quote: string, extra: object = {}) => ({
      page, date: "2025-03-14", dateText: "14/03/2025", provider: "Perth Hospital", eventType: "hospital", summary: "s", diagnoses: [], wpiPercent: null, workCapacity: null, preExistingFlag: false, quote, ...extra,
    });
    const model = new ScriptedModel([], [
      { events: [event(1, "Diagnosis: whiplash injury C5-C6"), event(2, "Unfit for work 14 days.", { date: "", preExistingFlag: true }), event(2, "Fractured femur"), event(9, "anything")] },
    ]);
    const app = createApp({ chatModel: () => model, loadDocumentBytes: async () => pdf });
    const created = await app.bus.execute("create_matter", { number: "1998", title: "Priestley v ICWA", scheme: "icwa_mva", injuryDate: "2025-03-14", client: { name: "Toni Priestley" } }, as(users.solicitor));
    const matterId = (created as any).result.matter.id;
    documentsOf(app.store).set({ id: "d1", tenantId: TENANT, matterId, store: "local", storeFileId: "f", folderId: "x", name: "2025.03.14 Hospital Records – Perth Hospital.pdf", contentType: "application/pdf", size: pdf.length, source: "upload", createdAt: "", createdBy: "u" });

    const out = await app.bus.execute("build_chronology", { matterId, documentId: "d1" }, as(users.paralegal));
    expect((out as any).result).toMatchObject({ events: 3, unverified: 1 });
    const chron = (await app.bus.execute("get_chronology", { matterId }, as(users.solicitor)) as any).result;
    expect(chron.map((e: any) => [e.page, e.verification, e.date])).toEqual([
      [1, "verified", "2025-03-14"],
      [2, "quote_not_on_page", "2025-03-14"],
      [2, "verified", null],
    ]);
    expect(app.chronology.runs.list(TENANT)[0]).toMatchObject({ model: "fake-model", pages: 2, events: 3 });

    // Documents excluded from AI are refused.
    documentsOf(app.store).update("d1", (d) => { d.aiExcluded = true; d.aiExcludedReason = "suppressed"; });
    await expect(app.bus.execute("build_chronology", { matterId, documentId: "d1" }, as(users.paralegal))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("matches quotes despite whitespace and punctuation differences", () => {
    expect(quoteOnPage("Unfit  for work, 14 days", "Dr Smith: unfit for work 14 days. Review.")).toBe(true);
    expect(quoteOnPage("fractured femur", "whiplash only")).toBe(false);
  });
});
