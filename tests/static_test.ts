import { assertEquals, assertStringIncludes } from "@std/assert";
import { createStaticHandler, detectLocale } from "../src/static.ts";

// ── detectLocale ───────────────────────────────────────────────────────────────

Deno.test("detectLocale returns first supported locale as fallback", () => {
  const req = new Request("http://localhost/");
  assertEquals(detectLocale(req, ["en", "fr"]), "en");
});

Deno.test("detectLocale reads locale cookie", () => {
  const req = new Request("http://localhost/", {
    headers: { Cookie: "locale=fr" },
  });
  assertEquals(detectLocale(req, ["en", "fr"]), "fr");
});

Deno.test("detectLocale ignores unsupported cookie value", () => {
  const req = new Request("http://localhost/", {
    headers: { Cookie: "locale=de" },
  });
  assertEquals(detectLocale(req, ["en", "fr"]), "en");
});

Deno.test("detectLocale reads Accept-Language header", () => {
  const req = new Request("http://localhost/", {
    headers: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" },
  });
  assertEquals(detectLocale(req, ["en", "fr"]), "fr");
});

Deno.test("detectLocale prefers cookie over Accept-Language", () => {
  const req = new Request("http://localhost/", {
    headers: {
      Cookie: "locale=en",
      "Accept-Language": "fr",
    },
  });
  assertEquals(detectLocale(req, ["en", "fr"]), "en");
});

Deno.test("detectLocale returns en for empty supported list", () => {
  const req = new Request("http://localhost/");
  assertEquals(detectLocale(req, []), "en");
});

// ── createStaticHandler ────────────────────────────────────────────────────────

Deno.test("isStatic returns true for known extensions", () => {
  const serve = createStaticHandler();
  assertEquals(serve.isStatic("/styles.css"), true);
  assertEquals(serve.isStatic("/app.js"), true);
  assertEquals(serve.isStatic("/logo.svg"), true);
  assertEquals(serve.isStatic("/favicon.ico"), true);
});

Deno.test("isStatic returns false for paths without extension", () => {
  const serve = createStaticHandler();
  assertEquals(serve.isStatic("/about"), false);
  assertEquals(serve.isStatic("/api/session"), false);
});

Deno.test("file returns 404 for path traversal attempt", async () => {
  const serve = createStaticHandler();
  const res = await serve.file("/../etc/passwd");
  assertEquals(res.status, 404);
});

Deno.test("html returns 404 for path traversal attempt", async () => {
  const serve = createStaticHandler();
  const res = await serve.html(
    new Request("http://localhost/"),
    "/../etc/passwd",
  );
  assertEquals(res.status, 404);
});

Deno.test("html serves file from dir and sets Content-Type", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/index.html`, "<h1>Hello</h1>");

  const serve = createStaticHandler({ dir });
  const res = await serve.html(new Request("http://localhost/"), "/index.html");

  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("Content-Type") ?? "", "text/html");

  await Deno.remove(dir, { recursive: true });
});

Deno.test("html sets locale cookie on first visit", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/index.html`, "");

  const serve = createStaticHandler({ dir, locales: ["en", "fr"] });
  const req = new Request("http://localhost/", {
    headers: { "Accept-Language": "fr" },
  });
  const res = await serve.html(req, "/index.html");

  assertStringIncludes(res.headers.get("Set-Cookie") ?? "", "locale=fr");

  await Deno.remove(dir, { recursive: true });
});

Deno.test("html does not overwrite existing locale cookie", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/index.html`, "");

  const serve = createStaticHandler({ dir, locales: ["en", "fr"] });
  const req = new Request("http://localhost/", {
    headers: { Cookie: "locale=fr" },
  });
  const res = await serve.html(req, "/index.html");

  assertEquals(res.headers.get("Set-Cookie"), null);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("file returns 404 for missing file", async () => {
  const serve = createStaticHandler({ dir: "/nonexistent" });
  const res = await serve.file("/missing.css");
  assertEquals(res.status, 404);
});
