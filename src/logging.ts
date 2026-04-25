type Level = "trace" | "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const REDACTED_KEYS = new Set([
  "token",
  "session_id",
  "authorization",
  "cookie",
  "password",
  "secret",
  "key",
]);

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj === null || typeof obj !== "object") return obj;
  if (obj instanceof Uint8Array) return "[Binary]";
  if (Array.isArray(obj)) return obj.map((item) => redact(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = REDACTED_KEYS.has(k.toLowerCase())
      ? "[REDACTED]"
      : redact(v, depth + 1);
  }
  return result;
}

function getMinLevel(): Level {
  const envLevel = Deno.env.get("LOG_LEVEL")?.toLowerCase() as
    | Level
    | undefined;
  return envLevel !== undefined && LEVELS[envLevel] !== undefined
    ? envLevel
    : "info";
}

/** Structured JSON logger. Level is controlled by the `LOG_LEVEL` env var. */
export interface Logger {
  trace(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/**
 * Creates a named JSON logger that writes to stdout (or stderr for warn/error).
 * Sensitive fields such as `token`, `session_id`, and `cookie` are redacted
 * automatically. The minimum level defaults to `info` and can be overridden
 * with the `LOG_LEVEL` environment variable.
 *
 * ```ts
 * const log = createLogger("app");
 * log.info("server starting", { port: 8000 });
 * ```
 */
export function createLogger(name: string): Logger {
  function log(
    level: Level,
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    if (LEVELS[level] < LEVELS[getMinLevel()]) return;

    const entry = {
      level,
      logger: name,
      msg,
      ts: new Date().toISOString(),
      ...(data ? (redact(data) as Record<string, unknown>) : {}),
    };

    const line = JSON.stringify(entry);
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    trace: (msg, data) => log("trace", msg, data),
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
  };
}
