const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
};

export interface StaticHandlerOptions {
  /** Directory to serve files from. Default: "./public" */
  dir?: string;
  /** Locale codes to detect from cookie and Accept-Language header. */
  locales?: string[];
}

export interface StaticHandler {
  /** True if the pathname ends with a known static file extension. */
  isStatic(pathname: string): boolean;
  /** Serve a static file. Returns 404 if not found or path traversal detected. */
  file(pathname: string): Promise<Response>;
  /** Serve an HTML file, setting a locale cookie on first visit. */
  html(req: Request, pathname: string): Promise<Response>;
}

/**
 * Detect the best locale from a request.
 *
 * Priority: locale cookie → Accept-Language header → first supported locale.
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
