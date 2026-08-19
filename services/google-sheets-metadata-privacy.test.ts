import { afterEach, describe, expect, mock, test } from "bun:test";

const logError = mock(
  (
    _message: string,
    _error: unknown,
    _attributes?: Record<string, string | number | boolean | undefined>,
  ) => undefined,
);
mock.module("@/lib/logger", () => ({ logError }));

const { getSpreadsheetMetadata } = await import("./google-sheets-report");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  logError.mockClear();
});

describe("Google Sheets metadata failure privacy", () => {
  test("classifies provider refusal without reading or logging its body or identifiers", async () => {
    let bodyRead = false;
    globalThis.fetch = mock(async () => {
      return {
        ok: false,
        status: 403,
        text: async () => {
          bodyRead = true;
          return "fixture-provider-body-with-coordinate";
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await getSpreadsheetMetadata(
      "fixture-access-token",
      "fixture-file-coordinate",
    );

    expect(result).toBeNull();
    expect(bodyRead).toBeFalse();
    expect(logError).toHaveBeenCalledTimes(1);

    const call = logError.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const [message, error, attributes] = call;
    expect(message).toBe("Failed to fetch Google spreadsheet metadata");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Sheets returned 403");
    expect(attributes).toEqual({ status: 403 });

    const logged = JSON.stringify({
      message,
      error: (error as Error).message,
      attributes,
    });
    expect(logged).not.toContain("fixture-provider-body-with-coordinate");
    expect(logged).not.toContain("fixture-file-coordinate");
    expect(logged).not.toContain("fixture-access-token");
  });

  test("sanitizes transport exceptions that may contain the requested identifier", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("request failed for fixture-file-coordinate");
    }) as unknown as typeof fetch;

    const result = await getSpreadsheetMetadata(
      "fixture-access-token",
      "fixture-file-coordinate",
    );

    expect(result).toBeNull();
    expect(logError).toHaveBeenCalledTimes(1);
    const call = logError.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    expect(call[0]).toBe(
      "Exception while fetching Google spreadsheet metadata",
    );
    expect((call[1] as Error).message).toBe("Sheets metadata request failed");
    expect(call[2]).toBeUndefined();
    expect(JSON.stringify(call)).not.toContain("fixture-file-coordinate");
    expect(JSON.stringify(call)).not.toContain("fixture-access-token");
  });
});
