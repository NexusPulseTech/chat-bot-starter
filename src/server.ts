import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Inbox } from "./bot/inbox.js";
import type { Channel, ChannelId, InboundMessage } from "./channels/types.js";
import { headersOf, PayloadTooLargeError, readBody, send } from "./http.js";
import { log } from "./logger.js";

/** Handles a request if it belongs to it, and returns whether it did. */
export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;

export interface AppOptions {
  readonly channels: readonly Channel[];
  readonly inbox: Inbox;
  /** The dashboard, when ADMIN_PASSWORD is set. */
  readonly admin?: RouteHandler;
}

export interface App {
  readonly server: Server;
  /** Resolves once every message received so far has been handled. */
  idle(): Promise<void>;
}

/**
 * Builds the HTTP app.
 *
 * Routes:
 * - `GET  /healthz`            liveness probe for Docker and load balancers
 * - `GET  /webhook/:channel`   provider subscription handshake
 * - `POST /webhook/:channel`   provider deliveries
 * - `/admin/*`                 dashboard, when enabled
 */
export function createApp(options: AppOptions): App {
  const channels = new Map<ChannelId, Channel>(options.channels.map((c) => [c.id, c]));
  const inFlight = new Set<Promise<void>>();

  function track(message: InboundMessage): void {
    const work = options.inbox.receive(message).then(
      () => undefined,
      (error: unknown) => {
        // Errors are logged, never thrown: the provider has already been
        // answered, and one failed message must not affect the others.
        log.error("message failed", {
          channel: message.channel,
          messageId: message.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
  }

  async function webhook(req: IncomingMessage, res: ServerResponse, url: URL, channel: Channel): Promise<void> {
    if (req.method === "GET") {
      const handshake = channel.handshake(url.searchParams);
      if (handshake) send(res, handshake.status, handshake.body);
      else send(res, 404, "Not found");
      return;
    }

    if (req.method !== "POST") {
      res.setHeader("allow", "GET, POST");
      send(res, 405, "Method not allowed");
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        // Close afterwards: the rest of an oversized body is not worth reading.
        res.setHeader("connection", "close");
        send(res, 413, "Payload too large");
      } else {
        send(res, 400, "Bad request");
      }
      return;
    }

    if (!channel.verify({ body, headers: headersOf(req) })) {
      log.warn("signature rejected", { channel: channel.id });
      send(res, 401, "Invalid signature");
      return;
    }

    let messages: InboundMessage[];
    try {
      messages = channel.parse(body);
    } catch {
      send(res, 400, "Invalid JSON");
      return;
    }

    // Acknowledge before doing any work. Providers expect an answer within a
    // few seconds and retry when it is late, and a retry is a duplicate
    // delivery. Handling happens after the response has gone out.
    send(res, 200, "EVENT_RECEIVED");
    for (const message of messages) track(message);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/healthz") {
      send(res, 200, JSON.stringify({ status: "ok" }), "application/json");
      return;
    }

    const match = /^\/webhook\/([a-z]+)\/?$/.exec(url.pathname);
    if (match) {
      const channel = match[1] ? channels.get(match[1] as ChannelId) : undefined;
      if (channel) return webhook(req, res, url, channel);
      send(res, 404, "Not found");
      return;
    }

    if (options.admin && (await options.admin(req, res, url))) return;

    send(res, 404, "Not found");
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      log.error("request failed", { error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) send(res, 500, "Internal server error");
    });
  });

  return {
    server,
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}
