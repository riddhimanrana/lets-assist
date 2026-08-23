import { describe, expect, test } from "bun:test";

import {
  diagnoseGooglePickerKey,
  interpretGooglePickerKeyProbe,
} from "./google-picker-preflight";

const ORIGIN = "https://lets-assist-prod-lets-assist-team.vercel.app";

function payload(reason: string) {
  return { error: { code: 403, details: [{ reason }] } };
}

describe("google picker key probe", () => {
  test("treats a 404 on the nonexistent probe id as a healthy key", () => {
    expect(
      interpretGooglePickerKeyProbe({
        status: 404,
        payload: {
          error: { code: 404, message: "Requested entity not found" },
        },
        origin: ORIGIN,
      }),
    ).toEqual({ ok: true });
  });

  test("names the blocked origin so the fix is a copy-paste", () => {
    const result = interpretGooglePickerKeyProbe({
      status: 403,
      payload: payload("API_KEY_HTTP_REFERRER_BLOCKED"),
      origin: ORIGIN,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("referrer_blocked");
    expect(result.message).toContain(`${ORIGIN}/*`);
  });

  test("distinguishes a rejected key from a blocked origin", () => {
    const result = interpretGooglePickerKeyProbe({
      status: 400,
      payload: payload("API_KEY_INVALID"),
      origin: ORIGIN,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
    expect(result.message).toContain("different Google Cloud project");
  });

  test("reports a disabled API separately", () => {
    const result = interpretGooglePickerKeyProbe({
      status: 403,
      payload: payload("SERVICE_DISABLED"),
      origin: ORIGIN,
    });

    expect(result.ok && false).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("api_disabled");
  });

  test("falls back rather than claiming a cause it does not know", () => {
    const result = interpretGooglePickerKeyProbe({
      status: 500,
      payload: null,
      origin: ORIGIN,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unreachable");
  });
});

describe("google picker key diagnosis", () => {
  test("reports a missing key without calling Google", async () => {
    let called = false;
    const result = await diagnoseGooglePickerKey(
      undefined,
      (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
      ORIGIN,
    );

    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing");
    expect(result.message).toContain("NEXT_PUBLIC_GOOGLE_PICKER_API_KEY");
  });

  test("passes the key to Google and interprets the response", async () => {
    let requested = "";
    const result = await diagnoseGooglePickerKey(
      "test-key",
      (async (url: string) => {
        requested = url;
        return new Response(
          JSON.stringify(payload("API_KEY_HTTP_REFERRER_BLOCKED")),
          {
            status: 403,
          },
        );
      }) as unknown as typeof fetch,
      ORIGIN,
    );

    expect(requested).toContain("key=test-key");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("referrer_blocked");
  });

  test("does not blame the key when Google is unreachable", async () => {
    const result = await diagnoseGooglePickerKey(
      "test-key",
      (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      ORIGIN,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unreachable");
  });
});
