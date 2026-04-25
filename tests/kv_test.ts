import { assertEquals } from "@std/assert";
import { keys } from "../src/kv.ts";

Deno.test("keys.user.byId builds correct key", () => {
  assertEquals(keys.user.byId("u1"), ["user", "id", "u1"]);
});

Deno.test("keys.user.byEmail builds correct key", () => {
  assertEquals(keys.user.byEmail("a@b.com"), ["user", "email", "a@b.com"]);
});

Deno.test("keys.session builds correct key", () => {
  assertEquals(keys.session("s1"), ["session", "s1"]);
});

Deno.test("keys.magic builds correct key", () => {
  assertEquals(keys.magic("hash123"), ["magic", "token", "hash123"]);
});

Deno.test("keys.passkey.byUser builds correct key", () => {
  assertEquals(keys.passkey.byUser("u1"), ["passkey", "users", "u1"]);
});

Deno.test("keys.passkey.challenge builds correct key", () => {
  assertEquals(keys.passkey.challenge("c1"), ["passkey", "challenge", "c1"]);
});

Deno.test("keys.passkey.credentialToUser builds correct key", () => {
  assertEquals(keys.passkey.credentialToUser("cred1"), [
    "passkey",
    "credential",
    "cred1",
  ]);
});

Deno.test("keys.rate.magic builds correct key", () => {
  assertEquals(keys.rate.magic("a@b.com"), ["rate", "magic", "a@b.com"]);
});
