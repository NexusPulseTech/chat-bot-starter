import type { Effort } from "./ai/claude.js";
import { MessengerChannel } from "./channels/messenger.js";
import type { Channel } from "./channels/types.js";
import { ZaloChannel } from "./channels/zalo.js";
import type { ForwardOptions } from "./handlers/forward.js";

export const DEFAULT_AI_MODEL = "claude-opus-5";

export interface Config {
  readonly port: number;
  readonly databasePath: string;
  readonly timeZone: string;
  readonly channels: readonly Channel[];
  /** Present when ADMIN_PASSWORD is set: the dashboard is enabled. */
  readonly admin?: {
    readonly password: string;
    readonly secureCookies: boolean;
    readonly trustProxy: boolean;
  };
  /** Present when ANTHROPIC_API_KEY is set: AI replies are available. */
  readonly ai?: {
    readonly apiKey: string;
    readonly model: string;
    readonly effort: Effort;
  };
  /** Present when FORWARD_URL is set: an external workflow answers messages. */
  readonly forward?: ForwardOptions;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Collects missing variables so the error names all of them at once. */
function pick(env: Env, names: readonly string[], missing: string[]): string[] {
  return names.map((name) => {
    const value = env[name]?.trim();
    if (!value) missing.push(name);
    return value ?? "";
  });
}

/** True when at least one variable of a group is set, so the group is in use. */
function anySet(env: Env, names: readonly string[]): boolean {
  return names.some((name) => Boolean(env[name]?.trim()));
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const MESSENGER_VARS = ["MESSENGER_APP_SECRET", "MESSENGER_PAGE_ACCESS_TOKEN", "MESSENGER_VERIFY_TOKEN"] as const;
const ZALO_VARS = ["ZALO_APP_ID", "ZALO_OA_SECRET_KEY", "ZALO_OA_ACCESS_TOKEN"] as const;
const EFFORTS: readonly Effort[] = ["low", "medium", "high"];
const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * Reads configuration from the environment.
 *
 * A channel is enabled when any of its variables is set, and then all of them
 * are required. Starting with something half-configured is refused, because
 * the failure would otherwise surface later on live traffic.
 */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];
  const channels: Channel[] = [];

  if (anySet(env, MESSENGER_VARS)) {
    const [appSecret, pageAccessToken, verifyToken] = pick(env, MESSENGER_VARS, problems);
    channels.push(
      new MessengerChannel({
        appSecret: appSecret ?? "",
        pageAccessToken: pageAccessToken ?? "",
        verifyToken: verifyToken ?? "",
      }),
    );
  }

  if (anySet(env, ZALO_VARS)) {
    const [appId, oaSecretKey, accessToken] = pick(env, ZALO_VARS, problems);
    channels.push(
      new ZaloChannel({
        appId: appId ?? "",
        oaSecretKey: oaSecretKey ?? "",
        accessToken: accessToken ?? "",
      }),
    );
  }

  const forwardUrl = env["FORWARD_URL"]?.trim();
  if (forwardUrl && !/^https?:\/\//.test(forwardUrl)) {
    problems.push("FORWARD_URL (must start with http:// or https://)");
  }

  const adminPassword = env["ADMIN_PASSWORD"] ?? "";
  if (adminPassword !== "" && adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
    problems.push(`ADMIN_PASSWORD (must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters)`);
  }

  const effort = (env["AI_EFFORT"]?.trim() || "low") as Effort;
  if (!EFFORTS.includes(effort)) problems.push(`AI_EFFORT (one of ${EFFORTS.join(", ")})`);

  const timeZone = env["TIMEZONE"]?.trim() || "Asia/Ho_Chi_Minh";
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    problems.push(`TIMEZONE ("${timeZone}" is not a valid IANA time zone)`);
  }

  if (problems.length > 0) {
    throw new Error(`Missing or invalid environment variables: ${problems.join(", ")}`);
  }
  if (channels.length === 0) {
    throw new Error("No channel configured. Set the MESSENGER_* or ZALO_* variables, see .env.example.");
  }

  const port = Number(env["PORT"] ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env["PORT"]}"`);
  }

  const apiKey = env["ANTHROPIC_API_KEY"]?.trim();
  const forwardToken = env["FORWARD_TOKEN"]?.trim();
  // In production the dashboard sits behind HTTPS, so the cookie is marked
  // Secure unless explicitly turned off.
  const production = env["NODE_ENV"] === "production";

  return {
    port,
    databasePath: env["DATABASE_PATH"]?.trim() || "./data/bot.db",
    timeZone,
    channels,
    ...(adminPassword
      ? {
          admin: {
            password: adminPassword,
            secureCookies: flag(env["COOKIE_SECURE"], production),
            trustProxy: flag(env["TRUST_PROXY"], false),
          },
        }
      : {}),
    ...(apiKey ? { ai: { apiKey, model: env["AI_MODEL"]?.trim() || DEFAULT_AI_MODEL, effort } } : {}),
    ...(forwardUrl ? { forward: forwardToken ? { url: forwardUrl, token: forwardToken } : { url: forwardUrl } } : {}),
  };
}
