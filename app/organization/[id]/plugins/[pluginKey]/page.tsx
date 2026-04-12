import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { resolveOrganizationPluginByKey } from "@/lib/plugins/resolve-org-plugins";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { OrganizationPluginAccessRole } from "@/types";

type Props = {
  params: Promise<{ id: string; pluginKey: string }>;
};

type OrganizationRecord = {
  id: string;
  name: string;
  username: string | null;
};

type MembershipRow = {
  role: OrganizationPluginAccessRole;
};

function toRole(value: string | null): OrganizationPluginAccessRole | null {
  if (value === "admin" || value === "staff" || value === "member") {
    return value;
  }
  return null;
}

export default async function OrganizationPluginPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id, pluginKey } = await params;
  const supabase = await createClient();
  const { user } = await getAuthUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/organization/${id}/plugins/${pluginKey}`)}`);
  }

  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  const orgByIdQuery = supabase
    .from("organizations")
    .select("id, name, username")
    .eq("id", id)
    .single();

  const orgByUsernameQuery = supabase
    .from("organizations")
    .select("id, name, username")
    .eq("username", id)
    .single();

  const { data: organization } = isUUID
    ? (await orgByIdQuery) as { data: OrganizationRecord | null }
    : (await orgByUsernameQuery) as { data: OrganizationRecord | null };

  if (!organization) {
    notFound();
  }

  if (isUUID && organization.username) {
    redirect(`/organization/${organization.username}/plugins/${pluginKey}`);
  }

  const { data: membership } = (await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organization.id)
    .eq("user_id", user.id)
    .single()) as { data: MembershipRow | null };

  const userRole = toRole(membership?.role ?? null);
  if (!userRole) {
    notFound();
  }

  const resolvedPlugin = await resolveOrganizationPluginByKey({
    organizationId: organization.id,
    userRole,
    pluginKey,
  });

  if (!resolvedPlugin) {
    notFound();
  }

  const definition = getRegisteredPlugin(pluginKey);
  if (!definition) {
    notFound();
  }

  const organizationSlug = organization.username ?? organization.id;

  const pluginContent = definition.renderOrganizationPage
    ? await definition.renderOrganizationPage({
        organizationId: organization.id,
        organizationSlug,
        organizationName: organization.name,
        userRole,
        configuration: resolvedPlugin.configuration,
      })
    : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Organization Plugin</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            {resolvedPlugin.name}
          </h1>
          {resolvedPlugin.description ? (
            <p className="text-muted-foreground mt-1 max-w-2xl">
              {resolvedPlugin.description}
            </p>
          ) : null}
        </div>
        <Link href={`/organization/${organizationSlug}`}>
          <Button variant="outline">Back to organization</Button>
        </Link>
      </div>

      {pluginContent ? (
        pluginContent
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Plugin shell is ready</CardTitle>
            <CardDescription>
              This plugin is installed, but no page renderer is registered yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Once you publish and register your private plugin package, its custom UI will
            render here.
          </CardContent>
        </Card>
      )}
    </div>
  );
}