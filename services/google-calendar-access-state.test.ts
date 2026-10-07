import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGoogleCalendarLookupError,
  classifyGoogleCalendarLookupResponse,
} from "./google-calendar-access-state";

test("calendar lookup only treats a successful HTTP response as accessible", () => {
  assert.deepEqual(
    classifyGoogleCalendarLookupResponse({ ok: true, status: 200 }),
    { status: "accessible" },
  );
  assert.deepEqual(
    classifyGoogleCalendarLookupResponse({ ok: false, status: 200 }),
    {
      status: "retryable_error",
      reason: "unexpected_status",
      httpStatus: 200,
    },
  );
});

test("calendar lookup only treats a reconciled 404 as missing", () => {
  assert.deepEqual(
    classifyGoogleCalendarLookupResponse({ ok: false, status: 404 }),
    { status: "missing" },
  );

  for (const status of [400, 409, 410, 422]) {
    assert.deepEqual(
      classifyGoogleCalendarLookupResponse({ ok: false, status }),
      {
        status: "retryable_error",
        reason: "unexpected_status",
        httpStatus: status,
      },
    );
  }
});

test("authorization failures are forbidden and never interpreted as missing", () => {
  assert.deepEqual(
    classifyGoogleCalendarLookupResponse({ ok: false, status: 401 }),
    { status: "forbidden", httpStatus: 401 },
  );
  assert.deepEqual(
    classifyGoogleCalendarLookupResponse({ ok: false, status: 403 }),
    { status: "forbidden", httpStatus: 403 },
  );
});

test("rate limits, timeouts, and provider failures are retryable", () => {
  assert.deepEqual(
    classifyGoogleCalendarLookupResponse({ ok: false, status: 429 }),
    {
      status: "retryable_error",
      reason: "rate_limited",
      httpStatus: 429,
    },
  );
  assert.deepEqual(
    classifyGoogleCalendarLookupResponse({ ok: false, status: 408 }),
    {
      status: "retryable_error",
      reason: "timeout",
      httpStatus: 408,
    },
  );

  for (const status of [500, 502, 503, 599]) {
    assert.deepEqual(
      classifyGoogleCalendarLookupResponse({ ok: false, status }),
      {
        status: "retryable_error",
        reason: "server_error",
        httpStatus: status,
      },
    );
  }
});

test("malformed and thrown lookups fail closed as retryable errors", () => {
  for (const response of [
    null,
    undefined,
    {},
    { ok: true },
    { status: 200 },
    { ok: true, status: Number.NaN },
    { ok: true, status: 0 },
  ]) {
    assert.deepEqual(classifyGoogleCalendarLookupResponse(response), {
      status: "retryable_error",
      reason: "malformed_response",
    });
  }

  assert.deepEqual(
    classifyGoogleCalendarLookupError(
      Object.assign(new Error("request aborted"), { name: "AbortError" }),
    ),
    { status: "retryable_error", reason: "timeout" },
  );
  assert.deepEqual(
    classifyGoogleCalendarLookupError(
      Object.assign(new Error("request timed out"), { name: "TimeoutError" }),
    ),
    { status: "retryable_error", reason: "timeout" },
  );
  assert.deepEqual(
    classifyGoogleCalendarLookupError(new Error("network unavailable")),
    { status: "retryable_error", reason: "network_error" },
  );
  assert.deepEqual(classifyGoogleCalendarLookupError("unknown failure"), {
    status: "retryable_error",
    reason: "unknown_error",
  });
});
