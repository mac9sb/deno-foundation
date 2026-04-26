const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
};

/** Options for {@linkcode createStaticHandler}. */
export interface StaticHandlerOptions {
  /** Directory to serve files from. Default: `"./public"`. */
  dir?: string;
  /** Locale codes to detect from cookie and Accept-Language header. */
  locales?: string[];
}

/** A static-file handler returned by {@linkcode createStaticHandler}. */
export interface StaticHandler {
  /** Returns `true` if the pathname ends with a known static file extension. */
  isStatic(pathname: string): boolean;
  /** Serves a static file. Returns 404 if not found or path traversal is detected. */
  file(pathname: string): Promise<Response>;
  /** Serves an HTML file, setting a locale cookie on first visit. */
  html(req: Request, pathname: string): Promise<Response>;
}

/**
 * Detects the best locale for a request.
 *
 * Priority: locale cookie → Accept-Language header → first supported locale.
 * Returns `"en"` if `supported` is empty.
 */
export function detectLocale(req: Request, supported: string[]): string {
  if (supported.length === 0) return "en";

  const cookie = req.headers.get("Cookie");
  if (cookie) {
    const m = cookie.match(/\blocale=([^;]+)/);
    if (m && supported.includes(m[1])) return m[1];
  }

  const acceptLang = req.headers.get("Accept-Language") ?? "";
  for (const part of acceptLang.split(",")) {
    const base = part.trim().split(";")[0].split("-")[0].toLowerCase();
    if (supported.includes(base)) return base;
  }

  return supported[0];
}

/**
 * Creates a static-file handler that serves files from `dir`.
 *
 * - Path traversal attempts (`..`) are rejected with 404.
 * - When `locales` is set, an HTML response sets a `locale` cookie on first
 *   visit using the detected locale from the request.
 *
 * ```ts
 * const serve = createStaticHandler({ locales: ["en", "fr"] });
 * Deno.serve((req) => {
 *   const { pathname } = new URL(req.url);
 *   if (serve.isStatic(pathname)) return serve.file(pathname);
 *   return serve.html(req, "/index.html");
 * });
 * ```
 */
export function createStaticHandler(
  opts: StaticHandlerOptions = {},
): StaticHandler {
  const dir = opts.dir ?? "./public";
  const locales = opts.locales ?? [];

  return {
    isStatic(pathname: string): boolean {
      const ext = pathname.split(".").pop() ?? "";
      return ext in MIME;
    },

    async file(pathname: string): Promise<Response> {
      if (pathname.includes("..")) {
        return new Response("Not found", { status: 404 });
      }
      const ext = pathname.split(".").pop() ?? "";
      try {
        const body = await Deno.readFile(`${dir}${pathname}`);
        return new Response(body, {
          headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },

    async html(req: Request, pathname: string): Promise<Response> {
      if (pathname.includes("..")) {
        return new Response("Not found", { status: 404 });
      }
      try {
        const body = await Deno.readFile(`${dir}${pathname}`);
        const headers: Record<string, string> = {
          "Content-Type": MIME.html,
        };
        if (locales.length > 0) {
          const hasLocaleCookie = req.headers.get("Cookie")?.includes(
            "locale=",
          );
          if (!hasLocaleCookie) {
            const locale = detectLocale(req, locales);
            headers["Set-Cookie"] = `locale=${locale}; Path=/; SameSite=Lax`;
          }
        }
        return new Response(body, { headers });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };
}
