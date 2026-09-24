import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { DedupeStore } from "./dedupe.js";
import { log } from "./logger.js";
import type { Channel, ChannelId, InboundMessage, MessageHandler } from "./channels/types.js";

/** Larger bodies are refused before they are read into memory. */
const MAX_BODY_BYTES = 1024 * 1024;

export interface AppOptions {
  readonly channels: readonly Channel[];
  readonly handler: MessageHandler;
  readonly dedupe: DedupeStore;
}

export interface App {
  readonly server: Server;
  /** Resolves once every reply started so far has been sent or has failed. */
  idle(): Promise<void>;
}

class PayloadTooLargeError extends Error {}

/**
 * Reads the raw body. Signatures are computed over these exact bytes.
 *
 * Past the size limit the stream keeps flowing but chunks are discarded, so
 * memory stays bounded while the client finishes sending. Destroying the socket
 * instead would drop the connection before the 413 reaches the client, which
 * then sees a connection reset rather than an explanation.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    let tooLarge = Number.isFinite(declared) && declared > MAX_BODY_BYTES;
    if (tooLarge) reject(new PayloadTooLargeError());

    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function reply(res: ServerResponse, status: number, body: string, type = "text/plain"): void {
  res.writeHead(status, { "content-type": `${type}; charset=utf-8` });
  res.end(body);
}

/** Flattens Node's header object, where a value can be a string array. */
function headersOf(req: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    headers[name] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}

/**
 * Builds the HTTP app.
 *
 * Routes:
 * - `GET  /healthz`            liveness probe for Docker and load balancers
 * - `GET  /webhook/:channel`   provider subscription handshake
 * - `POST /webhook/:channel`   provider deliveries
 */
export function createApp(options: AppOptions): App {
  const channels = new Map<ChannelId, Channel>(options.channels.map((c) => [c.id, c]));
  const inFlight = new Set<Promise<void>>();

  /**
   * Runs the handler and sends the reply for one message.
   * Errors are logged, never thrown: the provider has already been answered,
   * and one failed reply must not affect the others in the same batch.
   */
  async function process(channel: Channel, message: InboundMessage): Promise<void> {
    const key = `${message.channel}:${message.messageId}`;
    if (!options.dedupe.admit(key)) {
      log.info("duplicate delivery skipped", { channel: message.channel, messageId: message.messageId });
      return;
    }

    try {
      const answer = await options.handler(message);
      if (answer) await channel.send(message.senderId, answer);
      log.info("message handled", {
        channel: message.channel,
        messageId: message.messageId,
        replied: answer !== null,
      });
    } catch (error) {
      log.error("message failed", {
        channel: message.channel,
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function track(work: Promise<void>): void {
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/healthz") {
      reply(res, 200, JSON.stringify({ status: "ok" }), "application/json");
      return;
    }

    const match = /^\/webhook\/([a-z]+)\/?$/.exec(url.pathname);
    const channel = match?.[1] ? channels.get(match[1] as ChannelId) : undefined;
    if (!channel) {
      reply(res, 404, "Not found");
      return;
    }

    if (req.method === "GET") {
      const handshake = channel.handshake(url.searchParams);
      if (handshake) reply(res, handshake.status, handshake.body);
      else reply(res, 404, "Not found");
      return;
    }

    if (req.method !== "POST") {
      res.setHeader("allow", "GET, POST");
      reply(res, 405, "Method not allowed");
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        // Close afterwards: the rest of an oversized body is not worth reading.
        res.setHeader("connection", "close");
        reply(res, 413, "Payload too large");
      } else {
        reply(res, 400, "Bad request");
      }
      return;
    }

    const delivery = { body, headers: headersOf(req) };
    if (!channel.verify(delivery)) {
      log.warn("signature rejected", { channel: channel.id });
      reply(res, 401, "Invalid signature");
      return;
    }

    let messages: InboundMessage[];
    try {
      messages = channel.parse(body);
    } catch {
      reply(res, 400, "Invalid JSON");
      return;
    }

    // Acknowledge before doing any work. Providers expect an answer within a
    // few seconds and retry when it is late, and a retry is a duplicate
    // delivery. Handling happens after the response has gone out.
    reply(res, 200, "EVENT_RECEIVED");

    for (const message of messages) track(process(channel, message));
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      log.error("request failed", { error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) reply(res, 500, "Internal server error");
    });
  });

  return {
    server,
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}
