import { verifyZaloSignature } from "../security/signature.js";
import type {
  Channel,
  HandshakeResponse,
  InboundMessage,
  OutboundMessage,
  RawDelivery,
} from "./types.js";

export interface ZaloConfig {
  /** App id from the Zalo developer console. Part of the signature input. */
  readonly appId: string;
  /** OA secret key, used to verify the signature on every delivery. */
  readonly oaSecretKey: string;
  /** OA access token, used to call the send API. Refresh it before it expires. */
  readonly accessToken: string;
  /** Open API version. Pin it so a platform release cannot change behaviour. */
  readonly openApiVersion?: string;
}

const DEFAULT_OPEN_API_VERSION = "v3.0";

/** Text events this adapter answers. Other events are ignored, not rejected. */
const TEXT_EVENTS = new Set(["user_send_text", "anonymous_send_text"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Zalo sends the timestamp as a number in some events and a string in others. */
function readTimestamp(payload: Record<string, unknown>): string {
  const timestamp = payload["timestamp"];
  if (typeof timestamp === "string") return timestamp;
  if (typeof timestamp === "number") return String(timestamp);
  return "";
}

/**
 * Zalo Official Account adapter.
 *
 * @see https://developers.zalo.me/docs/official-account
 */
export class ZaloChannel implements Channel {
  readonly id = "zalo" as const;
  readonly #config: ZaloConfig;

  constructor(config: ZaloConfig) {
    this.#config = config;
  }

  /**
   * Verifies the delivery signature.
   *
   * The timestamp is read from the body rather than a header, because the body
   * is what the digest covers. Taking it from a header would let a replayed
   * request pass a fresh-looking timestamp while carrying an old payload.
   */
  verify(delivery: RawDelivery): boolean {
    let timestamp = "";
    try {
      const payload: unknown = JSON.parse(delivery.body);
      if (isRecord(payload)) timestamp = readTimestamp(payload);
    } catch {
      return false;
    }

    return verifyZaloSignature(
      this.#config.appId,
      this.#config.oaSecretKey,
      delivery.body,
      timestamp,
      delivery.headers["x-zevent-signature"],
    );
  }

  /** Zalo has no subscription handshake, so there is nothing to answer. */
  handshake(): HandshakeResponse | null {
    return null;
  }

  /**
   * Reads a text message out of an event payload.
   *
   * Shape: `{ event_name, sender: { id }, message: { msg_id, text }, timestamp }`.
   * One event carries at most one message, unlike Messenger, which batches.
   */
  parse(body: string): InboundMessage[] {
    const payload: unknown = JSON.parse(body);
    if (!isRecord(payload)) return [];

    const eventName = payload["event_name"];
    if (typeof eventName !== "string" || !TEXT_EVENTS.has(eventName)) return [];

    const message = payload["message"];
    const sender = payload["sender"];
    if (!isRecord(message) || !isRecord(sender)) return [];

    const text = message["text"];
    const messageId = message["msg_id"];
    const senderId = sender["id"];
    if (typeof text !== "string" || typeof messageId !== "string") return [];
    if (typeof senderId !== "string") return [];

    const timestamp = Number(readTimestamp(payload));
    return [
      {
        channel: this.id,
        messageId,
        senderId,
        text,
        receivedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : new Date(),
      },
    ];
  }

  /**
   * Sends a reply through the customer service message API.
   *
   * Zalo only allows this within its customer care window, which opens when the
   * user writes to the OA. A reply sent outside that window is rejected by the
   * API, so the error below is worth surfacing rather than swallowing.
   */
  async send(recipientId: string, message: OutboundMessage): Promise<void> {
    const version = this.#config.openApiVersion ?? DEFAULT_OPEN_API_VERSION;
    const response = await fetch(`https://openapi.zalo.me/${version}/oa/message/cs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        access_token: this.#config.accessToken,
      },
      body: JSON.stringify({
        recipient: { user_id: recipientId },
        message: { text: message.text },
      }),
    });

    if (!response.ok) {
      throw new Error(`Zalo Open API returned ${response.status}: ${await response.text()}`);
    }

    // Zalo answers 200 with a non-zero `error` field when a send fails, so the
    // status code alone is not enough to call it a success.
    const result: unknown = await response.json().catch(() => null);
    if (isRecord(result) && typeof result["error"] === "number" && result["error"] !== 0) {
      throw new Error(`Zalo Open API error ${result["error"]}: ${String(result["message"] ?? "")}`);
    }
  }
}
