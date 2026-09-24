import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ZaloChannel } from "../src/channels/zalo.js";
import { sha256 } from "../src/security/signature.js";

const config = { appId: "app-1", oaSecretKey: "oa-secret", accessToken: "token" };
const channel = new ZaloChannel(config);

function textEvent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    app_id: "app-1",
    event_name: "user_send_text",
    sender: { id: "zalo-user-1" },
    recipient: { id: "oa-1" },
    message: { msg_id: "z1", text: "Giá bao nhiêu?" },
    timestamp: "1727150000000",
    ...overrides,
  });
}

function sign(body: string, timestamp: string) {
  return { "x-zevent-signature": `mac=${sha256(config.appId + body + timestamp + config.oaSecretKey)}` };
}

describe("ZaloChannel.verify", () => {
  it("accepts a delivery signed with the OA secret", () => {
    const body = textEvent();
    assert.equal(channel.verify({ body, headers: sign(body, "1727150000000") }), true);
  });

  it("accepts a numeric timestamp in the body", () => {
    const body = textEvent({ timestamp: 1727150000000 });
    assert.equal(channel.verify({ body, headers: sign(body, "1727150000000") }), true);
  });

  it("rejects a delivery whose body was changed", () => {
    const body = textEvent();
    const headers = sign(body, "1727150000000");
    assert.equal(channel.verify({ body: body.replace("Giá", "Free"), headers }), false);
  });

  it("rejects a body that is not JSON instead of throwing", () => {
    assert.equal(channel.verify({ body: "{oops", headers: {} }), false);
  });
});

describe("ZaloChannel.parse", () => {
  it("reads a text message", () => {
    const [message] = channel.parse(textEvent());
    assert.ok(message);
    assert.equal(message.channel, "zalo");
    assert.equal(message.messageId, "z1");
    assert.equal(message.senderId, "zalo-user-1");
    assert.equal(message.text, "Giá bao nhiêu?");
    assert.equal(message.receivedAt.getTime(), 1727150000000);
  });

  it("ignores events that are not text messages", () => {
    assert.deepEqual(channel.parse(textEvent({ event_name: "follow" })), []);
    assert.deepEqual(channel.parse(textEvent({ event_name: "user_send_image" })), []);
  });

  it("has no handshake", () => {
    assert.equal(channel.handshake(), null);
  });
});
