import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as React from "react";
let values: unknown[] = [];
let cursor = 0;
let cleanup: (() => void) | undefined;
let eventHandler: (event: string) => void;
let mode: "valid" | "retry" | "missing" | "revoked" = "valid";
const retry = {
  name: "AuthRetryableFetchError",
  status: 503,
  message: "Synthetic temporary outage",
};
mock.module("react", () => ({
  ...React,
  useState: (initial: unknown) => {
    const index = cursor++;
    values[index] = initial;
    return [
      initial,
      (value: unknown) => {
        values[index] = value;
      },
    ];
  },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => () => void) => {
    cleanup = effect();
  },
}));
mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getClaims: async () => ({
        data:
          mode === "valid"
            ? { claims: { sub: "synthetic-user", role: "authenticated" } }
            : null,
        error: mode === "retry" ? retry : null,
      }),
      getUser: async () => ({
        data: { user: null },
        error:
          mode === "retry"
            ? retry
            : mode === "revoked"
              ? {
                  name: "AuthApiError",
                  code: "refresh_token_not_found",
                  status: 400,
                }
              : null,
      }),
      onAuthStateChange: (handler: (event: string) => void) => {
        eventHandler = handler;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  }),
}));
const { useAuth } = await import("./useAuth");
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
beforeEach(async () => {
  values = [];
  cursor = 0;
  mode = "valid";
  useAuth();
  await settle();
});
afterEach(() => cleanup?.());
test("refresh outages preserve previously resolved UI state, then a successful retry resolves again", async () => {
  const initial = values[0];
  expect(initial).toMatchObject({ id: "synthetic-user" });
  mode = "retry";
  eventHandler("TOKEN_REFRESHED");
  await settle();
  expect(values[0]).toEqual(initial);
  expect(values[1]).toBe(false);
  mode = "valid";
  eventHandler("TOKEN_REFRESHED");
  await settle();
  expect(values[0]).toMatchObject({ id: "synthetic-user" });
});
test.each(["missing", "revoked"] as const)(
  "authoritative %s sessions still clear the user",
  async (next) => {
    mode = next;
    eventHandler("TOKEN_REFRESHED");
    await settle();
    expect(values[0]).toBeNull();
  },
);
test("explicit SIGNED_OUT clears immediately after a refresh outage", async () => {
  mode = "retry";
  eventHandler("TOKEN_REFRESHED");
  await settle();
  expect(values[0]).toMatchObject({ id: "synthetic-user" });
  eventHandler("SIGNED_OUT");
  expect(values[0]).toBeNull();
  expect(values[1]).toBe(false);
});
