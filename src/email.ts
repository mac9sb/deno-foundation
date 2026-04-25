/** Parameters for {@linkcode sendEmail}. */
export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Override `globalThis.fetch` (useful in tests). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Sends a transactional email via the Resend API.
 * Requires the `RESEND_API_KEY` environment variable.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");

  const fetchFn = payload.fetch ?? globalThis.fetch;
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("EMAIL_FROM") ?? "noreply@example.com",
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}
