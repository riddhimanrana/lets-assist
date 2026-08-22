import { NextRequest, NextResponse } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";

import {
  CSF_APPLICATION_RUNTIME_FLAG,
  getCsfApplicationOrganizationId,
  parsePluginApplicationRouteTarget,
  shouldRouteCsfApplication,
  type PluginApplicationRouteTarget,
} from "@/lib/plugins/application-routing";
import {
  updateSession,
  type AuthenticatedProxyContext,
  type ProxyOptions,
} from "@/lib/supabase/proxy";

const MICROFRONTENDS_CLIENT_CONFIG_PATH =
  "/.well-known/vercel/microfrontends/client-config";

type RootProxyDependencies = {
  updateSession: (
    request: NextRequest,
    options?: ProxyOptions,
  ) => Promise<NextResponse>;
  runMicrofrontendsMiddleware: typeof runMicrofrontendsMiddleware;
  readCsfApplicationRouteTarget: (
    context: AuthenticatedProxyContext,
    organizationId: string,
  ) => Promise<PluginApplicationRouteTarget | null>;
  applicationDeploymentBypassSecret?: string;
};

export async function readCsfApplicationRouteTarget(
  context: AuthenticatedProxyContext,
  organizationIdentifier: string,
  environment: "development" | "production" = process.env.VERCEL_ENV ===
  "production"
    ? "production"
    : "development",
): Promise<PluginApplicationRouteTarget | null> {
  const { data, error } = await context.supabase.rpc(
    "get_plugin_application_route_target_by_identifier",
    {
      p_organization_identifier: organizationIdentifier,
      p_plugin_key: "dvhs-csf",
      p_environment: environment,
    },
  );

  return error ? null : parsePluginApplicationRouteTarget(data);
}

function withoutLocalFlagOverride(request: NextRequest): NextRequest {
  if (!request.headers.has("x-vercel-mfe-flag-value")) return request;

  request.headers.delete("x-vercel-mfe-flag-value");
  return request;
}

export function rewriteToPluginApplicationDeployment(input: {
  request: NextRequest;
  target: PluginApplicationRouteTarget;
  bypassSecret?: string;
}): NextResponse {
  const destination = new URL(
    `${input.request.nextUrl.pathname}${input.request.nextUrl.search}`,
    input.target.deploymentUrl,
  );
  const requestHeaders = new Headers(input.request.headers);
  requestHeaders.delete("x-vercel-protection-bypass");
  requestHeaders.set(
    "x-lets-assist-plugin-runtime-version",
    input.target.runtimeVersion,
  );
  requestHeaders.set(
    "x-lets-assist-plugin-deployment-id",
    input.target.deploymentId,
  );
  if (input.bypassSecret) {
    requestHeaders.set("x-vercel-protection-bypass", input.bypassSecret);
  }

  return NextResponse.rewrite(destination, {
    request: { headers: requestHeaders },
  });
}

export function createRootProxy(
  dependencies: RootProxyDependencies,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request) => {
    if (request.nextUrl.pathname === MICROFRONTENDS_CLIENT_CONFIG_PATH) {
      const response = await dependencies.runMicrofrontendsMiddleware({
        request: withoutLocalFlagOverride(request),
        flagValues: {
          [CSF_APPLICATION_RUNTIME_FLAG]: async () => false,
        },
      });
      const resolved = response
        ? new NextResponse(response.body, response)
        : NextResponse.next();
      resolved.headers.set("Cache-Control", "private, no-store");
      return resolved;
    }

    return dependencies.updateSession(request, {
      onAuthenticatedPassThrough: async (context) => {
        const organizationId = getCsfApplicationOrganizationId(
          request.nextUrl.pathname,
        );
        if (!organizationId) return null;

        const routeTarget = await dependencies.readCsfApplicationRouteTarget(
          context,
          organizationId,
        );
        if (
          !shouldRouteCsfApplication({
            pathname: request.nextUrl.pathname,
            routeTargetAvailable: routeTarget !== null,
          })
        ) {
          return null;
        }

        return rewriteToPluginApplicationDeployment({
          target: routeTarget!,
          request: withoutLocalFlagOverride(request),
          bypassSecret: dependencies.applicationDeploymentBypassSecret,
        });
      },
    });
  };
}

export const proxy = createRootProxy({
  updateSession,
  runMicrofrontendsMiddleware,
  readCsfApplicationRouteTarget,
  applicationDeploymentBypassSecret:
    process.env.PLUGIN_APPLICATION_DEPLOYMENT_BYPASS_SECRET,
});

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
