import Anthropic from "@anthropic-ai/sdk";
import type { StoredMessage } from "../db/store.js";

export type Effort = "low" | "medium" | "high";

export interface AiReplyRequest {
  /** What the business wants the assistant to know: products, prices, policies. */
  readonly knowledge: string;
  /** The conversation so far, oldest first, ending with the customer's message. */
  readonly history: readonly StoredMessage[];
}

/** Anything that can write a reply. Swapped for a fake in tests. */
export interface AiResponder {
  /** Returns the reply text, or null when the model declined or failed. */
  reply(request: AiReplyRequest): Promise<string | null>;
}

/** Only the part of the SDK client this module calls, so tests can pass a fake. */
export interface MessagesClient {
  beta: {
    messages: {
      create(
        params: Anthropic.Beta.MessageCreateParamsNonStreaming,
      ): Promise<Anthropic.Beta.BetaMessage>;
    };
  };
}

export interface ClaudeResponderOptions {
  readonly client: MessagesClient;
  readonly model: string;
  readonly effort: Effort;
  /** How many recent messages the model sees. Older ones are dropped. */
  readonly historyLimit?: number;
}

/**
 * Builds the system prompt. The business information goes last and is the
 * only part that changes, so the instructions before it stay a stable prefix.
 */
export function buildSystemPrompt(knowledge: string): string {
  return [
    "You are the customer service assistant for a business that talks to its customers on Zalo and Facebook Messenger.",
    "",
    "Answer using only the business information below. When the answer is not there, say you will pass the question to a staff member. Never guess prices, stock, promotions, policies or delivery times.",
    "",
    "Reply in the customer's language, which is usually Vietnamese, in the warm and polite tone of a small shop. Write plain text without markdown, because chat apps show it as raw symbols. Keep replies to three short sentences at most.",
    "",
    'When the customer wants to buy, tell them to send "đặt hàng" and the bot will take the order step by step. When they ask for a person, tell them to send "gặp nhân viên".',
    "",
    "<business_information>",
    knowledge.trim() || "No business information has been provided yet.",
    "</business_information>",
  ].join("\n");
}

/**
 * Maps stored messages to API turns: the customer is the user, the bot and
 * staff are the assistant. Failed sends are dropped because the customer never
 * saw them, and leading assistant turns are dropped because the conversation
 * must start with the user.
 */
export function toApiMessages(history: readonly StoredMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const delivered = history.filter((message) => message.status !== "failed" && message.text.trim() !== "");
  const firstCustomer = delivered.findIndex((message) => message.author === "customer");
  if (firstCustomer === -1) return [];

  return delivered.slice(firstCustomer).map((message) => ({
    role: message.author === "customer" ? "user" : "assistant",
    content: message.text,
  }));
}

/** Writes replies with Claude through the official Anthropic SDK. */
export class ClaudeResponder implements AiResponder {
  readonly #client: MessagesClient;
  readonly #model: string;
  readonly #effort: Effort;
  readonly #historyLimit: number;

  constructor(options: ClaudeResponderOptions) {
    this.#client = options.client;
    this.#model = options.model;
    this.#effort = options.effort;
    this.#historyLimit = options.historyLimit ?? 20;
  }

  async reply(request: AiReplyRequest): Promise<string | null> {
    const messages = toApiMessages(request.history.slice(-this.#historyLimit));
    const last = messages.at(-1);
    if (!last || last.role !== "user") return null;

    const response = await this.#client.beta.messages.create({
      model: this.#model,
      // Replies are short, but adaptive thinking also draws on this budget.
      max_tokens: 4096,
      output_config: { effort: this.#effort },
      // If a safety classifier declines, retry on the model Anthropic
      // recommends for that case instead of leaving the customer unanswered.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        {
          type: "text",
          text: buildSystemPrompt(request.knowledge),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    });

    // A refusal means every model in the fallback chain declined.
    if (response.stop_reason === "refusal") return null;

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    return text === "" ? null : text;
  }
}

/** Creates the SDK client. The API key is read from ANTHROPIC_API_KEY. */
export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });
}
