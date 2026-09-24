import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InboundMessage } from "../src/channels/types.js";
import { createRulesHandler, FALLBACK_REPLY, normalize } from "../src/handlers/rules.js";

function message(text: string): InboundMessage {
  return { channel: "zalo", messageId: "1", senderId: "u", text, receivedAt: new Date(0) };
}

describe("normalize", () => {
  it("removes Vietnamese diacritics and lowercases", () => {
    assert.equal(normalize("Giá Bao Nhiêu"), "gia bao nhieu");
    assert.equal(normalize("ĐẶT HÀNG"), "dat hang");
    assert.equal(normalize("  Giờ mở cửa  "), "gio mo cua");
  });
});

describe("createRulesHandler", () => {
  const handler = createRulesHandler();

  it("matches with or without accents", async () => {
    const withAccents = await handler(message("Giá bao nhiêu vậy shop?"));
    const withoutAccents = await handler(message("gia bao nhieu vay shop"));
    assert.ok(withAccents);
    assert.deepEqual(withAccents, withoutAccents);
    assert.match(withAccents.text, /báo giá/);
  });

  it("answers with the fallback when no rule matches", async () => {
    assert.deepEqual(await handler(message("xyz")), { text: FALLBACK_REPLY });
  });

  it("uses custom rules in order", async () => {
    const custom = createRulesHandler([{ pattern: /ship/, reply: "Freeship toàn quốc" }], "fallback");
    assert.deepEqual(await custom(message("Có ship không?")), { text: "Freeship toàn quốc" });
  });
});
