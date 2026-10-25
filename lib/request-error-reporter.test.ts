import { beforeEach, expect, mock, test } from "bun:test";
import { reportRequestError } from "./request-error-reporter";
const logError = mock(() => undefined);
const flushLogs = mock(async () => undefined);
const sink = { logError, flushLogs };
beforeEach(() => {
  logError.mockClear();
  flushLogs.mockClear();
  flushLogs.mockImplementation(async () => undefined);
});
test("server errors emit a fixed category and await flushing", async () => {
  const error = new TypeError("synthetic private provider value");
  await reportRequestError(
    error,
    {
      method: "POST",
      routeType: "action",
      routerKind: "App Router",
    },
    sink,
  );
  expect(logError).toHaveBeenCalledWith(
    "Unhandled server request failure",
    error,
    { request_method: "POST", route_type: "action", router_kind: "App Router" },
  );
  expect(flushLogs).toHaveBeenCalledTimes(1);
});
test("an exporter failure never replaces the application error", async () => {
  flushLogs.mockImplementation(async () => {
    throw new Error("Synthetic exporter failure");
  });
  await expect(
    reportRequestError(
      new Error("Synthetic failure"),
      {
        method: "GET",
        routeType: "route",
        routerKind: "App Router",
      },
      sink,
    ),
  ).resolves.toBeUndefined();
});
test("an unresponsive exporter cannot block error handling indefinitely", async () => {
  flushLogs.mockImplementation(() => new Promise(() => {}));
  const before = Date.now();
  await reportRequestError(
    new Error("Synthetic failure"),
    {
      method: "GET",
      routeType: "render",
      routerKind: "App Router",
    },
    sink,
  );
  expect(Date.now() - before).toBeLessThan(2500);
});
