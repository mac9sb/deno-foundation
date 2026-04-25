import { assertEquals, assertExists } from "@std/assert";
import { findOrCreateUser } from "../src/user.ts";
import { keys } from "../src/kv.ts";
import { withTempKv } from "./_helpers.ts";

Deno.test("findOrCreateUser creates a new user and stores both lookup keys", async () => {
  await withTempKv(async (kv) => {
    const user = await findOrCreateUser(kv, "alice@example.com");

    assertEquals(user.email, "alice@example.com");
    assertExists(user.id);
    assertExists(user.createdAt);

    const byId = await kv.get(keys.user.byId(user.id));
    assertExists(byId.value);

    const byEmail = await kv.get(keys.user.byEmail("alice@example.com"));
    assertEquals(byEmail.value, user.id);
  });
});

Deno.test("findOrCreateUser returns the same user on subsequent calls", async () => {
  await withTempKv(async (kv) => {
    const first = await findOrCreateUser(kv, "bob@example.com");
    const second = await findOrCreateUser(kv, "bob@example.com");

    assertEquals(first.id, second.id);
    assertEquals(first.email, second.email);
  });
});

Deno.test("findOrCreateUser creates distinct users for different emails", async () => {
  await withTempKv(async (kv) => {
    const a = await findOrCreateUser(kv, "a@example.com");
    const b = await findOrCreateUser(kv, "b@example.com");

    assertEquals(a.email, "a@example.com");
    assertEquals(b.email, "b@example.com");
    assertEquals(a.id !== b.id, true);
  });
});
