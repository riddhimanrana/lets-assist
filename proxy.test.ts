import { describe, expect, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

import type { AuthenticatedProxyContext } from "@/lib/supabase/proxy";

import {
  config,
  createRootProxy,
  readCsfApplicationAssetRouteTarget,
  readCsfLocalApplicationRouteTarget,
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

const defaultDependencies = {
  applicationEnvironment: "development" as const,
  applicationDeploymentBypassSecret: "fixture-bypass",
  localApplicationUrl: null,
  readCsfApplicationRouteTarget: async () => null,
  readCsfApplicationAssetRouteTarget: async () => null,
  readCsfLocalApplicationRouteTarget: async () => null,
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

  test("reads an exact caller-scoped asset deployment target", async () => {
    const calls: Array<{ functionName: string; parameters: unknown }> = [];
    const supabase = {
      async rpc(functionName: string, parameters: unknown) {
        calls.push({ functionName, parameters });
        return { data: { routable: true, ...routeTarget }, error: null };
      },
    };

    const target = await readCsfApplicationAssetRouteTarget(
      {
        request: new NextRequest(`https://example.test${applicationPath}`),
        userId: "11111111-1111-4111-8111-111111111111",
        supabase: supabase as never,
      },
      "dvhighcsf",
      "development",
      "dpl_selected_v1",
    );

    expect(target).toEqual(routeTarget);
    expect(calls).toEqual([
      {
        functionName: "get_plugin_application_asset_route_target_by_identifier",
        parameters: {
          p_deployment_id: "dpl_selected_v1",
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

  test("reads the selected runtime for the isolated local child", async () => {
    const queries: Array<{ table: string; filters: Array<[string, string]> }> =
      [];
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
              return {
                data: { id: "22222222-2222-4222-8222-222222222222" },
                error: null,
              };
            }
            return {
              data: {
                enabled: true,
                metadata: {
                  environment: "development",
                  runtimeVersion: "1.2.7",
                },
              },
              error: null,
            };
          },
        };
        return builder;
      },
    };

    expect(
      await readCsfLocalApplicationRouteTarget(
        {
          request: new NextRequest(`http://127.0.0.1:3000${applicationPath}`),
          userId: "11111111-1111-4111-8111-111111111111",
          supabase: supabase as never,
        },
        "dvhighcsf",
        "http://127.0.0.1:3001",
      ),
    ).toEqual({
      deploymentId: "local-1.2.7",
      deploymentUrl: "http://127.0.0.1:3001",
      runtimeVersion: "1.2.7",
    });
    expect(queries.map((query) => query.table)).toEqual([
      "organizations",
      "organization_plugin_feature_flags",
    ]);
  });

  test("finishes host auth before routing and preserves auth response policy", async () => {
    const events: string[] = [];
    const request = new NextRequest(`https://example.test${applicationPath}`, {
      headers: { "x-vercel-mfe-flag-value": "true" },
    });
    const rootProxy = createRootProxy({
      ...defaultDependencies,
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
    expect(response.cookies.get("la-csf-asset-dpl_selected_v1")?.value).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  test("never evaluates child routing when host auth redirects", async () => {
    let childCalls = 0;
    const rootProxy = createRootProxy({
      ...defaultDependencies,
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
      ...defaultDependencies,
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

  test("keeps every hosted environment in the host without a protection bypass", async () => {
    for (const applicationEnvironment of [
      "development",
      "production",
    ] as const) {
      let targetCalls = 0;
      const request = new NextRequest(`https://example.test${applicationPath}`);
      const rootProxy = createRootProxy({
        ...defaultDependencies,
        applicationEnvironment,
        applicationDeploymentBypassSecret: undefined,
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

      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(targetCalls).toBe(0);
    }
  });

  test("serves the required client config without exposing active routes", async () => {
    let authCalls = 0;
    let resolvedFlag = true;
    const rootProxy = createRootProxy({
      ...defaultDependencies,
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
      localApplicationUrl: null,
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationRouteTarget: async () => {
        targetCalls += 1;
        return routeTarget;
      },
      readCsfApplicationAssetRouteTarget: async () => {
        targetCalls += 1;
        return routeTarget;
      },
      readCsfLocalApplicationRouteTarget: async () => {
        targetCalls += 1;
        return routeTarget;
      },
      runMicrofrontendsMiddleware: async () => NextResponse.next(),
    });

    const response = await rootProxy(request);

    expect(targetCalls).toBe(0);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  test("routes an enabled isolated fixture to the loopback child", async () => {
    const request = new NextRequest(`http://127.0.0.1:3000${applicationPath}`);
    const rootProxy = createRootProxy({
      applicationEnvironment: null,
      localApplicationUrl: "http://127.0.0.1:3001",
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationRouteTarget: async () => null,
      readCsfApplicationAssetRouteTarget: async () => null,
      readCsfLocalApplicationRouteTarget: async () => ({
        deploymentId: "local-1.2.7",
        deploymentUrl: "http://127.0.0.1:3001",
        runtimeVersion: "1.2.7",
      }),
      runMicrofrontendsMiddleware: async () => NextResponse.next(),
    });

    const response = await rootProxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `http://127.0.0.1:3001${applicationPath}`,
    );
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

  test("preserves asset routing for historical mixed-case organization usernames", () => {
    const request = new NextRequest(
      "https://example.test/organization/SchoolClub/plugins/dvhs-csf/access-proof",
    );
    const response = rewriteToPluginApplicationDeployment({
      request,
      target: routeTarget,
      bypassSecret: "trusted-value",
      assetOrganizationIdentifier: "SchoolClub",
    });

    expect(response.cookies.get("la-csf-asset-dpl_selected_v1")?.value).toBe(
      "SchoolClub",
    );
  });

  test("routes namespaced assets to the deployment selected for their document", async () => {
    const assetPath = "/vc-ap-5431dc/_next/static/chunks/app/access-proof.js";
    const request = new NextRequest(
      `https://example.test${assetPath}?dpl=dpl_selected_v1`,
      {
        headers: { referer: `https://example.test${applicationPath}` },
      },
    );
    let authCalls = 0;
    let microfrontendCalls = 0;
    const rootProxy = createRootProxy({
      ...defaultDependencies,
      updateSession: async (authRequest, options) => {
        authCalls += 1;
        return (
          (await options?.onAuthenticatedPassThrough?.(
            authenticatedContext(authRequest),
          )) ?? NextResponse.next()
        );
      },
      readCsfApplicationAssetRouteTarget: async (
        _context,
        organizationId,
        _environment,
        deploymentId,
      ) => {
        expect(organizationId).toBe("22222222-2222-4222-8222-222222222222");
        expect(deploymentId).toBe("dpl_selected_v1");
        return routeTarget;
      },
      runMicrofrontendsMiddleware: async () => {
        microfrontendCalls += 1;
        return NextResponse.next();
      },
    });

    const response = await rootProxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `https://lets-assist-csf-v1.vercel.app${assetPath}?dpl=dpl_selected_v1`,
    );
    expect(authCalls).toBe(1);
    expect(microfrontendCalls).toBe(0);
  });

  test("does not route an asset without a same-origin CSF document", async () => {
    const assetPath = "/vc-ap-5431dc/_next/static/chunks/app/access-proof.js";
    let targetCalls = 0;
    let microfrontendCalls = 0;
    const rootProxy = createRootProxy({
      ...defaultDependencies,
      updateSession: async () => NextResponse.next(),
      readCsfApplicationRouteTarget: async () => {
        targetCalls += 1;
        return routeTarget;
      },
      readCsfApplicationAssetRouteTarget: async () => {
        targetCalls += 1;
        return routeTarget;
      },
      runMicrofrontendsMiddleware: async () => {
        microfrontendCalls += 1;
        return NextResponse.next();
      },
    });

    const response = await rootProxy(
      new NextRequest(`https://example.test${assetPath}`, {
        headers: { referer: "https://attacker.example.test/page" },
      }),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(targetCalls).toBe(0);
    expect(microfrontendCalls).toBe(0);
  });

  test("blocks an asset when current authorization rejects its deployment", async () => {
    const assetPath = "/vc-ap-5431dc/_next/static/chunks/app/revoked.js";
    const rootProxy = createRootProxy({
      ...defaultDependencies,
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationAssetRouteTarget: async () => null,
      runMicrofrontendsMiddleware: async () => NextResponse.next(),
    });

    const response = await rootProxy(
      new NextRequest(`https://example.test${assetPath}?dpl=dpl_selected_v1`, {
        headers: { referer: `https://example.test${applicationPath}` },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("preserves the selected deployment across nested asset requests", async () => {
    const assetPath = "/vc-ap-5431dc/_next/static/chunks/app/nested.js";
    const organizationId = "22222222-2222-4222-8222-222222222222";
    const selectedOrganizations: string[] = [];
    const rootProxy = createRootProxy({
      ...defaultDependencies,
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationAssetRouteTarget: async (
        _context,
        identifier,
        _environment,
        deploymentId,
      ) => {
        selectedOrganizations.push(identifier);
        expect(deploymentId).toBe("dpl_selected_v1");
        return routeTarget;
      },
      runMicrofrontendsMiddleware: async () => NextResponse.next(),
    });

    const response = await rootProxy(
      new NextRequest(`https://example.test${assetPath}?dpl=dpl_selected_v1`, {
        headers: {
          cookie: `la-csf-asset-dpl_selected_v1=${organizationId}`,
          referer:
            "https://example.test/vc-ap-5431dc/_next/static/chunks/app/parent.js?dpl=dpl_selected_v1",
        },
      }),
    );

    expect(selectedOrganizations).toEqual([organizationId]);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `https://lets-assist-csf-v1.vercel.app${assetPath}?dpl=dpl_selected_v1`,
    );
    expect(response.cookies.get("la-csf-asset-dpl_selected_v1")?.value).toBe(
      organizationId,
    );
  });

  test("keeps deployment contexts independent across organization tabs", async () => {
    const organizationId = "22222222-2222-4222-8222-222222222222";
    const oldTarget = {
      deploymentId: "dpl_oldVersion",
      deploymentUrl: "https://lets-assist-csf-old.vercel.app",
      runtimeVersion: "1.2.6",
    };
    const rootProxy = createRootProxy({
      ...defaultDependencies,
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationAssetRouteTarget: async (
        _context,
        identifier,
        _environment,
        deploymentId,
      ) => {
        expect(identifier).toBe(organizationId);
        return deploymentId === oldTarget.deploymentId
          ? oldTarget
          : routeTarget;
      },
      runMicrofrontendsMiddleware: async () => NextResponse.next(),
    });

    const response = await rootProxy(
      new NextRequest(
        "https://example.test/vc-ap-5431dc/_next/static/chunks/app/old.js?dpl=dpl_oldVersion",
        {
          headers: {
            cookie: [
              `la-csf-asset-dpl_oldVersion=${organizationId}`,
              "la-csf-asset-dpl_selected_v1=another-organization",
            ].join("; "),
            referer:
              "https://example.test/vc-ap-5431dc/_next/static/chunks/app/parent.js?dpl=dpl_oldVersion",
          },
        },
      ),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://lets-assist-csf-old.vercel.app/vc-ap-5431dc/_next/static/chunks/app/old.js?dpl=dpl_oldVersion",
    );
  });

  test("routes old-page actions to the deployment that rendered the page", async () => {
    const oldTarget = {
      deploymentId: "dpl_oldVersion",
      deploymentUrl: "https://lets-assist-csf-old.vercel.app",
      runtimeVersion: "1.2.6",
    };
    let selectedTargetCalls = 0;
    const rootProxy = createRootProxy({
      ...defaultDependencies,
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationRouteTarget: async () => {
        selectedTargetCalls += 1;
        return routeTarget;
      },
      readCsfApplicationAssetRouteTarget: async (
        _context,
        identifier,
        environment,
        deploymentId,
      ) => {
        expect(identifier).toBe("22222222-2222-4222-8222-222222222222");
        expect(environment).toBe("development");
        expect(deploymentId).toBe(oldTarget.deploymentId);
        return oldTarget;
      },
      runMicrofrontendsMiddleware: async () => NextResponse.next(),
    });

    const response = await rootProxy(
      new NextRequest(`https://example.test${applicationPath}`, {
        method: "POST",
        headers: {
          "next-action": "old-action-id",
          "x-deployment-id": oldTarget.deploymentId,
          referer: `https://example.test${applicationPath}`,
        },
      }),
    );

    expect(selectedTargetCalls).toBe(0);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `${oldTarget.deploymentUrl}${applicationPath}`,
    );
  });

  test("blocks old-page actions when the historical deployment is no longer authorized", async () => {
    const rootProxy = createRootProxy({
      ...defaultDependencies,
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationAssetRouteTarget: async () => null,
      runMicrofrontendsMiddleware: async () => NextResponse.next(),
    });

    const response = await rootProxy(
      new NextRequest(`https://example.test${applicationPath}`, {
        method: "POST",
        headers: {
          "next-action": "old-action-id",
          "x-deployment-id": "dpl_oldVersion",
          referer: `https://example.test${applicationPath}`,
        },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  test("ignores the host deployment ID on client navigation into the child", async () => {
    let selectedTargetCalls = 0;
    let exactTargetCalls = 0;
    const rootProxy = createRootProxy({
      ...defaultDependencies,
      updateSession: async (authRequest, options) =>
        (await options?.onAuthenticatedPassThrough?.(
          authenticatedContext(authRequest),
        )) ?? NextResponse.next(),
      readCsfApplicationRouteTarget: async () => {
        selectedTargetCalls += 1;
        return routeTarget;
      },
      readCsfApplicationAssetRouteTarget: async () => {
        exactTargetCalls += 1;
        return null;
      },
      runMicrofrontendsMiddleware: async () => NextResponse.next(),
    });

    const response = await rootProxy(
      new NextRequest(`https://example.test${applicationPath}`, {
        headers: {
          "x-deployment-id": "dpl_hostDeployment",
          referer:
            "https://example.test/organization/22222222-2222-4222-8222-222222222222",
        },
      }),
    );

    expect(selectedTargetCalls).toBe(1);
    expect(exactTargetCalls).toBe(0);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `${routeTarget.deploymentUrl}${applicationPath}`,
    );
  });

  test("matches the complete child namespace while excluding host assets", () => {
    expect(config.matcher).toEqual([
      "/vc-ap-5431dc/:path*",
      "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    ]);
  });

  test("routes namespaced assets directly to the owned isolated child", async () => {
    const assetPath = "/vc-ap-5431dc/_next/static/chunks/main-app.js";
    let authCalls = 0;
    let microfrontendCalls = 0;
    const rootProxy = createRootProxy({
      ...defaultDependencies,
      applicationEnvironment: null,
      localApplicationUrl: "http://127.0.0.1:3001",
      updateSession: async () => {
        authCalls += 1;
        return NextResponse.next();
      },
      readCsfApplicationRouteTarget: async () => null,
      runMicrofrontendsMiddleware: async () => {
        microfrontendCalls += 1;
        return NextResponse.next();
      },
    });

    const response = await rootProxy(
      new NextRequest(`http://127.0.0.1:3000${assetPath}?v=fixture`),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `http://127.0.0.1:3001${assetPath}?v=fixture`,
    );
    expect(authCalls).toBe(0);
    expect(microfrontendCalls).toBe(0);
  });

  test("keeps ordinary host static assets in the host", async () => {
    const hostAsset = new NextRequest(
      "https://example.test/_next/static/chunks/app/layout.js",
    );
    let authCalls = 0;
    const rootProxy = createRootProxy({
      ...defaultDependencies,
      updateSession: async () => {
        authCalls += 1;
        return NextResponse.next();
      },
      readCsfApplicationRouteTarget: async () => routeTarget,
      runMicrofrontendsMiddleware: async () => NextResponse.next(),
    });

    expect(
      (await rootProxy(hostAsset)).headers.get("x-middleware-rewrite"),
    ).toBeNull();
    expect(authCalls).toBe(1);
  });
});
