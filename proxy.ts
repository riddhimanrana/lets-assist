import { NextRequest, NextResponse } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";

import {
  CSF_APPLICATION_RUNTIME_FLAG,
  getCsfApplicationOrganizationId,
  parsePluginApplicationRouteTarget,
  type PluginApplicationRouteTarget,
} from "@/lib/plugins/application-routing";
import {
  resolveLocalPluginApplicationUrl,
  resolvePluginApplicationDeploymentBypassSecret,
  resolvePluginApplicationEnvironment,
  type PluginApplicationEnvironment,
} from "@/lib/plugins/application-environment";
import {
  updateSession,
  type AuthenticatedProxyContext,
  type ProxyOptions,
} from "@/lib/supabase/proxy";

const MICROFRONTENDS_CLIENT_CONFIG_PATH =
  "/.well-known/vercel/microfrontends/client-config";
const CSF_APPLICATION_ASSET_PREFIX = "/vc-ap-5431dc/";

type RootProxyDependencies = {
  updateSession: (
    request: NextRequest,
    options?: ProxyOptions,
  ) => Promise<NextResponse>;
  runMicrofrontendsMiddleware: typeof runMicrofrontendsMiddleware;
  readCsfApplicationRouteTarget: (
    context: AuthenticatedProxyContext,
    organizationId: string,
    environment: PluginApplicationEnvironment,
  ) => Promise<PluginApplicationRouteTarget | null>;
  readCsfLocalApplicationRouteTarget: (
    context: AuthenticatedProxyContext,
    organizationId: string,
    localApplicationUrl: string,
  ) => Promise<PluginApplicationRouteTarget | null>;
  applicationEnvironment: PluginApplicationEnvironment | null;
  localApplicationUrl: string | null;
  applicationDeploymentBypassSecret?: string;
};

const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function readCsfApplicationRouteTarget(
  context: AuthenticatedProxyContext,
  organizationIdentifier: string,
  environment: PluginApplicationEnvironment | null = resolvePluginApplicationEnvironment(),
): Promise<PluginApplicationRouteTarget | null> {
  if (!environment) return null;

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

export async function readCsfLocalApplicationRouteTarget(
  context: AuthenticatedProxyContext,
  organizationIdentifier: string,
  localApplicationUrl: string,
): Promise<PluginApplicationRouteTarget | null> {
  if (localApplicationUrl !== "http://127.0.0.1:3001") return null;

  let organizationId = organizationIdentifier;
  if (!ORGANIZATION_ID_PATTERN.test(organizationIdentifier)) {
    const { data: organization, error: organizationError } =
      await context.supabase
        .from("organizations")
        .select("id")
        .eq("username", organizationIdentifier)
        .maybeSingle();
    if (organizationError || !organization?.id) return null;
    organizationId = organization.id;
  }

  const { data: flag, error: flagError } = await context.supabase
    .from("organization_plugin_feature_flags")
    .select("enabled, metadata")
    .eq("organization_id", organizationId)
    .eq("plugin_key", "dvhs-csf")
    .eq("flag_key", "application-runtime")
    .maybeSingle();
  const metadata = flag?.metadata as Record<string, unknown> | undefined;
  const runtimeVersion = metadata?.runtimeVersion;
  if (
    flagError ||
    flag?.enabled !== true ||
    metadata?.environment !== "development" ||
    typeof runtimeVersion !== "string" ||
    runtimeVersion.length === 0
  ) {
    return null;
  }

  return {
    deploymentId: `local-${runtimeVersion}`,
    deploymentUrl: localApplicationUrl,
    runtimeVersion,
  };
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
    if (
      request.nextUrl.pathname.startsWith(CSF_APPLICATION_ASSET_PREFIX) &&
      dependencies.localApplicationUrl
    ) {
      return NextResponse.rewrite(
        new URL(
          `${request.nextUrl.pathname}${request.nextUrl.search}`,
          dependencies.localApplicationUrl,
        ),
      );
    }
    if (
      request.nextUrl.pathname === MICROFRONTENDS_CLIENT_CONFIG_PATH ||
      request.nextUrl.pathname.startsWith(CSF_APPLICATION_ASSET_PREFIX)
    ) {
      const response = await dependencies.runMicrofrontendsMiddleware({
        request: withoutLocalFlagOverride(request),
        flagValues: {
          [CSF_APPLICATION_RUNTIME_FLAG]: async () => false,
        },
      });
      const resolved = response
        ? new NextResponse(response.body, response)
        : NextResponse.next();
      if (request.nextUrl.pathname === MICROFRONTENDS_CLIENT_CONFIG_PATH) {
        resolved.headers.set("Cache-Control", "private, no-store");
      }
      return resolved;
    }

    return dependencies.updateSession(request, {
      onAuthenticatedPassThrough: async (context) => {
        const organizationId = getCsfApplicationOrganizationId(
          request.nextUrl.pathname,
        );
        if (
          !organizationId ||
          (!dependencies.applicationEnvironment &&
            !dependencies.localApplicationUrl)
        ) {
          return null;
        }

        const routeTarget = dependencies.applicationEnvironment
          ? await dependencies.readCsfApplicationRouteTarget(
              context,
              organizationId,
              dependencies.applicationEnvironment,
            )
          : await dependencies.readCsfLocalApplicationRouteTarget(
              context,
              organizationId,
              dependencies.localApplicationUrl!,
            );
        if (!routeTarget) return null;

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
  readCsfLocalApplicationRouteTarget,
  applicationEnvironment: resolvePluginApplicationEnvironment(),
  localApplicationUrl: resolveLocalPluginApplicationUrl(),
  applicationDeploymentBypassSecret:
    resolvePluginApplicationDeploymentBypassSecret(),
});

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
