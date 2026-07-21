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
});
