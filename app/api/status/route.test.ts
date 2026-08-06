import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { isLocalSupabaseEndpoint } = await import("./status-utils");

describe("status endpoint local Supabase detection", () => {
  test("accepts isolated localhost stacks on arbitrary ports", () => {
    expect(isLocalSupabaseEndpoint("http://127.0.0.1:56351")).toBe(true);
    expect(isLocalSupabaseEndpoint("http://localhost:65432")).toBe(true);
  });

  test("rejects hosted, malformed, and localhost-lookalike endpoints", () => {
    expect(isLocalSupabaseEndpoint("https://example.supabase.co")).toBe(false);
    expect(isLocalSupabaseEndpoint("https://localhost.example.com:54321")).toBe(
      false,
    );
    expect(isLocalSupabaseEndpoint("not a URL")).toBe(false);
  });
});
