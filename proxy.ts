import { NextRequest, NextResponse } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";

import {
  CSF_APPLICATION_RUNTIME_FLAG,
  getCsfApplicationOrganizationId,
  isCsfApplicationPath,
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
const CSF_APPLICATION_ASSET_COOKIE_PREFIX = "la-csf-asset-";
const VERCEL_DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9_]{1,195}$/u;

function blockPluginApplicationRequest(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isCsfOrganizationIdentifier(value: string): boolean {
  if (ORGANIZATION_ID_PATTERN.test(value)) return true;
  return (
    /^[a-z0-9_.-]{3,32}$/iu.test(value) &&
    !value.startsWith(".") &&
    !value.endsWith(".") &&
    !value.includes("..")
  );
}

function getCsfAssetCookieName(deploymentId: string): string | null {
  return VERCEL_DEPLOYMENT_ID_PATTERN.test(deploymentId)
    ? `${CSF_APPLICATION_ASSET_COOKIE_PREFIX}${deploymentId}`
    : null;
}

function getCsfRequestDeploymentId(request: NextRequest): string | null {
  const deploymentId = request.headers.get("x-deployment-id");
  return deploymentId && VERCEL_DEPLOYMENT_ID_PATTERN.test(deploymentId)
    ? deploymentId
    : null;
}

function requestOriginatedFromCsfApplication(request: NextRequest): boolean {
  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    const refererUrl = new URL(referer);
    return (
      refererUrl.origin === request.nextUrl.origin &&
      isCsfApplicationPath(refererUrl.pathname)
    );
  } catch {
    return false;
  }
}

function getCsfAssetRouteContext(
  request: NextRequest,
): { organizationIdentifier: string; deploymentId: string } | null {
  const deploymentId = request.nextUrl.searchParams.get("dpl");
  const cookieName = deploymentId ? getCsfAssetCookieName(deploymentId) : null;
  if (!deploymentId || !cookieName) return null;

  const referer = request.headers.get("referer");
  if (!referer) return null;

  try {
    const refererUrl = new URL(referer);
    if (refererUrl.origin !== request.nextUrl.origin) return null;

    const identifier = getCsfApplicationOrganizationId(refererUrl.pathname);
    if (identifier && isCsfOrganizationIdentifier(identifier)) {
      return { organizationIdentifier: identifier, deploymentId };
    }

    if (refererUrl.pathname.startsWith(CSF_APPLICATION_ASSET_PREFIX)) {
      if (refererUrl.searchParams.get("dpl") !== deploymentId) return null;
      const cookie = request.cookies.get(cookieName)?.value;
      if (cookie && isCsfOrganizationIdentifier(cookie)) {
        return { organizationIdentifier: cookie, deploymentId };
      }
    }
  } catch {
    return null;
  }

  return null;
}

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
  readCsfApplicationAssetRouteTarget: (
    context: AuthenticatedProxyContext,
    organizationId: string,
    environment: PluginApplicationEnvironment,
    deploymentId: string,
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

export async function readCsfApplicationAssetRouteTarget(
  context: AuthenticatedProxyContext,
  organizationIdentifier: string,
  environment: PluginApplicationEnvironment,
  deploymentId: string,
): Promise<PluginApplicationRouteTarget | null> {
  if (!getCsfAssetCookieName(deploymentId)) return null;

  const { data, error } = await context.supabase.rpc(
    "get_plugin_application_asset_route_target_by_identifier",
    {
      p_organization_identifier: organizationIdentifier,
      p_plugin_key: "dvhs-csf",
      p_environment: environment,
      p_deployment_id: deploymentId,
    },
  );
  const target = error ? null : parsePluginApplicationRouteTarget(data);
  return target?.deploymentId === deploymentId ? target : null;
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
  assetOrganizationIdentifier?: string;
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

  const response = NextResponse.rewrite(destination, {
    request: { headers: requestHeaders },
  });
  if (
    input.assetOrganizationIdentifier &&
    isCsfOrganizationIdentifier(input.assetOrganizationIdentifier)
  ) {
    const cookieName = getCsfAssetCookieName(input.target.deploymentId);
    if (cookieName) {
      response.cookies.set(cookieName, input.assetOrganizationIdentifier, {
        httpOnly: true,
        path: CSF_APPLICATION_ASSET_PREFIX,
        sameSite: "strict",
        secure: input.request.nextUrl.protocol === "https:",
      });
    }
  }
  return response;
}

export function createRootProxy(
  dependencies: RootProxyDependencies,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request) => {
    if (request.nextUrl.pathname.startsWith(CSF_APPLICATION_ASSET_PREFIX)) {
      if (dependencies.localApplicationUrl) {
        return NextResponse.rewrite(
          new URL(
            `${request.nextUrl.pathname}${request.nextUrl.search}`,
            dependencies.localApplicationUrl,
          ),
        );
      }
      if (
        !dependencies.applicationEnvironment ||
        !dependencies.applicationDeploymentBypassSecret
      ) {
        return blockPluginApplicationRequest();
      }

      const routeContext = getCsfAssetRouteContext(request);
      if (!routeContext) return blockPluginApplicationRequest();

      const response = await dependencies.updateSession(request, {
        onAuthenticatedPassThrough: async (context) => {
          const target = await dependencies.readCsfApplicationAssetRouteTarget(
            context,
            routeContext.organizationIdentifier,
            dependencies.applicationEnvironment!,
            routeContext.deploymentId,
          );
          if (!target) return blockPluginApplicationRequest();

          return rewriteToPluginApplicationDeployment({
            request: withoutLocalFlagOverride(request),
            target,
            bypassSecret: dependencies.applicationDeploymentBypassSecret,
            assetOrganizationIdentifier: routeContext.organizationIdentifier,
          });
        },
      });

      return response.headers.get("x-middleware-next") === "1"
        ? blockPluginApplicationRequest()
        : response;
    }
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
        if (
          dependencies.applicationEnvironment &&
          !dependencies.applicationDeploymentBypassSecret
        ) {
          return null;
        }

        // Next client navigations carry the deployment ID of the page that
        // initiated them. Only a request from an existing child document may
        // use that value as a historical child pin. A host-side router.push
        // into this route carries the host deployment ID and must select the
        // organization's current child target instead.
        const childOrigin = requestOriginatedFromCsfApplication(request);
        const requestedDeploymentHeader = childOrigin
          ? request.headers.get("x-deployment-id")
          : null;
        const requestedDeploymentId = childOrigin
          ? getCsfRequestDeploymentId(request)
          : null;
        if (requestedDeploymentHeader && !requestedDeploymentId) {
          return blockPluginApplicationRequest();
        }

        const routeTarget = dependencies.applicationEnvironment
          ? requestedDeploymentId
            ? await dependencies.readCsfApplicationAssetRouteTarget(
                context,
                organizationId,
                dependencies.applicationEnvironment,
                requestedDeploymentId,
              )
            : await dependencies.readCsfApplicationRouteTarget(
                context,
                organizationId,
                dependencies.applicationEnvironment,
              )
          : await dependencies.readCsfLocalApplicationRouteTarget(
              context,
              organizationId,
              dependencies.localApplicationUrl!,
            );
        if (!routeTarget) {
          return requestedDeploymentId ? blockPluginApplicationRequest() : null;
        }

        return rewriteToPluginApplicationDeployment({
          target: routeTarget!,
          request: withoutLocalFlagOverride(request),
          bypassSecret: dependencies.applicationDeploymentBypassSecret,
          assetOrganizationIdentifier: organizationId,
        });
      },
    });
  };
}

export const proxy = createRootProxy({
  updateSession,
  runMicrofrontendsMiddleware,
  readCsfApplicationRouteTarget,
  readCsfApplicationAssetRouteTarget,
  readCsfLocalApplicationRouteTarget,
  applicationEnvironment: resolvePluginApplicationEnvironment(),
  localApplicationUrl: resolveLocalPluginApplicationUrl(),
  applicationDeploymentBypassSecret:
    resolvePluginApplicationDeploymentBypassSecret(),
});

export const config = {
  matcher: [
    // Admit every generated child asset, including files whose extensions are
    // excluded from the host's authentication matcher below.
    "/vc-ap-5431dc/:path*",
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (host static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
