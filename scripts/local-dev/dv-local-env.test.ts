import { describe, expect, test } from "bun:test";

import {
  assertLocalSupabaseUrl,
  resolveProvidedLocalSupabaseEnv,
} from "./dv-local-env.mjs";

describe("local Supabase environment resolution", () => {
  test("accepts a complete explicitly provided loopback environment", () => {
    expect(
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-anon",
        SUPABASE_SECRET_KEY: "local-service-role",
      }),
    ).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey: "local-anon",
      serviceRoleKey: "local-service-role",
    });
  });

  test("falls back to CLI discovery when the provided environment is incomplete", () => {
    expect(
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toBeNull();
  });

  test("rejects a provided remote project", () => {
    expect(() => assertLocalSupabaseUrl("https://example.supabase.co")).toThrow(
      "refuses non-local Supabase URL",
    );
  });
});
