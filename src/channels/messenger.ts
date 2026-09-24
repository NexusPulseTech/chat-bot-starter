import { verifyMessengerSignature } from "../security/signature.js";
import type {
  Channel,
  HandshakeResponse,
  InboundMessage,
  OutboundMessage,
  RawDelivery,
} from "./types.js";

export interface MessengerConfig {
  /** App secret, used to verify the signature on every delivery. */
  readonly appSecret: string;
  /** Page access token, used to call the Send API. */
  readonly pageAccessToken: string;
  /** The value you typed into the Messenger dashboard when subscribing. */
  readonly verifyToken: string;
  /** Graph API version. Pin it: Meta retires versions on a schedule. */
  readonly graphApiVersion?: string;
}

const DEFAULT_GRAPH_API_VERSION = "v21.0";

/** Narrows an unknown value to a plain object so fields can be read safely. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Facebook Messenger adapter.
 *
 * @see https://developers.facebook.com/docs/messenger-platform
 */
export class MessengerChannel implements Channel {
  readonly id = "messenger" as const;
  readonly #config: MessengerConfig;

  constructor(config: MessengerConfig) {
    this.#config = config;
  }

  verify(delivery: RawDelivery): boolean {
    return verifyMessengerSignature(
      this.#config.appSecret,
      delivery.body,
      delivery.headers["x-hub-signature-256"],
    );
  }

  /**
   * Answers the subscription handshake.
   *
   * When you save a webhook URL, Messenger sends a GET carrying a challenge and
   * the token you configured. Echoing the challenge back proves you own the
   * endpoint. Comparing the token is what stops a stranger from pointing their
   * app at your URL.
   */
  handshake(query: URLSearchParams): HandshakeResponse | null {
    const mode = query.get("hub.mode");
    const token = query.get("hub.verify_token");
    const challenge = query.get("hub.challenge");

    if (mode === null && token === null && challenge === null) return null;

    if (mode !== "subscribe" || token !== this.#config.verifyToken || challenge === null) {
      return { status: 403, body: "Forbidden" };
    }
    return { status: 200, body: challenge };
  }

  /**
   * Reads text messages out of a page webhook payload.
   *
   * Shape: `{ object: "page", entry: [{ messaging: [{ sender, message }] }] }`.
   * Echoes of the page's own outgoing messages carry `is_echo` and are skipped,
   * otherwise the bot would answer itself in a loop. Deliveries, reads,
   * postbacks and attachments are skipped here; see the README to add them.
   */
  parse(body: string): InboundMessage[] {
    const payload: unknown = JSON.parse(body);
    if (!isRecord(payload) || payload["object"] !== "page") return [];

    const entries = payload["entry"];
    if (!Array.isArray(entries)) return [];

    const messages: InboundMessage[] = [];

    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry["messaging"])) continue;

      for (const event of entry["messaging"]) {
        if (!isRecord(event)) continue;

        const message = event["message"];
        const sender = event["sender"];
        if (!isRecord(message) || !isRecord(sender)) continue;
        if (message["is_echo"] === true) continue;

        const text = message["text"];
        const messageId = message["mid"];
        const senderId = sender["id"];
        if (typeof text !== "string" || typeof messageId !== "string") continue;
        if (typeof senderId !== "string") continue;

        const timestamp = event["timestamp"];
        messages.push({
          channel: this.id,
          messageId,
          senderId,
          text,
          receivedAt: typeof timestamp === "number" ? new Date(timestamp) : new Date(),
        });
      }
    }

    return messages;
  }

  /**
   * Sends a reply through the Send API.
   *
   * The token goes in the request body rather than the query string, so it is
   * not captured by proxy and server access logs.
   */
  async send(recipientId: string, message: OutboundMessage): Promise<void> {
    const version = this.#config.graphApiVersion ?? DEFAULT_GRAPH_API_VERSION;
    const response = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { text: message.text },
        access_token: this.#config.pageAccessToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Messenger Send API returned ${response.status}: ${await response.text()}`);
    }
  }
}
