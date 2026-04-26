type Handler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

/** HTTP method handlers for a single route. */
export interface RouteDefinition {
  get?: Handler;
  post?: Handler;
  patch?: Handler;
  put?: Handler;
  delete?: Handler;
}

interface Route {
  pattern: URLPattern;
  definition: RouteDefinition;
}

/**
 * A minimal URL-pattern router.
 *
 * ```ts
 * const router = new Router();
 * router.route("/users/:id", { get: (req, { id }) => new Response(id) });
 * Deno.serve((req) => router.handle(req));
 * ```
 */
export class Router {
  private routes: Route[] = [];

  /** Registers a route for the given pathname pattern. */
  route(pathname: string, definition: RouteDefinition): this {
    this.routes.push({ pattern: new URLPattern({ pathname }), definition });
    return this;
  }

  /** Dispatches `request` to the first matching route handler. */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    for (const { pattern, definition } of this.routes) {
      const result = pattern.exec({ pathname: url.pathname });
      if (!result) continue;

      const params = (result.pathname.groups ?? {}) as Record<string, string>;
      const method = request.method.toLowerCase() as keyof RouteDefinition;
      const handler = definition[method];

      if (!handler) {
        const allowed = Object.keys(definition)
          .map((m) => m.toUpperCase())
          .join(", ");
        const res = Response.json(
          { error: "Method not allowed", allowed },
          { status: 405 },
        );
        res.headers.set("Allow", allowed);
        return res;
      }

      return await handler(request, params);
    }

    return Response.json(
      { error: "Not found", path: url.pathname },
      { status: 404 },
    );
  }
}
