import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, ClaudeResponder, toApiMessages, type MessagesClient } from "../src/ai/claude.js";
import type { MessageAuthor, StoredMessage } from "../src/db/store.js";

let nextId = 1;
function message(author: MessageAuthor, text: string, status: StoredMessage["status"] = "sent"): StoredMessage {
  return {
    id: nextId++,
    conversationId: 1,
    direction: author === "customer" ? "in" : "out",
    author,
    text,
    status,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A fake SDK client that records the request and returns a canned response. */
function fakeClient(response: Partial<Anthropic.Beta.BetaMessage>) {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        async create(params) {
          calls.push(params);
          return { stop_reason: "end_turn", content: [], ...response } as Anthropic.Beta.BetaMessage;
        },
      },
    },
  };
  return { client, calls };
}

describe("toApiMessages", () => {
  it("maps the customer to user and the bot and staff to assistant", () => {
    const turns = toApiMessages([message("customer", "Giá?"), message("bot", "Dạ 100k"), message("agent", "Còn hàng")]);
    assert.deepEqual(turns.map((t) => t.role), ["user", "assistant", "assistant"]);
  });

  it("drops leading assistant turns so the conversation starts with the user", () => {
    const turns = toApiMessages([message("agent", "Chào bạn"), message("customer", "Hi")]);
    assert.deepEqual(turns, [{ role: "user", content: "Hi" }]);
  });

  it("drops messages that failed to send, which the customer never saw", () => {
    const turns = toApiMessages([message("customer", "Hi"), message("bot", "lost", "failed"), message("customer", "Alo")]);
    assert.deepEqual(turns.map((t) => t.content), ["Hi", "Alo"]);
  });
});

describe("buildSystemPrompt", () => {
  it("puts the business information at the end, inside tags", () => {
    const prompt = buildSystemPrompt("Áo thun 150.000đ");
    assert.ok(prompt.trimEnd().endsWith("</business_information>"));
    assert.match(prompt, /<business_information>\nÁo thun 150.000đ\n<\/business_information>/);
  });

  it("is identical for identical knowledge, so the prompt cache can hit", () => {
    assert.equal(buildSystemPrompt("x"), buildSystemPrompt("x"));
  });
});

describe("ClaudeResponder", () => {
  it("sends the model, effort, fallback opt-in, cached system prompt and history", async () => {
    const { client, calls } = fakeClient({ content: [{ type: "text", text: "Dạ, áo giá 150.000đ ạ.", citations: null }] });
    const responder = new ClaudeResponder({ client, model: "claude-opus-5", effort: "low" });

    const reply = await responder.reply({ knowledge: "Áo 150k", history: [message("customer", "Áo bao nhiêu?")] });

    assert.equal(reply, "Dạ, áo giá 150.000đ ạ.");
    const [params] = calls;
    assert.ok(params);
    assert.equal(params.model, "claude-opus-5");
    assert.deepEqual(params.output_config, { effort: "low" });
    assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(params.fallbacks, "default");
    assert.ok(Array.isArray(params.system));
    assert.deepEqual(params.system[0]?.cache_control, { type: "ephemeral" });
    assert.deepEqual(params.messages, [{ role: "user", content: "Áo bao nhiêu?" }]);
  });

  it("returns null when the model refuses, so the fallback reply is used", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", content: [] });
    const responder = new ClaudeResponder({ client, model: "claude-opus-5", effort: "low" });
    assert.equal(await responder.reply({ knowledge: "", history: [message("customer", "Hi")] }), null);
  });

  it("does not call the API when the last message is not from the customer", async () => {
    const { client, calls } = fakeClient({});
    const responder = new ClaudeResponder({ client, model: "claude-opus-5", effort: "low" });
    assert.equal(await responder.reply({ knowledge: "", history: [message("customer", "Hi"), message("bot", "Chào")] }), null);
    assert.equal(calls.length, 0);
  });

  it("sends only the most recent messages", async () => {
    const { client, calls } = fakeClient({ content: [{ type: "text", text: "ok", citations: null }] });
    const responder = new ClaudeResponder({ client, model: "m", effort: "low", historyLimit: 2 });
    await responder.reply({
      knowledge: "",
      history: [message("customer", "1"), message("bot", "2"), message("customer", "3")],
    });
    assert.deepEqual(calls[0]?.messages.map((m) => m.content), ["3"]);
  });
});
