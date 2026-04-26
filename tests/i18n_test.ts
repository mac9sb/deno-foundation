import { assertEquals } from "@std/assert";
import { createI18n } from "../src/i18n.ts";

async function withLocaleDir(
  files: Record<string, Record<string, string>>,
  fn: (dir: string) => Promise<void>,
) {
  const dir = await Deno.makeTempDir();
  for (const [locale, strings] of Object.entries(files)) {
    await Deno.writeTextFile(`${dir}/${locale}.json`, JSON.stringify(strings));
  }
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

// ── basic translation ──────────────────────────────────────────────────────────

Deno.test("t returns translation for loaded locale", async () => {
  await withLocaleDir({ en: { "nav.sign_in": "Sign in" } }, async (dir) => {
    const i18n = await createI18n({ locales: ["en"], dir });
    assertEquals(i18n.t("en")("nav.sign_in"), "Sign in");
  });
});

Deno.test("t returns key when translation is missing", async () => {
  await withLocaleDir({ en: {} }, async (dir) => {
    const i18n = await createI18n({ locales: ["en"], dir });
    assertEquals(i18n.t("en")("missing.key"), "missing.key");
  });
});

// ── variable interpolation ─────────────────────────────────────────────────────

Deno.test("t interpolates {var} placeholders", async () => {
  await withLocaleDir(
    { en: { hello: "Hello, {name}!" } },
    async (dir) => {
      const i18n = await createI18n({ locales: ["en"], dir });
      assertEquals(i18n.t("en")("hello", { name: "World" }), "Hello, World!");
    },
  );
});

Deno.test("t interpolates multiple placeholders", async () => {
  await withLocaleDir(
    { en: { msg: "{a} and {b}" } },
    async (dir) => {
      const i18n = await createI18n({ locales: ["en"], dir });
      assertEquals(i18n.t("en")("msg", { a: "foo", b: "bar" }), "foo and bar");
    },
  );
});

Deno.test("t with no vars returns plain translation", async () => {
  await withLocaleDir({ en: { hello: "Hello, {name}!" } }, async (dir) => {
    const i18n = await createI18n({ locales: ["en"], dir });
    assertEquals(i18n.t("en")("hello"), "Hello, {name}!");
  });
});

// ── multiple locales ───────────────────────────────────────────────────────────

Deno.test("t returns correct locale strings", async () => {
  await withLocaleDir(
    {
      en: { "nav.sign_in": "Sign in" },
      fr: { "nav.sign_in": "Se connecter" },
    },
    async (dir) => {
      const i18n = await createI18n({ locales: ["en", "fr"], dir });
      assertEquals(i18n.t("en")("nav.sign_in"), "Sign in");
      assertEquals(i18n.t("fr")("nav.sign_in"), "Se connecter");
    },
  );
});

// ── fallback behaviour ─────────────────────────────────────────────────────────

Deno.test("t falls back to first locale for unknown locale", async () => {
  await withLocaleDir({ en: { "nav.sign_in": "Sign in" } }, async (dir) => {
    const i18n = await createI18n({ locales: ["en"], dir });
    assertEquals(i18n.t("de")("nav.sign_in"), "Sign in");
  });
});

Deno.test("createI18n silently handles missing locale file", async () => {
  await withLocaleDir({ en: { greeting: "Hello" } }, async (dir) => {
    // fr.json does not exist — should not throw
    const i18n = await createI18n({ locales: ["en", "fr"], dir });
    assertEquals(i18n.t("fr")("greeting"), "Hello"); // falls back to en
  });
});

// ── custom dir ─────────────────────────────────────────────────────────────────

Deno.test("createI18n respects custom dir option", async () => {
  await withLocaleDir({ en: { "page.title": "Home" } }, async (dir) => {
    const i18n = await createI18n({ locales: ["en"], dir });
    assertEquals(i18n.t("en")("page.title"), "Home");
  });
});
