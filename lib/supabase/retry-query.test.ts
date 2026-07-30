import { describe, expect, test } from "bun:test";

import {
  isRetryableSupabaseQueryError,
  withRetryableSupabaseQuery,
} from "./retry-query";

describe("retryable Supabase reads", () => {
  test("recognizes the local gateway upstream-response failure", () => {
    expect(
      isRetryableSupabaseQueryError({
        message: "An invalid response was received from the upstream server",
      }),
    ).toBe(true);
  });

  test("retries one transient read and returns the successful response", async () => {
    let attempts = 0;
    const result = await withRetryableSupabaseQuery(
      () => {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? {
                data: null,
                error: {
                  message: "An invalid response was received from the upstream server",
                },
              }
            : { data: [{ id: "fictional-profile" }], error: null },
        );
      },
      { maxAttempts: 2, initialDelayMs: 0 },
    );

    expect(attempts).toBe(2);
    expect(result).toEqual({
      data: [{ id: "fictional-profile" }],
      error: null,
    });
  });

  test("retries a thrown transient transport failure", async () => {
    let attempts = 0;
    const result = await withRetryableSupabaseQuery(
      () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("fetch failed");
        }
        return Promise.resolve({
          data: [{ id: "fictional-organization" }],
          error: null,
        });
      },
      { maxAttempts: 2, initialDelayMs: 0 },
    );

    expect(attempts).toBe(2);
    expect(result.data).toEqual([{ id: "fictional-organization" }]);
  });

  test("does not retry a thrown non-transient programming error", async () => {
    let attempts = 0;

    await expect(
      withRetryableSupabaseQuery(
        () => {
          attempts += 1;
          throw new Error("invalid query shape");
        },
        { maxAttempts: 3, initialDelayMs: 0 },
      ),
    ).rejects.toThrow("invalid query shape");
    expect(attempts).toBe(1);
  });

  test("returns the latest result error after an earlier thrown retryable failure", async () => {
    let attempts = 0;
    const result = await withRetryableSupabaseQuery(
      () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("fetch failed");
        }
        return Promise.resolve({
          data: null,
          error: { code: "PGRST001", message: "database client error" },
        });
      },
      { maxAttempts: 2, initialDelayMs: 0 },
    );

    expect(attempts).toBe(2);
    expect(result).toEqual({
      data: null,
      error: { code: "PGRST001", message: "database client error" },
    });
  });
});
