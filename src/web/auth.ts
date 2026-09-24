import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Session, Store } from "../db/store.js";

export const SESSION_COOKIE = "np_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

export interface AuthOptions {
  readonly store: Store;
  readonly password: string;
  /** Adds the Secure flag to the cookie. Turn on whenever the dashboard is served over HTTPS. */
  readonly secureCookies: boolean;
  /** Read the client address from X-Forwarded-For. Only behind a proxy you control. */
  readonly trustProxy: boolean;
  readonly now?: () => number;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

/**
 * Dashboard authentication: one shared password, server-side sessions and a
 * CSRF token per session.
 *
 * The cookie holds a random token; only its SHA-256 hash is stored, so a copy
 * of the database cannot be used to log in. Failed logins are limited per
 * client address.
 */
export class Auth {
  readonly #store: Store;
  readonly #passwordDigest: Buffer;
  readonly #key = randomBytes(32);
  readonly #secureCookies: boolean;
  readonly #trustProxy: boolean;
  readonly #now: () => number;
  readonly #failures = new Map<string, number[]>();

  constructor(options: AuthOptions) {
    this.#store = options.store;
    this.#secureCookies = options.secureCookies;
    this.#trustProxy = options.trustProxy;
    this.#now = options.now ?? Date.now;
    this.#passwordDigest = this.#digest(options.password);
  }

  // Both sides are HMACed with a per-process key, so the comparison runs over
  // fixed-length values and takes the same time however many characters match.
  #digest(value: string): Buffer {
    return createHmac("sha256", this.#key).update(value, "utf8").digest();
  }

  clientAddress(req: IncomingMessage): string {
    if (this.#trustProxy) {
      const forwarded = req.headers["x-forwarded-for"];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  /** True when this address has failed too many times recently. */
  isLockedOut(address: string): boolean {
    const now = this.#now();
    const recent = (this.#failures.get(address) ?? []).filter((time) => now - time < LOGIN_WINDOW_MS);
    this.#failures.set(address, recent);
    return recent.length >= LOGIN_MAX_FAILURES;
  }

  /** Checks the password and, if it matches, returns the Set-Cookie value for a new session. */
  login(address: string, password: string): string | null {
    if (!timingSafeEqual(this.#digest(password), this.#passwordDigest)) {
      this.#failures.set(address, [...(this.#failures.get(address) ?? []), this.#now()]);
      return null;
    }
    this.#failures.delete(address);

    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    const expiresAt = this.#now() + SESSION_TTL_MS;
    this.#store.deleteExpiredSessions(this.#now());
    this.#store.createSession(hashToken(token), csrf, expiresAt);
    return this.#cookie(token, Math.floor(SESSION_TTL_MS / 1000));
  }

  /** The session for this request, or undefined when logged out or expired. */
  session(req: IncomingMessage): Session | undefined {
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (!token) return undefined;
    return this.#store.getSession(hashToken(token), this.#now());
  }

  /** Ends the session and returns the Set-Cookie value that clears the cookie. */
  logout(req: IncomingMessage): string {
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (token) this.#store.deleteSession(hashToken(token));
    return this.#cookie("", 0);
  }

  /** Constant-time comparison of the submitted CSRF token with the session's. */
  checkCsrf(session: Session, submitted: string | null): boolean {
    if (!submitted) return false;
    const expected = Buffer.from(session.csrfToken);
    const actual = Buffer.from(submitted);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  #cookie(value: string, maxAgeSeconds: number): string {
    const parts = [`${SESSION_COOKIE}=${value}`, "Path=/admin", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
    if (this.#secureCookies) parts.push("Secure");
    return parts.join("; ");
  }
}
