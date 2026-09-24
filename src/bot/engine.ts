import type { AiResponder } from "../ai/claude.js";
import type { InboundMessage, MessageHandler } from "../channels/types.js";
import type { Conversation, ConversationMode, OrderDraft, StoredMessage } from "../db/store.js";
import { normalize, type Rule } from "../handlers/rules.js";
import { log } from "../logger.js";
import { advanceOrderFlow, parseFlowState, startOrderFlow } from "./order-flow.js";

/** Asking for a person. Checked on accent-free, lowercased text. */
const HANDOFF = /\b(gap nhan vien|noi chuyen voi nhan vien|tu van vien|gap nguoi that|nguoi that|human|agent)\b/;

/** Wanting to buy. Kept narrow: "mua" alone also means "where can I buy". */
const ORDER_INTENT = /\b(dat hang|dat mua|mua hang|len don|chot don|order)\b/;

export const HANDOFF_REPLY = "Dạ, shop đã chuyển cho nhân viên. Bạn chờ trong giây lát, nhân viên sẽ trả lời ngay ạ.";

export type DecisionSource = "human-mode" | "handoff" | "order-flow" | "forward" | "ai" | "rule" | "fallback";

export interface Decision {
  readonly source: DecisionSource;
  /** Text to send, or null to stay silent. */
  readonly reply: string | null;
  /** New conversation mode, when it changes. */
  readonly mode?: ConversationMode;
  /** New order-flow state as JSON, null to clear it, undefined to leave it. */
  readonly flow?: string | null;
  /** Set when the customer has just confirmed an order. */
  readonly order?: OrderDraft;
}

export interface EngineSettings {
  readonly aiEnabled: boolean;
  readonly knowledge: string;
}

export interface EngineOptions {
  readonly rules: readonly Rule[];
  readonly fallback: string;
  /** Present when an AI provider is configured. */
  readonly ai?: AiResponder;
  /** Present when FORWARD_URL is set: an external workflow answers instead. */
  readonly forward?: MessageHandler;
  /** Read on every message, so dashboard changes apply without a restart. */
  readonly settings: () => EngineSettings;
}

export interface DecideInput {
  readonly conversation: Conversation;
  readonly message: InboundMessage;
  /** Recent messages, oldest first, including the one being answered. */
  readonly history: readonly StoredMessage[];
}

/**
 * Decides how the bot answers one message. The order of the checks is the
 * product behaviour, so it is kept in one readable function:
 *
 * 1. A person has taken over: stay silent.
 * 2. An order is in progress: continue it.
 * 3. The customer asks for a person: hand over.
 * 4. The customer wants to order: start the order flow.
 * 5. An external workflow is configured: let it answer.
 * 6. AI is on: let the model answer from the business information.
 * 7. Otherwise: keyword rules, then the fallback reply.
 */
export class Engine {
  readonly #options: EngineOptions;

  constructor(options: EngineOptions) {
    this.#options = options;
  }

  async decide({ conversation, message, history }: DecideInput): Promise<Decision> {
    if (conversation.mode === "human") return { source: "human-mode", reply: null };

    const flow = parseFlowState(conversation.flow);
    if (flow) {
      const result = advanceOrderFlow(flow, message.text);
      return {
        source: "order-flow",
        reply: result.reply || null,
        flow: result.state ? JSON.stringify(result.state) : null,
        ...(result.order ? { order: result.order } : {}),
      };
    }

    const plain = normalize(message.text);

    if (HANDOFF.test(plain)) {
      return { source: "handoff", reply: HANDOFF_REPLY, mode: "human" };
    }

    if (ORDER_INTENT.test(plain)) {
      const result = startOrderFlow();
      return { source: "order-flow", reply: result.reply, flow: JSON.stringify(result.state) };
    }

    if (this.#options.forward) {
      try {
        const answer = await this.#options.forward(message);
        return { source: "forward", reply: answer?.text ?? null };
      } catch (error) {
        log.error("forward failed", { error: error instanceof Error ? error.message : String(error) });
        return { source: "fallback", reply: this.#options.fallback };
      }
    }

    const settings = this.#options.settings();
    if (this.#options.ai && settings.aiEnabled) {
      try {
        const text = await this.#options.ai.reply({ knowledge: settings.knowledge, history });
        if (text) return { source: "ai", reply: text };
      } catch (error) {
        log.error("ai reply failed", { error: error instanceof Error ? error.message : String(error) });
      }
      return { source: "fallback", reply: this.#options.fallback };
    }

    const rule = this.#options.rules.find((candidate) => candidate.pattern.test(plain));
    if (rule) return { source: "rule", reply: rule.reply };

    return { source: "fallback", reply: this.#options.fallback };
  }
}
