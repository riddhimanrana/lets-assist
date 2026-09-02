import { describe, expect, test } from "bun:test";

import { requestVercelBypassCookie } from "./vercel-bypass-cookie.mjs";

const appUrl = new URL("https://dev.lets-assist.com/");
const fixturePath = "/organization/csf-load-fixture";
const secret = "development-bypass-secret-for-tests";

function bypassResponse(location: string) {
  return new Response(null, {
    status: 307,
    headers: {
      location,
      "set-cookie":
        "_vercel_jwt=fixture-cookie-value; Path=/; HttpOnly; Secure; SameSite=Lax",
    },
  });
}

describe("Vercel browser bypass cookie", () => {
  test("uses one manual request and returns only the scoped cookie", async () => {
    const calls: Array<{ input: URL; init: RequestInit }> = [];
    const cookie = await requestVercelBypassCookie({
      appUrl,
      path: fixturePath,
      protectionBypass: secret,
      fetchImpl: async (input, init) => {
        calls.push({ input: new URL(input), init });
        return bypassResponse(fixturePath);
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input.href).toBe(`${appUrl.origin}${fixturePath}`);
    expect(calls[0]?.input.href).not.toContain(secret);
    expect(calls[0]?.init.redirect).toBe("manual");
    expect(calls[0]?.init.headers).toEqual({
      "x-vercel-protection-bypass": secret,
      "x-vercel-set-bypass-cookie": "true",
    });
    expect(cookie).toEqual({
      httpOnly: true,
      name: "_vercel_jwt",
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: "fixture-cookie-value",
      domain: appUrl.hostname,
    });
  });

  test("does not follow or accept a cross-origin redirect", async () => {
    let calls = 0;
    await expect(
      requestVercelBypassCookie({
        appUrl,
        path: fixturePath,
        protectionBypass: secret,
        fetchImpl: async (_input, init) => {
          calls += 1;
          expect(init.redirect).toBe("manual");
          return bypassResponse("https://example.invalid/capture");
        },
      }),
    ).rejects.toThrow("unsafe automation bypass redirect");
    expect(calls).toBe(1);
  });

  test("rejects a response without the Vercel bypass cookie", async () => {
    await expect(
      requestVercelBypassCookie({
        appUrl,
        path: fixturePath,
        protectionBypass: secret,
        fetchImpl: async () =>
          new Response(null, {
            status: 307,
            headers: { location: fixturePath },
          }),
      }),
    ).rejects.toThrow("valid automation bypass cookie");
  });

  test("refuses to mint a browser cookie for a non-HTTPS origin", async () => {
    await expect(
      requestVercelBypassCookie({
        appUrl: new URL("http://127.0.0.1:3000/"),
        path: fixturePath,
        protectionBypass: secret,
        fetchImpl: async () => bypassResponse(fixturePath),
      }),
    ).rejects.toThrow("must use HTTPS");
  });
});
