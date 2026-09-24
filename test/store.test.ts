import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { InboundMessage } from "../src/channels/types.js";
import { openDatabase } from "../src/db/database.js";
import { Store } from "../src/db/store.js";

function inbound(messageId: string, text = "hi", senderId = "user-1"): InboundMessage {
  return { channel: "zalo", messageId, senderId, text, receivedAt: new Date(0) };
}

function freshStore(): Store {
  let tick = 0;
  // A clock that moves forward on every call keeps ordering deterministic.
  return new Store(openDatabase(":memory:"), () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)));
}

describe("Store", () => {
  it("creates a contact and conversation on first contact", () => {
    const store = freshStore();
    const conversation = store.recordInbound(inbound("m1", "Xin chào"));
    assert.ok(conversation);
    assert.equal(conversation.channel, "zalo");
    assert.equal(conversation.externalId, "user-1");
    assert.equal(conversation.mode, "bot");
    assert.equal(conversation.unread, 1);
    assert.deepEqual(store.listMessages(conversation.id).map((m) => m.text), ["Xin chào"]);
  });

  it("returns null for a redelivered message and stores it once", () => {
    const store = freshStore();
    const first = store.recordInbound(inbound("m1"));
    assert.ok(first);
    assert.equal(store.recordInbound(inbound("m1")), null);
    assert.equal(store.listMessages(first.id).length, 1);
    assert.equal(store.getConversation(first.id)?.unread, 1);
  });

  it("treats the same provider id on another channel as a different message", () => {
    const store = freshStore();
    assert.ok(store.recordInbound(inbound("42")));
    assert.ok(store.recordInbound({ ...inbound("42"), channel: "messenger" }));
  });

  it("keeps one conversation per customer", () => {
    const store = freshStore();
    const a = store.recordInbound(inbound("m1"));
    const b = store.recordInbound(inbound("m2"));
    assert.equal(a?.id, b?.id);
    assert.equal(store.getConversation(a?.id ?? 0)?.unread, 2);
  });

  it("records outbound messages, including failed sends", () => {
    const store = freshStore();
    const conversation = store.recordInbound(inbound("m1"));
    assert.ok(conversation);
    store.recordOutbound(conversation.id, "bot", "Chào bạn", { status: "sent" });
    const failed = store.recordOutbound(conversation.id, "agent", "Alo", { status: "failed", error: "window closed" });
    assert.equal(failed.status, "failed");
    assert.equal(failed.error, "window closed");
    assert.deepEqual(
      store.listMessages(conversation.id).map((m) => [m.author, m.text]),
      [["customer", "hi"], ["bot", "Chào bạn"], ["agent", "Alo"]],
    );
  });

  it("returns only messages newer than afterId", () => {
    const store = freshStore();
    const conversation = store.recordInbound(inbound("m1"));
    assert.ok(conversation);
    const bot = store.recordOutbound(conversation.id, "bot", "one", { status: "sent" });
    store.recordOutbound(conversation.id, "bot", "two", { status: "sent" });
    assert.deepEqual(store.listMessages(conversation.id, { afterId: bot.id }).map((m) => m.text), ["two"]);
  });

  it("lists conversations newest first with their last message, and filters by mode", () => {
    const store = freshStore();
    const older = store.recordInbound(inbound("m1", "first", "alice"));
    const newer = store.recordInbound(inbound("m2", "second", "bob"));
    assert.ok(older && newer);
    store.setMode(older.id, "human");

    const all = store.listConversations();
    assert.deepEqual(all.map((c) => [c.externalId, c.lastText]), [["bob", "second"], ["alice", "first"]]);
    assert.deepEqual(store.listConversations({ mode: "human" }).map((c) => c.externalId), ["alice"]);
  });

  it("stores and updates orders", () => {
    const store = freshStore();
    const conversation = store.recordInbound(inbound("m1"));
    assert.ok(conversation);
    const order = store.createOrder(conversation.id, {
      items: "2 áo thun",
      customerName: "Lan",
      phone: "0912345678",
      address: "12 Lê Lợi, Q1",
    });
    assert.equal(order.status, "new");
    assert.equal(order.channel, "zalo");
    assert.equal(store.setOrderStatus(order.id, "shipped"), true);
    assert.equal(store.getOrder(order.id)?.status, "shipped");
    assert.equal(store.setOrderStatus(999, "shipped"), false);
    assert.deepEqual(store.listOrders({ status: "shipped" }).map((o) => o.id), [order.id]);
    assert.deepEqual(store.listOrders({ status: "new" }), []);
  });

  it("counts what needs attention", () => {
    const store = freshStore();
    const conversation = store.recordInbound(inbound("m1"));
    assert.ok(conversation);
    store.setMode(conversation.id, "human");
    store.createOrder(conversation.id, { items: "x", customerName: "a", phone: "0912345678", address: "addr" });
    assert.deepEqual(store.counts(), { waitingForAgent: 1, newOrders: 1, unread: 1 });
    store.markRead(conversation.id);
    assert.equal(store.counts().unread, 0);
  });

  it("stores settings and overwrites them", () => {
    const store = freshStore();
    assert.equal(store.getSetting("knowledge"), undefined);
    store.setSetting("knowledge", "v1");
    store.setSetting("knowledge", "v2");
    assert.equal(store.getSetting("knowledge"), "v2");
  });

  it("returns a session only until it expires", () => {
    const store = freshStore();
    store.createSession("hash", "csrf", 1_000);
    assert.equal(store.getSession("hash", 999)?.csrfToken, "csrf");
    assert.equal(store.getSession("hash", 1_000), undefined);
    store.deleteExpiredSessions(2_000);
    assert.equal(store.getSession("hash", 0), undefined);
  });

  it("keeps data in a file across restarts and ignores redeliveries after a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "bot-db-"));
    try {
      const path = join(dir, "nested", "bot.db");
      const first = new Store(openDatabase(path));
      const conversation = first.recordInbound(inbound("m1"));
      assert.ok(conversation);

      const second = new Store(openDatabase(path));
      assert.equal(second.recordInbound(inbound("m1")), null);
      assert.equal(second.listMessages(conversation.id).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
