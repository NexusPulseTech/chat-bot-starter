import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiResponder } from "../src/ai/claude.js";
import { Engine, HANDOFF_REPLY, type EngineOptions } from "../src/bot/engine.js";
import { PROMPTS } from "../src/bot/order-flow.js";
import type { Conversation } from "../src/db/store.js";
import { DEFAULT_RULES, FALLBACK_REPLY } from "../src/handlers/rules.js";
import { zaloMessage } from "./helpers.js";

const conversation: Conversation = {
  id: 1,
  channel: "zalo",
  externalId: "customer-1",
  displayName: null,
  mode: "bot",
  flow: null,
  unread: 0,
  lastMessageAt: "2026-01-01T00:00:00.000Z",
};

function engine(overrides: Partial<EngineOptions> = {}) {
  return new Engine({
    rules: DEFAULT_RULES,
    fallback: FALLBACK_REPLY,
    settings: () => ({ aiEnabled: false, knowledge: "" }),
    ...overrides,
  });
}

function decide(e: Engine, text: string, conv: Conversation = conversation) {
  return e.decide({ conversation: conv, message: zaloMessage(text), history: [] });
}

const fixedAi = (reply: string | null): AiResponder => ({ reply: async () => reply });

describe("Engine", () => {
  it("stays silent once a person has taken over", async () => {
    const decision = await decide(engine(), "Giá bao nhiêu?", { ...conversation, mode: "human" });
    assert.deepEqual(decision, { source: "human-mode", reply: null });
  });

  it("hands over to a person when asked, with or without accents", async () => {
    for (const text of ["Cho mình gặp nhân viên", "gap nhan vien", "tư vấn viên đâu"]) {
      const decision = await decide(engine(), text);
      assert.equal(decision.mode, "human", text);
      assert.equal(decision.reply, HANDOFF_REPLY);
    }
  });

  it("starts the order flow on an order intent", async () => {
    const decision = await decide(engine(), "Mình muốn đặt hàng");
    assert.equal(decision.source, "order-flow");
    assert.equal(decision.reply, PROMPTS.start);
    assert.equal(JSON.parse(decision.flow ?? "null").step, "items");
  });

  it("continues an order in progress before anything else", async () => {
    const inFlow = { ...conversation, flow: JSON.stringify({ step: "items" }) };
    const decision = await decide(engine({ ai: fixedAi("should not be used") }), "2 áo thun", inFlow);
    assert.equal(decision.source, "order-flow");
    assert.equal(decision.reply, PROMPTS.name);
  });

  it("answers from keyword rules when AI is off", async () => {
    const decision = await decide(engine(), "Shop mở cửa mấy giờ?");
    assert.equal(decision.source, "rule");
    assert.match(decision.reply ?? "", /8:00/);
  });

  it("answers with AI when it is on, instead of the generic rules", async () => {
    const e = engine({ ai: fixedAi("Dạ áo 150.000đ ạ"), settings: () => ({ aiEnabled: true, knowledge: "Áo 150k" }) });
    assert.deepEqual(await decide(e, "Giá áo bao nhiêu?"), { source: "ai", reply: "Dạ áo 150.000đ ạ" });
  });

  it("does not use AI when it is switched off in settings", async () => {
    const e = engine({ ai: fixedAi("AI"), settings: () => ({ aiEnabled: false, knowledge: "" }) });
    assert.equal((await decide(e, "Giá áo?")).source, "rule");
  });

  it("falls back when AI declines or fails", async () => {
    const declined = engine({ ai: fixedAi(null), settings: () => ({ aiEnabled: true, knowledge: "" }) });
    assert.deepEqual(await decide(declined, "xyz"), { source: "fallback", reply: FALLBACK_REPLY });

    const failing = engine({
      ai: { reply: async () => Promise.reject(new Error("529 overloaded")) },
      settings: () => ({ aiEnabled: true, knowledge: "" }),
    });
    assert.deepEqual(await decide(failing, "xyz"), { source: "fallback", reply: FALLBACK_REPLY });
  });

  it("lets an external workflow answer when forwarding is configured", async () => {
    const e = engine({ forward: async () => ({ text: "from n8n" }) });
    assert.deepEqual(await decide(e, "xyz"), { source: "forward", reply: "from n8n" });
  });

  it("still handles ordering and hand-over itself when forwarding", async () => {
    const e = engine({ forward: async () => ({ text: "from n8n" }) });
    assert.equal((await decide(e, "đặt hàng")).source, "order-flow");
    assert.equal((await decide(e, "gặp nhân viên")).source, "handoff");
  });

  it("uses the fallback when no rule matches", async () => {
    assert.deepEqual(await decide(engine(), "xyz"), { source: "fallback", reply: FALLBACK_REPLY });
  });
});
