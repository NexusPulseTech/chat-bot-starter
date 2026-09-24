import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { MessengerChannel } from "../src/channels/messenger.js";
import type { InboundMessage, OutboundMessage } from "../src/channels/types.js";
import { DedupeStore } from "../src/dedupe.js";
import { createApp, type App } from "../src/server.js";
import { hmacSha256 } from "../src/security/signature.js";

const SECRET = "test-app-secret";

/** A real Messenger adapter whose send() records calls instead of calling Meta. */
class RecordingMessenger extends MessengerChannel {
  readonly sent: { to: string; text: string }[] = [];

  override async send(recipientId: string, message: OutboundMessage): Promise<void> {
    this.sent.push({ to: recipientId, text: message.text });
  }
}

function delivery(mid: string, text: string): string {
  return JSON.stringify({
    object: "page",
    entry: [{ id: "p", time: 1, messaging: [{ sender: { id: "user-9" }, recipient: { id: "p" }, timestamp: 1, message: { mid, text } }] }],
  });
}

describe("HTTP server", () => {
  let app: App;
  let base: string;
  let channel: RecordingMessenger;
  let handled: InboundMessage[];
  const dedupe = new DedupeStore();

  before(async () => {
    channel = new RecordingMessenger({ appSecret: SECRET, pageAccessToken: "t", verifyToken: "verify-me" });
    app = createApp({
      channels: [channel],
      dedupe,
      handler: (message) => {
        handled.push(message);
        return { text: `You said: ${message.text}` };
      },
    });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  after(() => new Promise<void>((resolve) => app.server.close(() => resolve())));

  beforeEach(() => {
    handled = [];
    channel.sent.length = 0;
    dedupe.clear();
  });

  function post(body: string, signed = true): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (signed) headers["x-hub-signature-256"] = `sha256=${hmacSha256(SECRET, body)}`;
    return fetch(`${base}/webhook/messenger`, { method: "POST", headers, body });
  }

  it("answers the health check", async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  it("returns 404 for an unknown channel", async () => {
    assert.equal((await fetch(`${base}/webhook/telegram`, { method: "POST", body: "{}" })).status, 404);
  });

  it("completes the Messenger subscription handshake", async () => {
    const res = await fetch(`${base}/webhook/messenger?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "abc");
  });

  it("rejects an unsigned delivery with 401 and does not run the handler", async () => {
    const res = await post(delivery("m1", "hi"), false);
    assert.equal(res.status, 401);
    await app.idle();
    assert.equal(handled.length, 0);
  });

  it("rejects a delivery whose body was changed after signing", async () => {
    const body = delivery("m1", "hi");
    const res = await fetch(`${base}/webhook/messenger`, {
      method: "POST",
      headers: { "x-hub-signature-256": `sha256=${hmacSha256(SECRET, body)}` },
      body: body.replace("hi", "transfer all funds"),
    });
    assert.equal(res.status, 401);
  });

  it("acknowledges a valid delivery, runs the handler and sends the reply", async () => {
    const res = await post(delivery("m1", "Xin chào"));
    assert.equal(res.status, 200);
    await app.idle();
    assert.equal(handled.length, 1);
    assert.deepEqual(channel.sent, [{ to: "user-9", text: "You said: Xin chào" }]);
  });

  it("replies once when the provider redelivers the same message", async () => {
    const body = delivery("m-dup", "hello");
    const responses = await Promise.all([post(body), post(body), post(body)]);
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 200]);
    await app.idle();
    assert.equal(handled.length, 1);
    assert.equal(channel.sent.length, 1);
  });

  it("returns 400 for a signed body that is not JSON", async () => {
    assert.equal((await post("{not json")).status, 400);
  });

  it("refuses a body over 1 MB with 413", async () => {
    const res = await fetch(`${base}/webhook/messenger`, { method: "POST", body: "x".repeat(1024 * 1024 + 1) });
    assert.equal(res.status, 413);
  });

  it("returns 405 for other methods", async () => {
    assert.equal((await fetch(`${base}/webhook/messenger`, { method: "PUT", body: "{}" })).status, 405);
  });
});
