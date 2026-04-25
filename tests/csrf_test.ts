import { assertEquals } from "@std/assert";
import { checkOrigin } from "../src/csrf.ts";

function makeReq(origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  return new Request("https://example.com/api/data", {
    method: "POST",
    headers,
  });
}

Deno.test("checkOrigin returns null when origin matches", () => {
  const req = makeReq("https://example.com");
  const result = checkOrigin(req, "https://example.com");
  assertEquals(result, null);
});

Deno.test("checkOrigin returns 403 when origin mismatches", async () => {
  const req = makeReq("https://evil.com");
  const res = checkOrigin(req, "https://example.com");
  assertEquals(res?.status, 403);
  const body = await res!.json();
  assertEquals(body.error, "Forbidden: invalid origin");
});

Deno.test("checkOrigin returns 403 when origin header is absent", () => {
  const req = makeReq();
  const res = checkOrigin(req, "https://example.com");
  assertEquals(res?.status, 403);
  assertEquals(res?.headers.get("Content-Type"), "application/json");
});
