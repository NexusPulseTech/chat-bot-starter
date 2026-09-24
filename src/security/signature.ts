import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * Compares two hex digests without leaking, through response time, how many
 * leading characters matched. A plain `===` on secrets returns early at the
 * first differing byte, which is enough to recover a signature byte by byte.
 */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");

  // timingSafeEqual throws on a length mismatch, so the lengths are compared
  // first. Length is not secret: it is fixed by the hash algorithm.
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** HMAC-SHA256 of `payload` keyed with `secret`, as a lowercase hex digest. */
export function hmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** SHA-256 of `payload`, as a lowercase hex digest. */
export function sha256(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Verifies a Facebook Messenger webhook delivery.
 *
 * Messenger sends `X-Hub-Signature-256: sha256=<hex>`, where the digest is
 * HMAC-SHA256 of the raw request body keyed with the app secret. The body must
 * be the exact bytes received: re-serialising the parsed JSON changes key order
 * and whitespace, and the digest no longer matches.
 *
 * @see https://developers.facebook.com/docs/messenger-platform/webhooks
 */
export function verifyMessengerSignature(
  appSecret: string,
  rawBody: string,
  header: string | undefined,
): boolean {
  if (!header) return false;

  const [algorithm, digest] = header.split("=", 2);
  if (algorithm !== "sha256" || !digest) return false;

  return safeEqualHex(digest, hmacSha256(appSecret, rawBody));
}

/**
 * Verifies a Zalo Official Account webhook delivery.
 *
 * Zalo sends `X-ZEvent-Signature: mac=<hex>`, where the digest is
 * SHA-256 over `appId + rawBody + timestamp + oaSecretKey` concatenated as
 * strings. The timestamp is read from the body, so it is covered by the digest
 * and cannot be changed on its own.
 *
 * Confirm this formula against the current Zalo documentation before going
 * live; it is the one part of an integration that vendors do revise.
 *
 * @see https://developers.zalo.me/docs/official-account
 */
export function verifyZaloSignature(
  appId: string,
  oaSecretKey: string,
  rawBody: string,
  timestamp: string,
  header: string | undefined,
): boolean {
  if (!header || !timestamp) return false;

  const [label, digest] = header.split("=", 2);
  if (label !== "mac" || !digest) return false;

  return safeEqualHex(digest, sha256(appId + rawBody + timestamp + oaSecretKey));
}
