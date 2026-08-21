import { describe, expect, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

import type { AuthenticatedProxyContext } from "@/lib/supabase/proxy";

import { createRootProxy } from "./proxy";

const applicationPath =
  "/organization/22222222-2222-4222-8222-222222222222/plugins/dvhs-csf/access-proof";

function authenticatedContext(request: NextRequest): AuthenticatedProxyContext {
  return {
    request,
    userId: "11111111-1111-4111-8111-111111111111",
    supabase: null as never,
  };
}

describe("root proxy composition", () => {
  test("finishes host auth before routing and preserves auth response policy", async () => {
    const events: string[] = [];
    const request = new NextRequest(`https://example.test${applicationPath}`, {
      headers: { "x-vercel-mfe-flag-value": "true" },
    });
    const rootProxy = createRootProxy({
      updateSession: async (authRequest, options) => {
        events.push("auth");
        const routed = await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        );
        events.push("auth-finalize");
        const response = routed ?? NextResponse.next();
        response.headers.set("Cache-Control", "private, no-store");
        response.cookies.set("sb-test-auth-token", "refreshed");
        return response;
      },
      readCsfApplicationFlag: async () => {
        events.push("flag");
        return true;
      },
      runMicrofrontendsMiddleware: async ({ request: routedRequest }) => {
        events.push("microfrontend");
        expect(routedRequest.headers.has("x-vercel-mfe-flag-value")).toBe(
          false,
        );
        const headers = new Headers(routedRequest.headers);
        headers.set("x-vercel-mfe-zone", "lets-assist-csf");
        return NextResponse.next({ request: { headers } });
      },
    });

    const response = await rootProxy(request);

    expect(events).toEqual(["auth", "flag", "microfrontend", "auth-finalize"]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(response.headers.get("x-middleware-request-x-vercel-mfe-zone")).toBe(
      "lets-assist-csf",
    );
  });

  test("never evaluates child routing when host auth redirects", async () => {
    let childCalls = 0;
    const rootProxy = createRootProxy({
      updateSession: async () =>
        NextResponse.redirect("https://example.test/login"),
      readCsfApplicationFlag: async () => {
        childCalls += 1;
        return true;
      },
      runMicrofrontendsMiddleware: async () => {
        childCalls += 1;
        return NextResponse.next();
      },
    });

    const response = await rootProxy(
      new NextRequest(`https://example.test${applicationPath}`),
    );

    expect(response.status).toBe(307);
    expect(childCalls).toBe(0);
  });

  test("keeps the route in the host when the database flag is absent", async () => {
    let microfrontendCalls = 0;
    const request = new NextRequest(`https://example.test${applicationPath}`);
    const rootProxy = createRootProxy({
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationFlag: async () => false,
      runMicrofrontendsMiddleware: async () => {
        microfrontendCalls += 1;
        return NextResponse.next();
      },
    });

    await rootProxy(request);

    expect(microfrontendCalls).toBe(0);
  });

  test("serves the required client config without exposing active routes", async () => {
    let authCalls = 0;
    let resolvedFlag = true;
    const rootProxy = createRootProxy({
      updateSession: async () => {
        authCalls += 1;
        return NextResponse.next();
      },
      readCsfApplicationFlag: async () => true,
      runMicrofrontendsMiddleware: async ({ flagValues }) => {
        resolvedFlag = await flagValues["dvhs-csf-application-runtime"]();
        return NextResponse.json({ config: {} });
      },
    });

    const response = await rootProxy(
      new NextRequest(
        "https://example.test/.well-known/vercel/microfrontends/client-config",
      ),
    );

    expect(authCalls).toBe(0);
    expect(resolvedFlag).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
