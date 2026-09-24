import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { buildRuntime, type Runtime } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { hmacSha256 } from "../src/security/signature.js";
import { RecordingMessenger } from "./helpers.js";

const SECRET = "test-app-secret";

function delivery(mid: string, text: string): string {
  return JSON.stringify({
    object: "page",
    entry: [{ id: "p", time: 1, messaging: [{ sender: { id: "user-9" }, recipient: { id: "p" }, timestamp: 1, message: { mid, text } }] }],
  });
}

describe("webhook server", () => {
  let runtime: Runtime;
  let base: string;
  const channel = new RecordingMessenger(SECRET);

  before(async () => {
    const config = { ...loadConfig({ ZALO_APP_ID: "a", ZALO_OA_SECRET_KEY: "k", ZALO_OA_ACCESS_TOKEN: "t" }), channels: [channel] };
    runtime = buildRuntime(config, { db: openDatabase(":memory:") });
    await new Promise<void>((resolve) => runtime.app.server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(runtime.app.server.address() as AddressInfo).port}`;
  });

  after(() => new Promise<void>((resolve) => runtime.app.server.close(() => resolve())));

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

  it("returns 404 for an unknown channel, and for /admin when the dashboard is off", async () => {
    assert.equal((await fetch(`${base}/webhook/telegram`, { method: "POST", body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/admin`)).status, 404);
  });

  it("completes the Messenger subscription handshake", async () => {
    const res = await fetch(`${base}/webhook/messenger?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "abc");
  });

  it("rejects an unsigned delivery with 401 and stores nothing", async () => {
    assert.equal((await post(delivery("m-unsigned", "hi"), false)).status, 401);
    await runtime.app.idle();
    assert.equal(runtime.store.listConversations().length, 0);
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

  it("acknowledges a valid delivery, stores it and replies", async () => {
    const before = channel.sent.length;
    assert.equal((await post(delivery("m-valid", "Shop mở cửa mấy giờ?"))).status, 200);
    await runtime.app.idle();
    assert.equal(channel.sent.length, before + 1);
    assert.match(channel.sent.at(-1)?.text ?? "", /8:00/);
  });

  it("replies once when the provider redelivers the same message", async () => {
    const before = channel.sent.length;
    const body = delivery("m-dup", "hello");
    const responses = await Promise.all([post(body), post(body), post(body)]);
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 200]);
    await runtime.app.idle();
    assert.equal(channel.sent.length, before + 1);
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
