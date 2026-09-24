import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Engine } from "../src/bot/engine.js";
import { Inbox } from "../src/bot/inbox.js";
import { HANDOFF_REPLY } from "../src/bot/engine.js";
import { PROMPTS } from "../src/bot/order-flow.js";
import { DEFAULT_RULES, FALLBACK_REPLY } from "../src/handlers/rules.js";
import { memoryStore, RecordingZalo, zaloMessage } from "./helpers.js";

function setup() {
  const store = memoryStore();
  const zalo = new RecordingZalo();
  const engine = new Engine({
    rules: DEFAULT_RULES,
    fallback: FALLBACK_REPLY,
    settings: () => ({ aiEnabled: false, knowledge: "" }),
  });
  const inbox = new Inbox({ store, engine, channels: [zalo] });
  return { store, zalo, inbox };
}

describe("Inbox", () => {
  it("stores the message, replies through the channel and stores the reply", async () => {
    const { store, zalo, inbox } = setup();
    assert.equal(await inbox.receive(zaloMessage("Shop mở cửa mấy giờ?")), true);

    assert.equal(zalo.sent.length, 1);
    assert.match(zalo.sent[0]?.text ?? "", /8:00/);
    const [conversation] = store.listConversations();
    assert.ok(conversation);
    assert.deepEqual(
      store.listMessages(conversation.id).map((m) => [m.author, m.status]),
      [["customer", "received"], ["bot", "sent"]],
    );
  });

  it("ignores a redelivered message", async () => {
    const { zalo, inbox } = setup();
    const message = zaloMessage("hi");
    assert.equal(await inbox.receive(message), true);
    assert.equal(await inbox.receive(message), false);
    assert.equal(zalo.sent.length, 1);
  });

  it("takes a whole order over several messages and stores it", async () => {
    const { store, zalo, inbox } = setup();
    for (const text of ["đặt hàng", "2 áo thun", "Nguyễn Lan", "0912345678", "12 Lê Lợi, Quận 1, TP.HCM", "có"]) {
      await inbox.receive(zaloMessage(text));
    }
    const [order] = store.listOrders();
    assert.ok(order);
    assert.equal(order.items, "2 áo thun");
    assert.equal(order.phone, "0912345678");
    assert.match(zalo.sent.at(-1)?.text ?? "", new RegExp(`#${order.id}`));
    assert.equal(store.listConversations()[0]?.flow, null);
  });

  it("handles quick consecutive messages from one customer in order", async () => {
    const { store, inbox } = setup();
    await inbox.receive(zaloMessage("đặt hàng"));
    // Sent without waiting, like a customer typing fast.
    await Promise.all([
      inbox.receive(zaloMessage("1 túi xách")),
      inbox.receive(zaloMessage("Lan")),
      inbox.receive(zaloMessage("0912345678")),
    ]);
    const flow = JSON.parse(store.listConversations()[0]?.flow ?? "null");
    assert.equal(flow.step, "address");
    assert.equal(flow.items, "1 túi xách");
    assert.equal(flow.customerName, "Lan");
  });

  it("stops the bot after a hand-over request, until a person hands back", async () => {
    const { store, zalo, inbox } = setup();
    await inbox.receive(zaloMessage("gặp nhân viên"));
    assert.equal(zalo.sent.at(-1)?.text, HANDOFF_REPLY);

    await inbox.receive(zaloMessage("alo alo"));
    assert.equal(zalo.sent.length, 1, "the bot must stay silent in human mode");

    const [conversation] = store.listConversations();
    assert.ok(conversation);
    store.setMode(conversation.id, "bot");
    await inbox.receive(zaloMessage("đặt hàng"));
    assert.equal(zalo.sent.at(-1)?.text, PROMPTS.start);
  });

  it("sends a staff reply, switches the conversation to human mode and marks it read", async () => {
    const { store, zalo, inbox } = setup();
    await inbox.receive(zaloMessage("hi"));
    const [conversation] = store.listConversations();
    assert.ok(conversation);

    const sent = await inbox.sendAgentReply(conversation.id, "Chào bạn, mình là Lan");
    assert.equal(sent.status, "sent");
    assert.equal(zalo.sent.at(-1)?.text, "Chào bạn, mình là Lan");
    const updated = store.getConversation(conversation.id);
    assert.equal(updated?.mode, "human");
    assert.equal(updated?.unread, 0);
  });

  it("records a failed send with the provider's error instead of losing it", async () => {
    const { store, zalo, inbox } = setup();
    await inbox.receive(zaloMessage("hi"));
    const [conversation] = store.listConversations();
    assert.ok(conversation);

    zalo.failNext = true;
    const sent = await inbox.sendAgentReply(conversation.id, "Alo");
    assert.equal(sent.status, "failed");
    assert.match(sent.error ?? "", /-230/);
  });
});
