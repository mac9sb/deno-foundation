import { assertEquals, assertNotEquals } from "@std/assert";
import { constantTimeEqual, sha256Hex } from "../src/crypto.ts";

Deno.test("sha256Hex matches known vector", async () => {
  const hash = await sha256Hex("hello");
  assertEquals(
    hash,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

Deno.test("sha256Hex produces different hashes for different inputs", async () => {
  const a = await sha256Hex("foo");
  const b = await sha256Hex("bar");
  assertNotEquals(a, b);
});

Deno.test("constantTimeEqual returns true for equal strings", () => {
  assertEquals(constantTimeEqual("abc", "abc"), true);
});

Deno.test("constantTimeEqual returns false for different strings of same length", () => {
  assertEquals(constantTimeEqual("abc", "abd"), false);
});

Deno.test("constantTimeEqual returns false for different length strings", () => {
  assertEquals(constantTimeEqual("abc", "abcd"), false);
});
