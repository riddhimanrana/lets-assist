import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { updateSession } from "./proxy";

const actorId = "00000000-0000-4000-8000-000000000001";
const verifiedFactor = {
  id: "00000000-0000-4000-8000-000000000002",
  factor_type: "totp",
  status: "verified",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

async function runAuthenticatedRequest(options: {
  aal?: "aal1" | "aal2";
  factors?: Record<string, string>[];
  sessionFactors?: Record<string, string>[];
  userStatus?: number;
  userError?: string;
  freshUserId?: string;
}) {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const kid = crypto.randomUUID();
  const unsigned = `${encode({ alg: "ES256", kid, typ: "JWT" })}.${encode({
    sub: actorId,
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    aal: options.aal ?? "aal1",
    role: "authenticated",
  })}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(unsigned),
  );
  const token = `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
  const user = {
    id: actorId,
    aud: "authenticated",
    email: "fixture@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    factors: options.sessionFactors ?? [],
  };
  const session = {
    access_token: token,
    refresh_token: "fixture-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user,
  };
  let userCalls = 0;
  let logoutCalls = 0;
  let authorized = false;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://request-audit.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "fixture-key";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.endsWith("/.well-known/jwks.json")) {
        return Response.json({
          keys: [{ ...publicKey, kid, alg: "ES256", use: "sig" }],
        });
      }
      if (url.endsWith("/user")) {
        userCalls++;
        if (options.userStatus) {
          return Response.json(
            {
              code: options.userError,
              error_code: options.userError,
              message: "Fixture auth failure",
            },
            { status: options.userStatus },
          );
        }
        return Response.json({
          ...user,
          id: options.freshUserId ?? actorId,
          factors: options.factors ?? [],
        });
      }
      if (url.includes("/logout")) {
        logoutCalls++;
        return new Response(null, { status: 204 });
      }
      throw new Error(
        `Unexpected request in proxy test: ${new URL(url).pathname}`,
      );
    }) as typeof fetch;
    const request = new NextRequest(
      "https://app.example.test/organization/fictional-csf?tab=csf-home",
      {
        headers: {
          cookie: `sb-request-audit-auth-token=base64-${encode(session)}`,
        },
      },
    );
    const response = await updateSession(request, {
      onAuthenticatedPassThrough: async () => {
        authorized = true;
        return null;
      },
    });
    return { response, userCalls, logoutCalls, authorized };
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
}

test("organization requests read the authoritative auth user once", async () => {
  const result = await runAuthenticatedRequest({});
  assert.equal(result.response.status, 200);
  assert.equal(result.authorized, true);
  assert.equal(result.userCalls, 1);
  assert.equal(
    result.response.headers.get("Cache-Control"),
    "private, no-store",
  );
});

test("fresh MFA enrollment requires step-up even when session factors are stale", async () => {
  const result = await runAuthenticatedRequest({ factors: [verifiedFactor] });
  assert.equal(result.userCalls, 1);
  assert.equal(result.response.status, 307);
  assert.match(
    result.response.headers.get("location") ?? "",
    /\/auth\/mfa\?redirect=/,
  );
});

test("aal2 and unverified factors do not challenge again", async () => {
  for (const options of [
    { aal: "aal2" as const, factors: [verifiedFactor] },
    { factors: [{ ...verifiedFactor, status: "unverified" }] },
  ]) {
    const result = await runAuthenticatedRequest(options);
    assert.equal(result.response.status, 200);
    assert.equal(result.userCalls, 1);
  }
});

test("fresh removal of the last factor does not reuse cookie enrollment", async () => {
  const result = await runAuthenticatedRequest({
    sessionFactors: [verifiedFactor],
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.userCalls, 1);
});

test("verified phone factors retain SDK next-assurance step-up behavior", async () => {
  const result = await runAuthenticatedRequest({
    factors: [{ ...verifiedFactor, factor_type: "phone" }],
  });
  assert.equal(result.response.status, 307);
  assert.equal(result.userCalls, 1);
});

test("fresh auth lookup failure returns a retry without clearing the session", async () => {
  const result = await runAuthenticatedRequest({
    userStatus: 500,
    userError: "unexpected_failure",
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.response.headers.get("Retry-After"), "5");
  assert.equal(
    result.response.headers.get("Cache-Control"),
    "private, no-store",
  );
  assert.equal(result.logoutCalls, 0);
});

test("banned, deleted, and mismatched fresh users cannot use the old claims", async () => {
  for (const options of [
    { userStatus: 403, userError: "user_banned" },
    { userStatus: 403, userError: "user_not_found" },
    { freshUserId: "00000000-0000-4000-8000-000000000099" },
  ]) {
    const result = await runAuthenticatedRequest(options);
    assert.equal(result.authorized, false);
    assert.equal(
      result.response.headers.get("Cache-Control"),
      "private, no-store",
    );
    assert.match(
      result.response.headers.get("set-cookie") ?? "",
      /sb-request-audit-auth-token=;.*Expires=Thu, 01 Jan 1970/,
    );
  }
});
