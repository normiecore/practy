import Anthropic from "@anthropic-ai/sdk";
import type * as B from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { z } from "zod";


/**
 * The only path from Practy to a model. Two providers:
 *  - "anthropic": the Claude API (refusal fallbacks enabled server-side)
 *  - "bedrock":   Amazon Bedrock in an AU region (ap-southeast-2), keeping inference in Australia
 * The model id is configuration (settings.ai.model / PRACTY_AI_MODEL), never hard-coded.
 */
export interface TurnParams {
  system: string;
  messages: B.BetaMessageParam[];
  tools?: B.BetaToolUnion[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  signal?: AbortSignal;
}

export interface JsonParams<T> {
  system: string;
  content: B.BetaContentBlockParam[];
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: TurnParams["effort"];
}

export interface ChatModel {
  readonly provider: "anthropic" | "bedrock";
  readonly model: string;
  /** One streamed model turn; text deltas go to onText. Returns the complete message. */
  turn(p: TurnParams, onText?: (delta: string) => void): Promise<B.BetaMessage>;
  /** Single call constrained to a JSON schema, validated with zod. */
  json<T>(p: JsonParams<T>): Promise<{ value: T; usage: B.BetaUsage }>;
}

export class AiRefusalError extends Error {
  constructor(readonly category: string | null | undefined) {
    super(`The model declined this request${category ? ` (${category})` : ""}`);
    this.name = "AiRefusalError";
  }
}

export interface GatewayConfig {
  provider: "anthropic" | "bedrock";
  model: string;
  awsRegion?: string;
  apiKey?: string;
}

/** JSON schema for the API: drop the draft marker, keep objects closed. */
export function toApiSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  return rest;
}

export class ClaudeGateway implements ChatModel {
  readonly provider;
  readonly model;
  private readonly client: Anthropic;

  constructor(cfg: GatewayConfig, client?: Anthropic) {
    if (!cfg.model) throw new Error("AI model is not configured (set PRACTY_AI_MODEL or Settings → AI)");
    this.provider = cfg.provider;
    this.model = cfg.provider === "bedrock" && !cfg.model.startsWith("anthropic.") ? `anthropic.${cfg.model}` : cfg.model;
    this.client =
      client ??
      (cfg.provider === "bedrock"
        ? (new AnthropicBedrockMantle({ awsRegion: cfg.awsRegion ?? "ap-southeast-2" }) as unknown as Anthropic)
        : new Anthropic(cfg.apiKey ? { apiKey: cfg.apiKey } : {}));
  }

  /** Server-side refusal fallbacks are a Claude API feature; Bedrock requests omit them. */
  private extras(): Partial<B.MessageCreateParamsNonStreaming> {
    return this.provider === "anthropic" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
  }

  async turn(p: TurnParams, onText?: (delta: string) => void): Promise<B.BetaMessage> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: p.maxTokens ?? 32000,
        system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
        messages: p.messages,
        ...(p.tools?.length ? { tools: p.tools } : {}),
        output_config: { effort: p.effort ?? "medium" },
        ...this.extras(),
      },
      { signal: p.signal },
    );
    if (onText) stream.on("text", onText);
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new AiRefusalError(message.stop_details?.category);
    return message;
  }

  async json<T>(p: JsonParams<T>): Promise<{ value: T; usage: B.BetaUsage }> {
    const message = await this.client.beta.messages
      .stream({
        model: this.model,
        max_tokens: p.maxTokens ?? 32000,
        system: p.system,
        messages: [{ role: "user", content: p.content }],
        output_config: { effort: p.effort ?? "medium", format: { type: "json_schema", schema: toApiSchema(p.schema) } },
        ...this.extras(),
      })
      .finalMessage();
    if (message.stop_reason === "refusal") throw new AiRefusalError(message.stop_details?.category);
    if (message.stop_reason === "max_tokens") throw new Error("Model output was truncated (max_tokens); split the input");
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { value: p.schema.parse(JSON.parse(text)), usage: message.usage };
  }
}
