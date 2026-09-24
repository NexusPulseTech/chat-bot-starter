/**
 * Minimal structured logger.
 *
 * One JSON object per line, which is what container log collectors such as
 * Loki, CloudWatch and Datadog parse without extra configuration.
 */
type Level = "info" | "warn" | "error";

const REDACTED = "[redacted]";

/** Field names whose values must never reach the logs. */
const SECRET_KEYS = /(secret|token|signature|password|authorization|mac)/i;

/** Replaces secret-looking values so a log line cannot leak a credential. */
export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = SECRET_KEYS.test(key) ? REDACTED : value;
  }
  return safe;
}

function write(level: Level, message: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...redact(fields),
  });
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  info: (message: string, fields: Record<string, unknown> = {}) => write("info", message, fields),
  warn: (message: string, fields: Record<string, unknown> = {}) => write("warn", message, fields),
  error: (message: string, fields: Record<string, unknown> = {}) => write("error", message, fields),
};
