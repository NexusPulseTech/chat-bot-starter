import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";

const messenger = {
  MESSENGER_APP_SECRET: "s",
  MESSENGER_PAGE_ACCESS_TOKEN: "t",
  MESSENGER_VERIFY_TOKEN: "v",
};
const zalo = { ZALO_APP_ID: "a", ZALO_OA_SECRET_KEY: "k", ZALO_OA_ACCESS_TOKEN: "t" };

describe("loadConfig", () => {
  it("refuses to start with no channel", () => {
    assert.throws(() => loadConfig({}), /No channel configured/);
  });

  it("enables only the channels that are configured", () => {
    assert.deepEqual(loadConfig(zalo).channels.map((c) => c.id), ["zalo"]);
    assert.deepEqual(loadConfig({ ...messenger, ...zalo }).channels.map((c) => c.id), ["messenger", "zalo"]);
  });

  it("names every missing variable of a half-configured channel", () => {
    assert.throws(
      () => loadConfig({ ZALO_APP_ID: "a" }),
      /ZALO_OA_SECRET_KEY, ZALO_OA_ACCESS_TOKEN/,
    );
  });

  it("rejects an invalid port", () => {
    assert.throws(() => loadConfig({ ...zalo, PORT: "99999" }), /PORT/);
    assert.throws(() => loadConfig({ ...zalo, PORT: "abc" }), /PORT/);
  });

  it("uses the rules handler by default and the forward handler with FORWARD_URL", () => {
    assert.equal(loadConfig(zalo).handlerName, "rules");
    assert.equal(loadConfig({ ...zalo, FORWARD_URL: "https://n8n.example.com/webhook/bot" }).handlerName, "forward");
  });

  it("rejects a FORWARD_URL that is not http or https", () => {
    assert.throws(() => loadConfig({ ...zalo, FORWARD_URL: "ftp://example.com" }), /FORWARD_URL/);
  });

  it("defaults to port 3000", () => {
    assert.equal(loadConfig(zalo).port, 3000);
  });
});
