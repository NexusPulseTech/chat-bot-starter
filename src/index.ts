import { loadConfig } from "./config.js";
import { DedupeStore } from "./dedupe.js";
import { log } from "./logger.js";
import { createApp } from "./server.js";

const config = loadConfig();
const app = createApp({
  channels: config.channels,
  handler: config.handler,
  dedupe: new DedupeStore(),
});

app.server.listen(config.port, () => {
  log.info("bot started", {
    port: config.port,
    channels: config.channels.map((channel) => channel.id),
    handler: config.handlerName,
  });
});

/**
 * Stops accepting requests, then waits for replies already in progress.
 * Docker and Kubernetes send SIGTERM on every deploy; exiting immediately would
 * drop the replies to messages that were acknowledged but not yet answered.
 */
function shutdown(signal: string): void {
  log.info("shutting down", { signal });
  app.server.close();
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  void app.idle().then(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
