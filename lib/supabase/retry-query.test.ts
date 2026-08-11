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
                  message:
                    "An invalid response was received from the upstream server",
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

  test("never retries deterministic authorization, validation, constraint, or 4xx failures", () => {
    // These fail the same way on every attempt, so a retry can only waste time.
    // Ambiguous writes are a separate concern the classifier cannot see: it
    // never learns which operation produced an error, which is why
    // withRetryableSupabaseQuery is documented as read-only.
    const neverRetryable = [
      { code: "42501", message: "permission denied for table csf_profiles" },
      { code: "PGRST301", message: "JWT expired" },
      {
        code: "42501",
        message: "new row violates row-level security policy",
      },
      {
        code: "22P02",
        message: 'invalid input syntax for type uuid: "not-a-uuid"',
      },
      {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
      { code: "23503", message: "insert violates foreign key constraint" },
      { code: "PGRST116", message: "The result contains 0 rows" },
      { code: "23514", message: "new row violates check constraint" },
      { message: "Request failed with status 400 Bad Request" },
      { message: "Request failed with status 401 Unauthorized" },
      { message: "Request failed with status 403 Forbidden" },
      { message: "Request failed with status 404 Not Found" },
      { message: "Request failed with status 409 Conflict" },
      { message: "Request failed with status 422 Unprocessable Entity" },
      { status: 403, message: "Forbidden" },
      { status: "404", message: "Not Found" },
    ];

    for (const error of neverRetryable) {
      expect(isRetryableSupabaseQueryError(error)).toBe(false);
    }
  });

  test("a deterministic signal wins even when transient wording is also present", () => {
    // The exact split-signal shapes an upstream can produce: a permanent
    // failure whose text also mentions a transport problem. Reading the
    // transient phrase first would retry a request that can never succeed.
    const mixedButDeterministic = [
      { code: "42501", message: "permission denied: fetch failed" },
      { message: "Request failed with status 403 Forbidden: fetch failed" },
      { code: "23505", message: "duplicate key value: connection refused" },
      {
        code: "PGRST301",
        message: "invalid JWT",
        details: "upstream request timed out",
      },
      {
        message: "permission denied for table csf_profiles",
        hint: "fetch failed",
      },
      { status: 401, message: "no connection to the server" },
      {
        message: "Request failed with status 404 Not Found",
        details: "database client error",
      },
    ];

    for (const error of mixedButDeterministic) {
      expect(isRetryableSupabaseQueryError(error)).toBe(false);
    }
  });

  test("retries the client statuses that mean later, not never", () => {
    for (const error of [
      { message: "Request failed with status 408 Request Timeout" },
      { message: "Request failed with status 425 Too Early" },
      { message: "Request failed with status 429 Too Many Requests" },
      { status: 408, message: "Request Timeout" },
      { status: 429, message: "Too Many Requests" },
    ]) {
      expect(isRetryableSupabaseQueryError(error)).toBe(true);
    }
  });

  test("retries server-side and gateway statuses", () => {
    for (const error of [
      { message: "Request failed with status 500 Internal Server Error" },
      { message: "Request failed with status 502 Bad Gateway" },
      { message: "Request failed with status 503 Service Unavailable" },
      { message: "Request failed with status 504 Gateway Timeout" },
      { message: "HTTP/1.1 502 Bad Gateway" },
      { status: 503, message: "Service Unavailable" },
    ]) {
      expect(isRetryableSupabaseQueryError(error)).toBe(true);
    }
  });

  test("reads a status only next to an explicit status keyword", () => {
    // Bounded parsing: an unrelated three-digit number must never be mistaken
    // for a response code in either direction.
    expect(
      isRetryableSupabaseQueryError({
        code: "42P01",
        message: 'relation "public.report_404_totals" does not exist',
      }),
    ).toBe(true);
    expect(
      isRetryableSupabaseQueryError({
        message: 'could not find the table "public.audit_503_events"',
      }),
    ).toBe(true);
    // A bare number with no status keyword and no transient wording stays
    // unknown rather than being read as a retryable 5xx.
    expect(
      isRetryableSupabaseQueryError({ message: "row 503 failed validation" }),
    ).toBe(false);
  });

  test("keeps an explicit error code ahead of the HTTP status it arrives with", () => {
    // PostgREST answers a stale schema cache with 404 while still naming the
    // retryable code, so the code has to outrank the status.
    expect(
      isRetryableSupabaseQueryError({
        code: "PGRST205",
        message: "Request failed with status 404: could not find the table",
      }),
    ).toBe(true);
    expect(
      isRetryableSupabaseQueryError({
        code: "42P01",
        status: 404,
        message: 'relation "public.csf_profiles" does not exist',
      }),
    ).toBe(true);
    // The reverse still holds: a deterministic code is not rescued by a 5xx.
    expect(
      isRetryableSupabaseQueryError({
        code: "42501",
        status: 500,
        message: "permission denied",
      }),
    ).toBe(false);
  });

  test("never retries a cancelled request", async () => {
    const abortError = Object.assign(new Error("The operation was aborted."), {
      name: "AbortError",
    });
    expect(isRetryableSupabaseQueryError(abortError)).toBe(false);

    let attempts = 0;
    await expect(
      withRetryableSupabaseQuery(
        () => {
          attempts += 1;
          throw abortError;
        },
        { maxAttempts: 3, initialDelayMs: 0 },
      ),
    ).rejects.toThrow("The operation was aborted.");
    expect(attempts).toBe(1);
  });

  test("bounds attempts and backoff for a persistently transient read", async () => {
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    // Record the requested backoff, then run it immediately: only the bound on
    // the requested duration matters here.
    globalThis.setTimeout = ((handler: () => void, timeout?: number) => {
      delays.push(timeout ?? 0);
      return realSetTimeout(handler, 0);
    }) as unknown as typeof globalThis.setTimeout;

    let attempts = 0;
    try {
      const result = await withRetryableSupabaseQuery(
        () => {
          attempts += 1;
          return Promise.resolve({
            data: null,
            error: {
              message:
                "An invalid response was received from the upstream server",
            },
          });
        },
        { maxAttempts: 4, initialDelayMs: 250, maxDelayMs: 600 },
      );
      expect(result.data).toBeNull();
      expect(result.error).not.toBeNull();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }

    // Bounded attempt count, and every backoff respects the ceiling.
    expect(attempts).toBe(4);
    expect(delays).toEqual([250, 500, 600]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(600);
  });

  test("classifies without issuing any query of its own", () => {
    // Classification is pure: it inspects the error value and never re-runs the
    // query or mutates the error. That purity is also its limit — it sees only
    // the error, never the operation, so it cannot make a write safe to repeat.
    const error = {
      code: "PGRST001",
      message: "database client error",
      details: null,
      hint: null,
    };
    const snapshot = JSON.stringify(error);

    expect(isRetryableSupabaseQueryError(error)).toBe(true);
    expect(isRetryableSupabaseQueryError(error)).toBe(true);
    expect(JSON.stringify(error)).toBe(snapshot);
  });
});
