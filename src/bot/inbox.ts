import type { Channel, ChannelId, InboundMessage } from "../channels/types.js";
import type { Store, StoredMessage } from "../db/store.js";
import { log } from "../logger.js";
import type { Engine } from "./engine.js";

export interface InboxOptions {
  readonly store: Store;
  readonly engine: Engine;
  readonly channels: readonly Channel[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Ties the pieces together: stores every message, asks the engine for a
 * reply, applies its decision and sends the answer.
 *
 * Messages from the same customer are handled one at a time. A customer who
 * sends their phone number and address as two quick messages would otherwise
 * have both read the same order-flow step, and one of them would be lost.
 */
export class Inbox {
  readonly #store: Store;
  readonly #engine: Engine;
  readonly #channels: Map<ChannelId, Channel>;
  readonly #queues = new Map<number, Promise<void>>();

  constructor(options: InboxOptions) {
    this.#store = options.store;
    this.#engine = options.engine;
    this.#channels = new Map(options.channels.map((channel) => [channel.id, channel]));
  }

  /**
   * Handles one inbound message. Returns false when the message is a
   * redelivery that was already handled.
   */
  async receive(message: InboundMessage): Promise<boolean> {
    const conversation = this.#store.recordInbound(message);
    if (!conversation) {
      log.info("duplicate delivery skipped", { channel: message.channel, messageId: message.messageId });
      return false;
    }

    await this.#serialize(conversation.id, () => this.#answer(conversation.id, message));
    return true;
  }

  /** Sends a reply typed by a person in the dashboard, and takes the conversation over from the bot. */
  async sendAgentReply(conversationId: number, text: string): Promise<StoredMessage> {
    const conversation = this.#store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation ${conversationId} does not exist`);

    return this.#serialize(conversationId, async () => {
      this.#store.setMode(conversationId, "human");
      this.#store.markRead(conversationId);
      return this.#deliver(conversationId, "agent", text);
    });
  }

  async #answer(conversationId: number, message: InboundMessage): Promise<void> {
    // Re-read inside the queue: an earlier message may have changed the mode or flow.
    const conversation = this.#store.getConversation(conversationId);
    if (!conversation) return;

    const history = this.#store.listMessages(conversationId, { limit: 20 });
    const decision = await this.#engine.decide({ conversation, message, history });

    if (decision.mode) this.#store.setMode(conversationId, decision.mode);
    if (decision.flow !== undefined) this.#store.setFlow(conversationId, decision.flow);

    let reply = decision.reply;
    if (decision.order) {
      const order = this.#store.createOrder(conversationId, decision.order);
      reply = `Shop đã nhận đơn #${order.id}. Nhân viên sẽ gọi xác nhận qua số ${order.phone} trong thời gian sớm nhất. Cảm ơn bạn!`;
      log.info("order created", { orderId: order.id, conversationId });
    }

    log.info("message handled", {
      channel: message.channel,
      messageId: message.messageId,
      source: decision.source,
      replied: reply !== null,
    });

    if (reply) await this.#deliver(conversationId, "bot", reply);
  }

  /** Sends through the channel and records the outcome, success or failure. */
  async #deliver(conversationId: number, author: "bot" | "agent", text: string): Promise<StoredMessage> {
    const conversation = this.#store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation ${conversationId} does not exist`);

    const channel = this.#channels.get(conversation.channel);
    if (!channel) {
      return this.#store.recordOutbound(conversationId, author, text, {
        status: "failed",
        error: `Channel ${conversation.channel} is not configured`,
      });
    }

    try {
      await channel.send(conversation.externalId, { text });
      return this.#store.recordOutbound(conversationId, author, text, { status: "sent" });
    } catch (error) {
      log.error("send failed", { channel: conversation.channel, conversationId, error: errorMessage(error) });
      return this.#store.recordOutbound(conversationId, author, text, { status: "failed", error: errorMessage(error) });
    }
  }

  /** Runs `work` after every earlier task for the same conversation has finished. */
  #serialize<T>(conversationId: number, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(conversationId) ?? Promise.resolve();
    const result = previous.then(work, work);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(conversationId, tail);
    void tail.then(() => {
      if (this.#queues.get(conversationId) === tail) this.#queues.delete(conversationId);
    });
    return result;
  }
}
