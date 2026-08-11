import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { readOrganizationPluginContext } from "@/lib/plugins/organization-plugin-context";
import {
  hasOrganizationPluginRoleAccess,
  toOrganizationPluginAccessRole,
} from "@/lib/plugins/access-role";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { resolveOrganizationPluginByKey } from "@/lib/plugins/resolve-org-plugins";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  OrganizationPluginAccessRole,
  OrganizationPluginRouteDefinition,
  OrganizationPluginSurfaceAccessLevel,
} from "@/types";

type OrganizationRecord = {
  id: string;
  name: string;
  username: string | null;
};

type MembershipRow = {
  role: OrganizationPluginAccessRole;
};

type OrganizationPluginRouteRow = {
  route_path: string;
  label: string;
  title: string | null;
  description: string | null;
  minimum_role: OrganizationPluginAccessRole;
};

function hasPluginRouteAccess(
  minimumAccess: OrganizationPluginSurfaceAccessLevel | undefined,
  userRole: OrganizationPluginAccessRole,
) {
  return hasOrganizationPluginRoleAccess(userRole, minimumAccess);
}

function findPluginRoute(
  routes: OrganizationPluginRouteDefinition[] | undefined,
  routePath: string | null,
) {
  if (!routePath) return null;
  return (
    routes?.find((route) => route.path === routePath) ??
    routes
      ?.filter((route) => routePath.startsWith(`${route.path}/`))
      .sort((left, right) => right.path.length - left.path.length)
      .at(0) ??
    null
  );
}

function routeRowToDefinition(
  row: OrganizationPluginRouteRow | null,
): OrganizationPluginRouteDefinition | null {
  if (!row) return null;

  return {
    path: row.route_path,
    label: row.label,
    ...(row.title ? { title: row.title } : {}),
    ...(row.description ? { description: row.description } : {}),
    minimumRole: row.minimum_role,
  };
}

export async function renderOrganizationPluginPage(options: {
  organizationIdentifier: string;
  pluginKey: string;
  routePath?: string | null;
}): Promise<React.ReactElement> {
  const { organizationIdentifier, pluginKey, routePath = null } = options;
  const supabase = await createClient();
  const targetPath = routePath
    ? `/organization/${organizationIdentifier}/plugins/${pluginKey}/${routePath}`
    : `/organization/${organizationIdentifier}/plugins/${pluginKey}`;
  const { user } = await getAuthUser();

  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      organizationIdentifier,
    );

  const organization = await readOrganizationPluginContext<OrganizationRecord>(
    "organization",
    () => {
      const query = supabase.from("organizations").select("id, name, username");
      return isUUID
        ? query.eq("id", organizationIdentifier).maybeSingle()
        : query.eq("username", organizationIdentifier).maybeSingle();
    },
  );

  if (!organization) {
    notFound();
  }

  if (isUUID && organization.username) {
    const slugPath = routePath
      ? `/organization/${organization.username}/plugins/${pluginKey}/${routePath}`
      : `/organization/${organization.username}/plugins/${pluginKey}`;
    redirect(slugPath);
  }

  const definition = getRegisteredPlugin(pluginKey);
  if (!definition) {
    notFound();
  }

  let declaredRoute = findPluginRoute(definition.manifest.routes, routePath);
  const isPublicManifestRoute = declaredRoute?.minimumRole === "public";

  if (!user && !isPublicManifestRoute) {
    redirect(`/login?redirect=${encodeURIComponent(targetPath)}`);
  }

  const membership = user
    ? await readOrganizationPluginContext<MembershipRow>("membership", () =>
        supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", organization.id)
          .eq("user_id", user.id)
          .maybeSingle(),
      )
    : null;

  const userRole = toOrganizationPluginAccessRole(membership?.role ?? null);
  if (!userRole && !isPublicManifestRoute) {
    notFound();
  }
  const effectiveUserRole = userRole ?? "member";

  const resolvedPlugin = await resolveOrganizationPluginByKey({
    organizationId: organization.id,
    userRole: effectiveUserRole,
    pluginKey,
    failureMode: "throw",
  });

  if (!resolvedPlugin) {
    notFound();
  }

  const organizationSlug = organization.username ?? organization.id;

  if (routePath && !declaredRoute) {
    const routeClient = getAdminClient();
    const { data: orgRoute, error: orgRouteError } = (await routeClient
      .from("organization_plugin_routes")
      .select("route_path, label, title, description, minimum_role")
      .eq("organization_id", organization.id)
      .eq("plugin_key", pluginKey)
      .eq("route_path", routePath)
      .eq("enabled", true)
      .maybeSingle()) as {
      data: OrganizationPluginRouteRow | null;
      error: { code?: string; message?: string } | null;
    };

    if (orgRouteError) {
      const isMissingRouteTable =
        orgRouteError.code === "42P01" ||
        orgRouteError.code === "42703" ||
        orgRouteError.code === "PGRST205" ||
        orgRouteError.message?.toLowerCase().includes("schema cache");

      if (!isMissingRouteTable) {
        throw new Error(
          `Failed to load organization plugin route: ${orgRouteError.message}`,
        );
      }
    }

    declaredRoute = routeRowToDefinition(orgRoute);
    if (!declaredRoute) {
      notFound();
    }
  }

  if (
    declaredRoute &&
    !hasPluginRouteAccess(declaredRoute.minimumRole, effectiveUserRole)
  ) {
    notFound();
  }

  let pluginContent: ReactNode | null = null;
  if (routePath) {
    pluginContent =
      (await definition.renderOrganizationRoute?.(routePath, {
        organizationId: organization.id,
        organizationSlug,
        organizationName: organization.name,
        userRole: effectiveUserRole,
        configuration: resolvedPlugin.configuration,
      })) ?? null;
  } else if (definition.renderOrganizationPage) {
    pluginContent = await definition.renderOrganizationPage({
      organizationId: organization.id,
      organizationSlug,
      organizationName: organization.name,
      userRole: effectiveUserRole,
      configuration: resolvedPlugin.configuration,
    });
  }

  const routeTitle =
    declaredRoute?.title ?? declaredRoute?.label ?? resolvedPlugin.name;
  const routeDescription =
    declaredRoute?.description ?? resolvedPlugin.description;
  const useWorkspaceChrome =
    definition.manifest.organizationPageChrome === "workspace";

  return (
    <div
      className={
        useWorkspaceChrome
          ? "w-full"
          : "mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
      }
    >
      {!useWorkspaceChrome ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Organization Plugin</p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              {routePath ? routeTitle : resolvedPlugin.name}
            </h1>
            {routeDescription ? (
              <p className="text-muted-foreground mt-1 max-w-2xl">
                {routeDescription}
              </p>
            ) : null}
          </div>
          <Link href={`/organization/${organizationSlug}`}>
            <Button variant="outline">Back to organization</Button>
          </Link>
        </div>
      ) : null}

      {pluginContent ? (
        pluginContent
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Plugin shell is ready</CardTitle>
            <CardDescription>
              This plugin route is installed, but no renderer is registered yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Once you publish and register your private plugin package, its
            custom UI will render here.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
