import { describe, expect, test } from "bun:test";

import {
  GOOGLE_CAP_MAX_BODY_BYTES,
  readGoogleCapToken,
} from "./google-cap-request";

const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJqdGkiOiJldmVudCJ9.signature";

function request(body: BodyInit, headers?: HeadersInit) {
  return new Request("http://127.0.0.1/api/security/google/cap", {
    method: "POST",
    body,
    headers,
  });
}

describe("Google CAP request parsing", () => {
  test("accepts the provider's raw compact JWT body", async () => {
    expect(await readGoogleCapToken(request(TOKEN))).toBe(TOKEN);
  });

  test("accepts one unambiguous JSON token field for compatibility", async () => {
    expect(
      await readGoogleCapToken(
        request(JSON.stringify({ security_event_token: TOKEN })),
      ),
    ).toBe(TOKEN);
  });

  test("rejects ambiguous token aliases instead of picking one", async () => {
    await expect(
      readGoogleCapToken(
        request(JSON.stringify({ token: TOKEN, jwt: `${TOKEN}x` })),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("rejects malformed compact tokens before any provider lookup", async () => {
    await expect(
      readGoogleCapToken(request("not-a-jwt")),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("rejects an oversized declared body without buffering it", async () => {
    await expect(
      readGoogleCapToken(
        request(TOKEN, {
          "content-length": String(GOOGLE_CAP_MAX_BODY_BYTES + 1),
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  test("rejects a chunked body once the actual byte limit is crossed", async () => {
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `a.${"b".repeat(GOOGLE_CAP_MAX_BODY_BYTES)}.c`,
          ),
        );
        controller.close();
      },
    });
    await expect(readGoogleCapToken(request(oversized))).rejects.toMatchObject({
      status: 413,
    });
  });

  test("rejects invalid UTF-8", async () => {
    await expect(
      readGoogleCapToken(request(new Uint8Array([0xc3, 0x28]))),
    ).rejects.toMatchObject({ status: 400 });
  });
});
