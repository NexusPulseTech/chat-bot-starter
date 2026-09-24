import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hmacSha256,
  safeEqualHex,
  sha256,
  verifyMessengerSignature,
  verifyZaloSignature,
} from "../src/security/signature.js";

describe("safeEqualHex", () => {
  it("accepts identical digests", () => {
    assert.equal(safeEqualHex("abcd01", "abcd01"), true);
  });

  it("rejects digests that differ in one byte", () => {
    assert.equal(safeEqualHex("abcd01", "abcd02"), false);
  });

  it("rejects digests of different lengths instead of throwing", () => {
    assert.equal(safeEqualHex("abcd", "abcd01"), false);
  });

  it("rejects empty and non-hex input", () => {
    assert.equal(safeEqualHex("", ""), false);
    assert.equal(safeEqualHex("zz", "zz"), false);
  });
});

describe("verifyMessengerSignature", () => {
  const secret = "app-secret";
  const body = '{"object":"page","entry":[]}';
  const header = `sha256=${hmacSha256(secret, body)}`;

  it("accepts a correctly signed body", () => {
    assert.equal(verifyMessengerSignature(secret, body, header), true);
  });

  it("rejects a body changed after signing", () => {
    assert.equal(verifyMessengerSignature(secret, body.replace("page", "user"), header), false);
  });

  it("rejects a signature made with another secret", () => {
    assert.equal(verifyMessengerSignature("other-secret", body, header), false);
  });

  it("rejects a missing header", () => {
    assert.equal(verifyMessengerSignature(secret, body, undefined), false);
  });

  it("rejects the legacy sha1 header format", () => {
    assert.equal(verifyMessengerSignature(secret, body, header.replace("sha256=", "sha1=")), false);
  });

  it("is sensitive to whitespace, so the raw body must be used", () => {
    const reformatted = JSON.stringify(JSON.parse(body), null, 2);
    assert.equal(verifyMessengerSignature(secret, reformatted, header), false);
  });
});

describe("verifyZaloSignature", () => {
  const appId = "1234567890";
  const secret = "oa-secret";
  const timestamp = "1727150000000";
  const body = `{"event_name":"user_send_text","timestamp":"${timestamp}"}`;
  const header = `mac=${sha256(appId + body + timestamp + secret)}`;

  it("accepts a correctly signed body", () => {
    assert.equal(verifyZaloSignature(appId, secret, body, timestamp, header), true);
  });

  it("rejects a body changed after signing", () => {
    assert.equal(verifyZaloSignature(appId, secret, body.replace("text", "image"), timestamp, header), false);
  });

  it("rejects a different timestamp", () => {
    assert.equal(verifyZaloSignature(appId, secret, body, "1727150000001", header), false);
  });

  it("rejects a different app id", () => {
    assert.equal(verifyZaloSignature("999", secret, body, timestamp, header), false);
  });

  it("rejects a missing header or timestamp", () => {
    assert.equal(verifyZaloSignature(appId, secret, body, timestamp, undefined), false);
    assert.equal(verifyZaloSignature(appId, secret, body, "", header), false);
  });

  it("rejects a header without the mac label", () => {
    assert.equal(verifyZaloSignature(appId, secret, body, timestamp, header.slice(4)), false);
  });
});
