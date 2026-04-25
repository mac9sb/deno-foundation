type Handler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

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

export class Router {
  private routes: Route[] = [];

  route(pathname: string, definition: RouteDefinition): this {
    this.routes.push({ pattern: new URLPattern({ pathname }), definition });
    return this;
  }

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
        return new Response(
          JSON.stringify({ error: "Method not allowed", allowed }),
          {
            status: 405,
            headers: {
              "Content-Type": "application/json",
              "Allow": allowed,
            },
          },
        );
      }

      return await handler(request, params);
    }

    return new Response(
      JSON.stringify({ error: "Not found", path: url.pathname }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}
