import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessengerChannel } from "../src/channels/messenger.js";
import { hmacSha256 } from "../src/security/signature.js";

const channel = new MessengerChannel({
  appSecret: "secret",
  pageAccessToken: "page-token",
  verifyToken: "verify-me",
});

function textEvent(mid: string, text: string, extra: Record<string, unknown> = {}) {
  return { sender: { id: "user-1" }, recipient: { id: "page-1" }, timestamp: 1727150000000, message: { mid, text, ...extra } };
}

function page(...events: unknown[]) {
  return JSON.stringify({ object: "page", entry: [{ id: "page-1", time: 1, messaging: events }] });
}

describe("MessengerChannel.handshake", () => {
  it("echoes the challenge when the token matches", () => {
    const query = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "12345" });
    assert.deepEqual(channel.handshake(query), { status: 200, body: "12345" });
  });

  it("refuses a wrong token", () => {
    const query = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "guess", "hub.challenge": "12345" });
    assert.equal(channel.handshake(query)?.status, 403);
  });

  it("returns null for a request that is not a handshake", () => {
    assert.equal(channel.handshake(new URLSearchParams()), null);
  });
});

describe("MessengerChannel.verify", () => {
  it("accepts a delivery signed with the app secret", () => {
    const body = page(textEvent("m1", "hi"));
    const headers = { "x-hub-signature-256": `sha256=${hmacSha256("secret", body)}` };
    assert.equal(channel.verify({ body, headers }), true);
  });

  it("rejects an unsigned delivery", () => {
    assert.equal(channel.verify({ body: page(), headers: {} }), false);
  });
});

describe("MessengerChannel.parse", () => {
  it("reads a text message", () => {
    const [message] = channel.parse(page(textEvent("m1", "Xin chào")));
    assert.ok(message);
    assert.equal(message.channel, "messenger");
    assert.equal(message.messageId, "m1");
    assert.equal(message.senderId, "user-1");
    assert.equal(message.text, "Xin chào");
    assert.equal(message.receivedAt.getTime(), 1727150000000);
  });

  it("reads every message in a batched delivery", () => {
    const messages = channel.parse(page(textEvent("m1", "one"), textEvent("m2", "two")));
    assert.deepEqual(messages.map((m) => m.messageId), ["m1", "m2"]);
  });

  it("skips the page's own echoed messages, so the bot does not answer itself", () => {
    assert.deepEqual(channel.parse(page(textEvent("m1", "hi", { is_echo: true }))), []);
  });

  it("skips events without text, such as attachments and read receipts", () => {
    const attachment = { sender: { id: "u" }, message: { mid: "m1", attachments: [{ type: "image" }] } };
    const read = { sender: { id: "u" }, read: { watermark: 1 } };
    assert.deepEqual(channel.parse(page(attachment, read)), []);
  });

  it("ignores payloads that are not page events", () => {
    assert.deepEqual(channel.parse(JSON.stringify({ object: "instagram", entry: [] })), []);
  });

  it("throws on invalid JSON so the server can answer 400", () => {
    assert.throws(() => channel.parse("{not json"));
  });
});
