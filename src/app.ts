import type { DatabaseSync } from "node:sqlite";
import { ClaudeResponder, createAnthropicClient, type AiResponder } from "./ai/claude.js";
import { Engine } from "./bot/engine.js";
import { Inbox } from "./bot/inbox.js";
import type { Config } from "./config.js";
import { openDatabase } from "./db/database.js";
import { Store } from "./db/store.js";
import { createForwardHandler } from "./handlers/forward.js";
import { DEFAULT_RULES, FALLBACK_REPLY } from "./handlers/rules.js";
import { createApp, type App } from "./server.js";
import { aiEnabledSetting, createAdmin, SETTING_KNOWLEDGE } from "./web/admin.js";
import { Auth } from "./web/auth.js";

export interface Runtime {
  readonly app: App;
  readonly store: Store;
  readonly db: DatabaseSync;
  readonly inbox: Inbox;
}

export interface BuildOverrides {
  /** Replaces the Claude client, for tests and demos. */
  readonly ai?: AiResponder;
  /** Replaces the database file, for tests and demos. */
  readonly db?: DatabaseSync;
}

/** Wires configuration into a running application. Kept separate from index.ts so tests can build it. */
export function buildRuntime(config: Config, overrides: BuildOverrides = {}): Runtime {
  const db = overrides.db ?? openDatabase(config.databasePath);
  const store = new Store(db);

  const ai =
    overrides.ai ??
    (config.ai
      ? new ClaudeResponder({
          client: createAnthropicClient(config.ai.apiKey),
          model: config.ai.model,
          effort: config.ai.effort,
        })
      : undefined);

  const engine = new Engine({
    rules: DEFAULT_RULES,
    fallback: FALLBACK_REPLY,
    ...(ai ? { ai } : {}),
    ...(config.forward ? { forward: createForwardHandler(config.forward) } : {}),
    settings: () => ({
      aiEnabled: aiEnabledSetting(store),
      knowledge: store.getSetting(SETTING_KNOWLEDGE) ?? "",
    }),
  });

  const inbox = new Inbox({ store, engine, channels: config.channels });

  const admin = config.admin
    ? createAdmin({
        store,
        inbox,
        auth: new Auth({
          store,
          password: config.admin.password,
          secureCookies: config.admin.secureCookies,
          trustProxy: config.admin.trustProxy,
        }),
        channels: config.channels.map((channel) => channel.id),
        aiConfigured: ai !== undefined,
        aiModel: config.ai?.model ?? "",
        forwarding: config.forward !== undefined,
        timeZone: config.timeZone,
      })
    : undefined;

  const app = createApp({ channels: config.channels, inbox, ...(admin ? { admin } : {}) });
  return { app, store, db, inbox };
}
