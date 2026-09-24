import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_AI_MODEL, loadConfig } from "../src/config.js";

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
    assert.throws(() => loadConfig({ ZALO_APP_ID: "a" }), /ZALO_OA_SECRET_KEY, ZALO_OA_ACCESS_TOKEN/);
  });

  it("rejects an invalid port", () => {
    assert.throws(() => loadConfig({ ...zalo, PORT: "99999" }), /PORT/);
    assert.throws(() => loadConfig({ ...zalo, PORT: "abc" }), /PORT/);
  });

  it("uses sensible defaults", () => {
    const config = loadConfig(zalo);
    assert.equal(config.port, 3000);
    assert.equal(config.databasePath, "./data/bot.db");
    assert.equal(config.timeZone, "Asia/Ho_Chi_Minh");
    assert.equal(config.admin, undefined);
    assert.equal(config.ai, undefined);
    assert.equal(config.forward, undefined);
  });

  it("enables the dashboard with ADMIN_PASSWORD and refuses a short one", () => {
    assert.ok(loadConfig({ ...zalo, ADMIN_PASSWORD: "a-long-enough-password" }).admin);
    assert.throws(() => loadConfig({ ...zalo, ADMIN_PASSWORD: "short" }), /ADMIN_PASSWORD/);
  });

  it("marks the session cookie Secure in production unless turned off", () => {
    const base = { ...zalo, ADMIN_PASSWORD: "a-long-enough-password" };
    assert.equal(loadConfig(base).admin?.secureCookies, false);
    assert.equal(loadConfig({ ...base, NODE_ENV: "production" }).admin?.secureCookies, true);
    assert.equal(loadConfig({ ...base, NODE_ENV: "production", COOKIE_SECURE: "false" }).admin?.secureCookies, false);
  });

  it("enables AI with an API key, using the default model and low effort", () => {
    const config = loadConfig({ ...zalo, ANTHROPIC_API_KEY: "sk-ant-test" });
    assert.deepEqual(config.ai, { apiKey: "sk-ant-test", model: DEFAULT_AI_MODEL, effort: "low" });
    assert.equal(loadConfig({ ...zalo, ANTHROPIC_API_KEY: "k", AI_MODEL: "claude-sonnet-5" }).ai?.model, "claude-sonnet-5");
  });

  it("rejects an unknown AI effort and an invalid time zone", () => {
    assert.throws(() => loadConfig({ ...zalo, AI_EFFORT: "turbo" }), /AI_EFFORT/);
    assert.throws(() => loadConfig({ ...zalo, TIMEZONE: "Mars/Olympus" }), /TIMEZONE/);
  });

  it("enables forwarding with FORWARD_URL and rejects other schemes", () => {
    assert.deepEqual(loadConfig({ ...zalo, FORWARD_URL: "https://n8n.example.com/webhook/bot" }).forward, {
      url: "https://n8n.example.com/webhook/bot",
    });
    assert.throws(() => loadConfig({ ...zalo, FORWARD_URL: "ftp://example.com" }), /FORWARD_URL/);
  });
});
