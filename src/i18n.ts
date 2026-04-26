/**
 * A function that looks up a translation key with optional variable
 * interpolation. Returns the key itself if no translation is found.
 */
export type TranslateFn = (
  key: string,
  vars?: Record<string, string>,
) => string;

/** Options for {@linkcode createI18n}. */
export interface I18nOptions {
  /** Locale codes to load. The first entry is the fallback locale. */
  locales: string[];
  /**
   * Directory containing `<locale>.json` files.
   * Default: `"./public/locales"`.
   */
  dir?: string;
}

/** An i18n instance returned by {@linkcode createI18n}. */
export interface I18n {
  /**
   * Returns a translate function for `locale`. Falls back to the first locale
   * in {@linkcode I18nOptions.locales} if `locale` was not loaded.
   */
  t(locale: string): TranslateFn;
}

/**
 * Loads all locale JSON files at startup and returns an {@linkcode I18n}
 * instance whose `t` method returns a per-locale translate function.
 *
 * Translation files must be flat JSON objects at `<dir>/<locale>.json`:
 * ```json
 * { "nav.sign_in": "Sign in", "hello": "Hello, {name}!" }
 * ```
 *
 * ```ts
 * const i18n = await createI18n({ locales: ["en", "fr"] });
 * const t = i18n.t(detectLocale(req, ["en", "fr"]));
 * t("nav.sign_in")               // → "Sign in"
 * t("hello", { name: "World" })  // → "Hello, World!"
 * ```
 */
export async function createI18n(opts: I18nOptions): Promise<I18n> {
  const dir = opts.dir ?? "./public/locales";
  const fallback = opts.locales[0] ?? "en";
  const maps = new Map<string, Record<string, string>>();

  for (const locale of opts.locales) {
    try {
      const raw = await Deno.readTextFile(`${dir}/${locale}.json`);
      maps.set(locale, JSON.parse(raw));
    } catch {
      // Missing or unparseable file — t() will fall back to the first locale
    }
  }

  return {
    t(locale: string): TranslateFn {
      const strings = maps.get(locale) ?? maps.get(fallback) ?? {};
      return (key: string, vars?: Record<string, string>): string => {
        let str = strings[key] ?? key;
        if (vars) {
          for (const [k, v] of Object.entries(vars)) {
            str = str.replaceAll(`{${k}}`, v);
          }
        }
        return str;
      };
    },
  };
}
