export function checkOrigin(
  request: Request,
  expectedOrigin: string,
): Response | null {
  const origin = request.headers.get("origin");
  if (!origin || origin !== expectedOrigin) {
    return new Response(
      JSON.stringify({ error: "Forbidden: invalid origin" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  return null;
}
