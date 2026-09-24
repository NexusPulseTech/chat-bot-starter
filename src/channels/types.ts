/** The messaging providers this starter speaks to. */
export type ChannelId = "messenger" | "zalo";

/** A webhook delivery, before any channel-specific parsing. */
export interface RawDelivery {
  readonly body: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

/** One inbound text message, in a shape that is the same for every channel. */
export interface InboundMessage {
  readonly channel: ChannelId;
  /** Provider message id. Used to drop redelivered webhooks. */
  readonly messageId: string;
  /** Provider-scoped id of the person who wrote the message. */
  readonly senderId: string;
  readonly text: string;
  readonly receivedAt: Date;
}

/** A reply to send back. Only text is supported; see the README to extend it. */
export interface OutboundMessage {
  readonly text: string;
}

/** The answer to a provider's subscription handshake. */
export interface HandshakeResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * A provider adapter.
 *
 * Every channel hides its own signature scheme, payload shape and send API
 * behind this interface, so the server and the handler stay channel-agnostic.
 * Add a provider by implementing this and registering it in `src/index.ts`.
 */
export interface Channel {
  readonly id: ChannelId;

  /** True when the delivery really came from the provider. */
  verify(delivery: RawDelivery): boolean;

  /**
   * Answers the provider's subscription handshake.
   * Returns null when the request is not a handshake.
   */
  handshake(query: URLSearchParams): HandshakeResponse | null;

  /**
   * Extracts inbound text messages from a webhook payload.
   * Entries that are not text messages are skipped rather than rejected: a
   * provider may add event types at any time, and an unknown one is not an
   * error.
   */
  parse(body: string): InboundMessage[];

  /** Delivers a reply through the provider API. */
  send(recipientId: string, message: OutboundMessage): Promise<void>;
}

/** Business logic: receives a message, optionally returns a reply. */
export type MessageHandler = (
  message: InboundMessage,
) => Promise<OutboundMessage | null> | OutboundMessage | null;
