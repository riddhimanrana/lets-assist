import { expect, test } from "bun:test";
import { retryTransientAuthRead } from "./auth-errors";

test("a transient auth read recovers with one fresh attempt", async () => {
  let calls = 0;
  const result = await retryTransientAuthRead(async () => {
    calls++;
    return calls === 1
      ? { error: { status: 503 }, data: null }
      : { error: null, data: "validated" };
  });
  expect(result.data).toBe("validated");
  expect(calls).toBe(2);
});

test.each([401, 403, 429])(
  "refusals and rate limits (%s) are not retried",
  async (status) => {
    let calls = 0;
    const result = await retryTransientAuthRead(async () => {
      calls++;
      return { error: { status }, data: null };
    });
    expect(result.error.status).toBe(status);
    expect(calls).toBe(1);
  },
);

test("a persistent outage stops after two reads", async () => {
  let calls = 0;
  const result = await retryTransientAuthRead(async () => {
    calls++;
    return { error: { status: 503 }, data: null };
  });
  expect(result.error.status).toBe(503);
  expect(calls).toBe(2);
});
