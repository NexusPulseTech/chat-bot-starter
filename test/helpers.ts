import { MessengerChannel } from "../src/channels/messenger.js";
import type { InboundMessage, OutboundMessage } from "../src/channels/types.js";
import { ZaloChannel } from "../src/channels/zalo.js";
import { openDatabase } from "../src/db/database.js";
import { Store } from "../src/db/store.js";

/** A real Zalo adapter whose send() records calls instead of calling Zalo. */
export class RecordingZalo extends ZaloChannel {
  readonly sent: { to: string; text: string }[] = [];
  failNext = false;

  constructor() {
    super({ appId: "app-1", oaSecretKey: "oa-secret", accessToken: "token" });
  }

  override async send(recipientId: string, message: OutboundMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Zalo Open API error -230: user has not interacted with the OA in the last 7 days");
    }
    this.sent.push({ to: recipientId, text: message.text });
  }
}

/** A real Messenger adapter whose send() records calls instead of calling Meta. */
export class RecordingMessenger extends MessengerChannel {
  readonly sent: { to: string; text: string }[] = [];

  constructor(appSecret = "test-app-secret") {
    super({ appSecret, pageAccessToken: "t", verifyToken: "verify-me" });
  }

  override async send(recipientId: string, message: OutboundMessage): Promise<void> {
    this.sent.push({ to: recipientId, text: message.text });
  }
}

export function memoryStore(): Store {
  return new Store(openDatabase(":memory:"));
}

let counter = 0;
export function zaloMessage(text: string, senderId = "customer-1"): InboundMessage {
  counter += 1;
  return { channel: "zalo", messageId: `z-${counter}`, senderId, text, receivedAt: new Date() };
}
