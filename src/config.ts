import { MessengerChannel } from "./channels/messenger.js";
import type { Channel, MessageHandler } from "./channels/types.js";
import { ZaloChannel } from "./channels/zalo.js";
import { createForwardHandler } from "./handlers/forward.js";
import { createRulesHandler } from "./handlers/rules.js";

export interface Config {
  readonly port: number;
  readonly channels: readonly Channel[];
  readonly handler: MessageHandler;
  readonly handlerName: "rules" | "forward";
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

const MESSENGER_VARS = ["MESSENGER_APP_SECRET", "MESSENGER_PAGE_ACCESS_TOKEN", "MESSENGER_VERIFY_TOKEN"] as const;
const ZALO_VARS = ["ZALO_APP_ID", "ZALO_OA_SECRET_KEY", "ZALO_OA_ACCESS_TOKEN"] as const;

/**
 * Reads configuration from the environment.
 *
 * A channel is enabled when any of its variables is set, and then all of them
 * are required. Starting with half a channel configured is refused, because the
 * failure would otherwise surface later as rejected webhooks in production.
 */
export function loadConfig(env: Env = process.env): Config {
  const missing: string[] = [];
  const channels: Channel[] = [];

  if (anySet(env, MESSENGER_VARS)) {
    const [appSecret, pageAccessToken, verifyToken] = pick(env, MESSENGER_VARS, missing);
    channels.push(
      new MessengerChannel({
        appSecret: appSecret ?? "",
        pageAccessToken: pageAccessToken ?? "",
        verifyToken: verifyToken ?? "",
      }),
    );
  }

  if (anySet(env, ZALO_VARS)) {
    const [appId, oaSecretKey, accessToken] = pick(env, ZALO_VARS, missing);
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
    missing.push("FORWARD_URL (must start with http:// or https://)");
  }

  if (missing.length > 0) {
    throw new Error(`Missing or invalid environment variables: ${missing.join(", ")}`);
  }
  if (channels.length === 0) {
    throw new Error("No channel configured. Set the MESSENGER_* or ZALO_* variables, see .env.example.");
  }

  const port = Number(env["PORT"] ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env["PORT"]}"`);
  }

  const forwardToken = env["FORWARD_TOKEN"]?.trim();
  const handler = forwardUrl
    ? createForwardHandler(forwardToken ? { url: forwardUrl, token: forwardToken } : { url: forwardUrl })
    : createRulesHandler();

  return { port, channels, handler, handlerName: forwardUrl ? "forward" : "rules" };
}
