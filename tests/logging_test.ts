import { assertEquals } from "@std/assert";
import { createLogger } from "../src/logging.ts";

function captureLog(fn: () => void): string[] {
  const lines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (line: string) => lines.push(line);
  console.error = (line: string) => lines.push(line);
  try {
    fn();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  return lines;
}

Deno.test("createLogger emits JSON with level, logger, msg, ts fields", () => {
  Deno.env.set("LOG_LEVEL", "debug");
  const log = createLogger("test");
  const lines = captureLog(() => log.info("hello"));
  const entry = JSON.parse(lines[0]);
  assertEquals(entry.level, "info");
  assertEquals(entry.logger, "test");
  assertEquals(entry.msg, "hello");
  assertEquals(typeof entry.ts, "string");
  Deno.env.delete("LOG_LEVEL");
});

Deno.test("logger redacts token field", () => {
  Deno.env.set("LOG_LEVEL", "debug");
  const log = createLogger("test");
  const lines = captureLog(() =>
    log.info("sensitive", { token: "secret-value", userId: "u1" })
  );
  const entry = JSON.parse(lines[0]);
  assertEquals(entry.token, "[REDACTED]");
  assertEquals(entry.userId, "u1");
  Deno.env.delete("LOG_LEVEL");
});

Deno.test("logger redacts session_id field", () => {
  Deno.env.set("LOG_LEVEL", "debug");
  const log = createLogger("test");
  const lines = captureLog(() =>
    log.info("session", { session_id: "sid-abc" })
  );
  const entry = JSON.parse(lines[0]);
  assertEquals(entry.session_id, "[REDACTED]");
  Deno.env.delete("LOG_LEVEL");
});

Deno.test("logger redacts nested sensitive fields", () => {
  Deno.env.set("LOG_LEVEL", "debug");
  const log = createLogger("test");
  const lines = captureLog(() =>
    log.info("nested", { user: { authorization: "Bearer abc", id: "u1" } })
  );
  const entry = JSON.parse(lines[0]);
  assertEquals(entry.user.authorization, "[REDACTED]");
  assertEquals(entry.user.id, "u1");
  Deno.env.delete("LOG_LEVEL");
});

Deno.test("logger suppresses messages below configured level", () => {
  Deno.env.set("LOG_LEVEL", "warn");
  const log = createLogger("test");
  const lines = captureLog(() => {
    log.debug("hidden");
    log.info("also hidden");
    log.warn("visible");
  });
  assertEquals(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assertEquals(entry.level, "warn");
  Deno.env.delete("LOG_LEVEL");
});

Deno.test("error and warn go to console.error", () => {
  Deno.env.set("LOG_LEVEL", "debug");
  const log = createLogger("test");
  const errorLines: string[] = [];
  const stdoutLines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (l: string) => stdoutLines.push(l);
  console.error = (l: string) => errorLines.push(l);
  try {
    log.error("err");
    log.warn("wrn");
    log.info("inf");
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  assertEquals(errorLines.length, 2);
  assertEquals(stdoutLines.length, 1);
  Deno.env.delete("LOG_LEVEL");
});
