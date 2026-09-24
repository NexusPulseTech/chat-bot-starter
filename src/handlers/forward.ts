import type { InboundMessage, MessageHandler, OutboundMessage } from "../channels/types.js";

export interface ForwardOptions {
  /** Endpoint that receives each message, for example an n8n Webhook node. */
  readonly url: string;
  /** Sent as a bearer token so the endpoint can reject other callers. */
  readonly token?: string;
  /** Give up after this long, so a slow workflow cannot stall the bot. */
  readonly timeoutMs?: number;
}

/**
 * Builds a handler that hands each message to an external workflow.
 *
 * The endpoint receives the normalised message as JSON and answers with
 * `{ "reply": "..." }` to reply, or with anything else to stay silent. This is
 * how the bot plugs into n8n, Make.com, a CRM, or a model API: the webhook
 * plumbing stays here, and the business logic lives where the team edits it.
 */
export function createForwardHandler(options: ForwardOptions): MessageHandler {
  const timeoutMs = options.timeoutMs ?? 8_000;

  return async (message: InboundMessage): Promise<OutboundMessage | null> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.token) headers["authorization"] = `Bearer ${options.token}`;

    const response = await fetch(options.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        channel: message.channel,
        messageId: message.messageId,
        senderId: message.senderId,
        text: message.text,
        receivedAt: message.receivedAt.toISOString(),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Forward endpoint returned ${response.status}`);
    }

    const result: unknown = await response.json().catch(() => null);
    if (typeof result === "object" && result !== null && "reply" in result) {
      const reply = (result as { reply: unknown }).reply;
      if (typeof reply === "string" && reply.trim() !== "") return { text: reply };
    }
    return null;
  };
}
