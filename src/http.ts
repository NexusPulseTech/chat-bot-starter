import type { IncomingMessage, ServerResponse } from "node:http";

/** Larger bodies are refused before they are read into memory. */
export const MAX_BODY_BYTES = 1024 * 1024;

export class PayloadTooLargeError extends Error {}

/**
 * Reads the raw body. Webhook signatures are computed over these exact bytes.
 *
 * Past the size limit the stream keeps flowing but chunks are discarded, so
 * memory stays bounded while the client finishes sending. Destroying the socket
 * instead would drop the connection before the 413 reaches the client, which
 * then sees a connection reset rather than an explanation.
 */
export function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    let tooLarge = Number.isFinite(declared) && declared > limit;
    if (tooLarge) reject(new PayloadTooLargeError());

    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
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

export function send(
  res: ServerResponse,
  status: number,
  body: string,
  type = "text/plain",
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": `${type}; charset=utf-8`, ...headers });
  res.end(body);
}

export function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(303, { location, ...headers });
  res.end();
}

/** Flattens Node's header object, where a value can be a string array. */
export function headersOf(req: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    headers[name] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}
