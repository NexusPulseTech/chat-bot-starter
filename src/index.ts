import { buildRuntime } from "./app.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";

const config = loadConfig();
const { app, db } = buildRuntime(config);

app.server.listen(config.port, () => {
  log.info("bot started", {
    port: config.port,
    channels: config.channels.map((channel) => channel.id),
    dashboard: config.admin ? "/admin" : "disabled (set ADMIN_PASSWORD)",
    ai: config.ai ? config.ai.model : "disabled (set ANTHROPIC_API_KEY)",
    forward: config.forward ? "on" : "off",
    database: config.databasePath,
  });
});

/**
 * Stops accepting requests, waits for replies already in progress, then
 * closes the database. Docker and Kubernetes send SIGTERM on every deploy;
 * exiting immediately would drop replies to messages that were acknowledged
 * but not yet answered.
 */
function shutdown(signal: string): void {
  log.info("shutting down", { signal });
  app.server.close();
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  void app.idle().then(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
