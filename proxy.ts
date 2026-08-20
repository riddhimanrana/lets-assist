import { type NextRequest } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";

import {
  CSF_APPLICATION_RUNTIME_FLAG,
  shouldRouteCsfApplication,
} from "@/lib/plugins/application-routing";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const routeToCsfApplication = shouldRouteCsfApplication({
    pathname: request.nextUrl.pathname,
    enabled: process.env.CSF_APPLICATION_MICROFRONTEND_ENABLED,
    organizationIds: process.env.CSF_APPLICATION_MICROFRONTEND_ORGANIZATION_IDS,
  });
  const microfrontendResponse = await runMicrofrontendsMiddleware({
    request,
    flagValues: {
      [CSF_APPLICATION_RUNTIME_FLAG]: async () => routeToCsfApplication,
    },
  });
  if (microfrontendResponse) return microfrontendResponse;

  return await updateSession(request);
}

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
