import { describe, expect, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

import type { AuthenticatedProxyContext } from "@/lib/supabase/proxy";

import { createRootProxy, readCsfApplicationFlag } from "./proxy";

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
  test("resolves an organization username before reading its application flag", async () => {
    const queries: Array<{
      table: string;
      filters: Array<[string, string]>;
    }> = [];
    const organizationId = "22222222-2222-4222-8222-222222222222";
    const supabase = {
      from(table: string) {
        const query = { table, filters: [] as Array<[string, string]> };
        queries.push(query);
        const builder = {
          select() {
            return builder;
          },
          eq(column: string, value: string) {
            query.filters.push([column, value]);
            return builder;
          },
          async maybeSingle() {
            if (table === "organizations") {
              return { data: { id: organizationId }, error: null };
            }
            return { data: { enabled: true }, error: null };
          },
        };
        return builder;
      },
    };

    const enabled = await readCsfApplicationFlag(
      {
        request: new NextRequest(`https://example.test${applicationPath}`),
        userId: "11111111-1111-4111-8111-111111111111",
        supabase: supabase as never,
      },
      "dvhighcsf",
    );

    expect(enabled).toBe(true);
    expect(queries).toEqual([
      {
        table: "organizations",
        filters: [["username", "dvhighcsf"]],
      },
      {
        table: "organization_plugin_feature_flags",
        filters: [
          ["organization_id", organizationId],
          ["plugin_key", "dvhs-csf"],
          ["flag_key", "application-runtime"],
        ],
      },
    ]);
  });

  test("fails closed when an organization username cannot be resolved", async () => {
    let featureFlagReads = 0;
    const supabase = {
      from(table: string) {
        if (table === "organization_plugin_feature_flags") {
          featureFlagReads += 1;
        }
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          async maybeSingle() {
            return { data: null, error: null };
          },
        };
        return builder;
      },
    };

    const enabled = await readCsfApplicationFlag(
      {
        request: new NextRequest(`https://example.test${applicationPath}`),
        userId: "11111111-1111-4111-8111-111111111111",
        supabase: supabase as never,
      },
      "missing-organization",
    );

    expect(enabled).toBe(false);
    expect(featureFlagReads).toBe(0);
  });

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
