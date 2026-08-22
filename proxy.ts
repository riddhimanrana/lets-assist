import { NextRequest, NextResponse } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";

import {
  CSF_APPLICATION_RUNTIME_DATABASE_FLAG,
  CSF_APPLICATION_RUNTIME_FLAG,
  getCsfApplicationOrganizationId,
  shouldRouteCsfApplication,
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
  readCsfApplicationFlag: (
    context: AuthenticatedProxyContext,
    organizationId: string,
  ) => Promise<boolean>;
};

const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function readCsfApplicationFlag(
  context: AuthenticatedProxyContext,
  organizationIdentifier: string,
): Promise<boolean> {
  let organizationId = organizationIdentifier;

  if (!ORGANIZATION_ID_PATTERN.test(organizationIdentifier)) {
    const { data: organization, error: organizationError } =
      await context.supabase
        .from("organizations")
        .select("id")
        .eq("username", organizationIdentifier)
        .maybeSingle();

    if (organizationError || !organization?.id) return false;
    organizationId = organization.id;
  }

  const { data, error } = await context.supabase
    .from("organization_plugin_feature_flags")
    .select("enabled")
    .eq("organization_id", organizationId)
    .eq("plugin_key", "dvhs-csf")
    .eq("flag_key", CSF_APPLICATION_RUNTIME_DATABASE_FLAG)
    .maybeSingle();

  return !error && data?.enabled === true;
}

function withoutLocalFlagOverride(request: NextRequest): NextRequest {
  if (!request.headers.has("x-vercel-mfe-flag-value")) return request;

  request.headers.delete("x-vercel-mfe-flag-value");
  return request;
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

        const featureFlagEnabled = await dependencies.readCsfApplicationFlag(
          context,
          organizationId,
        );
        if (
          !shouldRouteCsfApplication({
            pathname: request.nextUrl.pathname,
            featureFlagEnabled,
          })
        ) {
          return null;
        }

        const response = await dependencies.runMicrofrontendsMiddleware({
          request: withoutLocalFlagOverride(request),
          flagValues: {
            [CSF_APPLICATION_RUNTIME_FLAG]: async () => true,
          },
        });
        return response ? new NextResponse(response.body, response) : null;
      },
    });
  };
}

export const proxy = createRootProxy({
  updateSession,
  runMicrofrontendsMiddleware,
  readCsfApplicationFlag,
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
