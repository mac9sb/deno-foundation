import { assertEquals } from "@std/assert";
import { Router } from "../src/router.ts";

function makeReq(
  method: string,
  path: string,
  body?: string,
): Request {
  return new Request(`https://example.com${path}`, {
    method,
    body,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  });
}

Deno.test("Router dispatches GET to correct handler", async () => {
  const router = new Router();
  router.route("/hello", {
    get: () => new Response("ok", { status: 200 }),
  });
  const res = await router.handle(makeReq("GET", "/hello"));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ok");
});

Deno.test("Router returns 404 for unknown path", async () => {
  const router = new Router();
  const res = await router.handle(makeReq("GET", "/nope"));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "Not found");
});

Deno.test("Router returns 405 with Allow header for wrong method", async () => {
  const router = new Router();
  router.route("/data", { get: () => new Response("ok") });
  const res = await router.handle(makeReq("POST", "/data"));
  assertEquals(res.status, 405);
  assertEquals(res.headers.get("Allow"), "GET");
  const body = await res.json();
  assertEquals(body.error, "Method not allowed");
});

Deno.test("Router extracts path params", async () => {
  const router = new Router();
  let captured = "";
  router.route("/users/:id", {
    get: (_req, params) => {
      captured = params.id;
      return new Response("ok");
    },
  });
  await router.handle(makeReq("GET", "/users/abc-123"));
  assertEquals(captured, "abc-123");
});

Deno.test("Router handles multiple routes in order", async () => {
  const router = new Router();
  router.route("/a", { get: () => new Response("a") });
  router.route("/b", { get: () => new Response("b") });
  const a = await router.handle(makeReq("GET", "/a"));
  const b = await router.handle(makeReq("GET", "/b"));
  assertEquals(await a.text(), "a");
  assertEquals(await b.text(), "b");
});
