import { describe, expect, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

import type { AuthenticatedProxyContext } from "@/lib/supabase/proxy";

import {
  createRootProxy,
  readCsfApplicationRouteTarget,
  rewriteToPluginApplicationDeployment,
} from "./proxy";

const applicationPath =
  "/organization/22222222-2222-4222-8222-222222222222/plugins/dvhs-csf/access-proof";
const routeTarget = {
  deploymentId: "dpl_selected_v1",
  deploymentUrl: "https://lets-assist-csf-v1.vercel.app",
  runtimeVersion: "1.2.7",
};

function authenticatedContext(request: NextRequest): AuthenticatedProxyContext {
  return {
    request,
    userId: "11111111-1111-4111-8111-111111111111",
    supabase: null as never,
  };
}

describe("root proxy composition", () => {
  test("reads one caller-scoped immutable route target", async () => {
    const calls: Array<{ functionName: string; parameters: unknown }> = [];
    const supabase = {
      async rpc(functionName: string, parameters: unknown) {
        calls.push({ functionName, parameters });
        return { data: { routable: true, ...routeTarget }, error: null };
      },
    };

    const target = await readCsfApplicationRouteTarget(
      {
        request: new NextRequest(`https://example.test${applicationPath}`),
        userId: "11111111-1111-4111-8111-111111111111",
        supabase: supabase as never,
      },
      "dvhighcsf",
      "development",
    );

    expect(target).toEqual(routeTarget);
    expect(calls).toEqual([
      {
        functionName: "get_plugin_application_route_target_by_identifier",
        parameters: {
          p_environment: "development",
          p_organization_identifier: "dvhighcsf",
          p_plugin_key: "dvhs-csf",
        },
      },
    ]);
  });

  test("fails closed when the route target RPC denies access", async () => {
    const supabase = {
      async rpc() {
        return { data: { routable: false }, error: null };
      },
    };

    const target = await readCsfApplicationRouteTarget(
      {
        request: new NextRequest(`https://example.test${applicationPath}`),
        userId: "11111111-1111-4111-8111-111111111111",
        supabase: supabase as never,
      },
      "missing-organization",
    );

    expect(target).toBeNull();
  });

  test("finishes host auth before routing and preserves auth response policy", async () => {
    const events: string[] = [];
    const request = new NextRequest(`https://example.test${applicationPath}`, {
      headers: { "x-vercel-mfe-flag-value": "true" },
    });
    const rootProxy = createRootProxy({
      applicationEnvironment: "development",
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
      readCsfApplicationRouteTarget: async () => {
        events.push("target");
        return routeTarget;
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

    expect(events).toEqual(["auth", "target", "auth-finalize"]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `https://lets-assist-csf-v1.vercel.app${applicationPath}`,
    );
  });

  test("never evaluates child routing when host auth redirects", async () => {
    let childCalls = 0;
    const rootProxy = createRootProxy({
      applicationEnvironment: "development",
      updateSession: async () =>
        NextResponse.redirect("https://example.test/login"),
      readCsfApplicationRouteTarget: async () => {
        childCalls += 1;
        return routeTarget;
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
      applicationEnvironment: "development",
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationRouteTarget: async () => null,
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
      applicationEnvironment: "development",
      updateSession: async () => {
        authCalls += 1;
        return NextResponse.next();
      },
      readCsfApplicationRouteTarget: async () => routeTarget,
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

  test("fails closed on unrelated Vercel preview branches", async () => {
    let targetCalls = 0;
    const request = new NextRequest(`https://example.test${applicationPath}`);
    const rootProxy = createRootProxy({
      applicationEnvironment: null,
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationRouteTarget: async () => {
        targetCalls += 1;
        return routeTarget;
      },
      runMicrofrontendsMiddleware: async () => NextResponse.next(),
    });

    const response = await rootProxy(request);

    expect(targetCalls).toBe(0);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  test("forwards the trusted bypass only upstream to the selected deployment", () => {
    const request = new NextRequest(
      `https://example.test${applicationPath}?view=summary`,
      { headers: { "x-vercel-protection-bypass": "attacker-value" } },
    );
    const response = rewriteToPluginApplicationDeployment({
      request,
      target: routeTarget,
      bypassSecret: "trusted-value",
    });

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `https://lets-assist-csf-v1.vercel.app${applicationPath}?view=summary`,
    );
    expect(response.headers.get("x-vercel-protection-bypass")).toBeNull();
    expect(
      response.headers.get("x-middleware-request-x-vercel-protection-bypass"),
    ).toBe("trusted-value");
    expect(
      response.headers.get(
        "x-middleware-request-x-lets-assist-plugin-runtime-version",
      ),
    ).toBe("1.2.7");
  });
});
