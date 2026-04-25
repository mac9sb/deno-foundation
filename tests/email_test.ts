import { assertEquals, assertRejects } from "@std/assert";
import { sendEmail } from "../src/email.ts";

Deno.test("sendEmail throws when RESEND_API_KEY is missing", async () => {
  const original = Deno.env.get("RESEND_API_KEY");
  Deno.env.delete("RESEND_API_KEY");
  try {
    await assertRejects(
      () =>
        sendEmail({
          to: "a@b.com",
          subject: "test",
          html: "<p>hi</p>",
          text: "hi",
          fetch: () => Promise.resolve(new Response("", { status: 200 })),
        }),
      Error,
      "RESEND_API_KEY",
    );
  } finally {
    if (original) Deno.env.set("RESEND_API_KEY", original);
  }
});

Deno.test("sendEmail sends correct payload to Resend", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};

  const fetch = ((url: unknown, init: RequestInit) => {
    capturedUrl = url as string;
    capturedHeaders = Object.fromEntries(
      new Headers(init.headers as HeadersInit).entries(),
    );
    capturedBody = JSON.parse(init.body as string);
    return Promise.resolve(new Response("", { status: 200 }));
  }) as typeof globalThis.fetch;

  await sendEmail({
    to: "user@example.com",
    subject: "Hello",
    html: "<b>Hi</b>",
    text: "Hi",
    fetch,
  });

  assertEquals(capturedUrl, "https://api.resend.com/emails");
  assertEquals(capturedHeaders["authorization"], "Bearer test-key");
  assertEquals(capturedBody.to, "user@example.com");
  assertEquals(capturedBody.subject, "Hello");

  Deno.env.delete("RESEND_API_KEY");
});

Deno.test("sendEmail throws on non-200 Resend response", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  await assertRejects(
    () =>
      sendEmail({
        to: "a@b.com",
        subject: "x",
        html: "<p>x</p>",
        text: "x",
        fetch: () =>
          Promise.resolve(new Response("Bad request", { status: 422 })),
      }),
    Error,
    "422",
  );
  Deno.env.delete("RESEND_API_KEY");
});
