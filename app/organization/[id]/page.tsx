import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { formatUtcCalendarDateLabel } from "@/lib/date-format";
import { getPublicProfilesByIds } from "@/lib/profile/public";
import { Metadata } from "next";
import OrganizationHeader from "@/components/organization/OrganizationHeader";
import OrganizationSetupChecklist from "@/components/organization/OrganizationSetupChecklist";
import { loadOrganizationSetupChecklist } from "./server/setup-checklist-query";
import OrganizationTabs from "@/components/organization/OrganizationTabs";
import type { OrganizationPluginRouteTabLink } from "@/components/organization/OrganizationTabs";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { resolveOrganizationPluginBehaviorHook } from "@/lib/plugins/resolve-plugin-behaviors";
import { resolveOrganizationPluginSurfaces } from "@/lib/plugins/resolve-plugin-surfaces";
import {
  hasOrganizationPluginAccess,
  resolveOrganizationPluginExperiences,
  resolveOrganizationPlugins,
} from "@/lib/plugins/resolve-org-plugins";
import { getOrganizationReportData } from "./reports/actions";
import { getPublicOrganizationReportSummary } from "@/lib/organization/report-service";
import type { Organization, OrganizationNavigationBehavior } from "@/types";
import {
  createRemoteReadonlyClient,
  getRemoteUserIdForLocalUser,
} from "@/lib/supabase/preview-source";
import { getServerPreviewSource } from "@/lib/supabase/preview-source.server";
import { cn } from "@/lib/utils";
import { shouldRedirectMemberToPluginRoot } from "@/lib/plugins/organization-page-routing";
import { toOrganizationPluginAccessRole } from "@/lib/plugins/access-role";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type OrganizationMemberRecord = {
  user_id: string;
  role: string;
  status: string | null;
};

type OrganizationReadModelRow = {
  id: string;
  username: string | null;
  name: string;
  description: string | null;
  website: string | null;
  logo_url: string | null;
  type: string;
  verified: boolean | null;
  created_at: string | null;
  show_members_publicly: boolean | null;
  public_member_count: number | null;
};

type OrganizationMemberRow = {
  id: string;
  role: "admin" | "staff" | "member";
  joined_at: string;
  user_id: string;
  organization_id: string;
};

type ProfileRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

type FormattedOrganizationMember = OrganizationMemberRow & {
  profiles: ProfileRow | null;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const previewSource = await getServerPreviewSource();
  const readClient =
    previewSource === "remote"
      ? (createRemoteReadonlyClient() ?? supabase)
      : supabase;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lets-assist.com";

  // Try to fetch by username first through the public-safe read model.
  const { data: orgByUsername } = await readClient
    .from("organization_public_read_model")
    .select("id, name, description, username, logo_url")
    .eq("username", id)
    .single();

  // If not found by username, try by ID
  const { data: orgById } = !orgByUsername
    ? await readClient
        .from("organization_public_read_model")
        .select("id, name, description, username, logo_url")
        .eq("id", id)
        .single()
    : { data: null };

  const org = orgByUsername || orgById;

  if (!org) {
    return {
      title: "Organization Not Found",
      description: "The requested organization could not be found.",
    };
  }

  const orgUrl = `${baseUrl}/organization/${org.username || org.id}`;
  const description =
    org.description ||
    `${org.name} organization page - View volunteer opportunities and projects`;
  const ogImageUrl = `${baseUrl}/organization/${org.username || org.id}/opengraph-image`;

  return {
    title: org.name,
    description,
    metadataBase: new URL(baseUrl),
    openGraph: {
      title: org.name,
      description,
      url: orgUrl,
      siteName: "Let's Assist",
      type: "profile",
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${org.name} on Let's Assist`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: org.name,
      description,
      images: [ogImageUrl],
    },
    alternates: {
      canonical: orgUrl,
    },
  };
}

export default async function OrganizationPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const supabase = await createClient();
  const previewSource = await getServerPreviewSource();
  const readClient =
    previewSource === "remote"
      ? (createRemoteReadonlyClient() ?? supabase)
      : supabase;
  // Get current user using getClaims() for better performance
  const { user } = await getAuthUser();

  // Check if ID is a username or UUID
  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  // Fetch public-safe organization data. Sensitive base fields such as join
  // codes, staff tokens, domains, and creator internals stay off this page.
  const { data: organization } = (
    isUUID
      ? await readClient
          .from("organization_public_read_model")
          .select("*")
          .eq("id", id)
          .single()
      : await readClient
          .from("organization_public_read_model")
          .select("*")
          .eq("username", id)
          .single()
  ) as {
    data: OrganizationReadModelRow | null;
    error: { message?: string } | null;
  };

  if (!organization) {
    notFound();
  }

  // If accessed by ID but has username, redirect to the username URL for better SEO
  if (isUUID && organization.username) {
    redirect(`/organization/${organization.username}`);
  }

  // Determine the user's role in this organization
  const effectiveUserId =
    user && previewSource === "remote"
      ? getRemoteUserIdForLocalUser(user.email) || user.id
      : user?.id;
  const pluginViewerUserId =
    previewSource === "remote" ? undefined : effectiveUserId;

  let userRole: string | null = null;
  if (user && effectiveUserId) {
    const { data: memberRecord } = (await readClient
      .from("organization_members")
      .select("user_id, role, status")
      .eq("organization_id", organization.id)
      .eq("user_id", effectiveUserId)
      .eq("status", "active")
      .maybeSingle()) as {
      data: OrganizationMemberRecord | null;
      error: { message?: string } | null;
    };
    userRole = memberRecord?.role || null;
  }

  const [pluginExperience] = await resolveOrganizationPluginExperiences([
    organization.id,
  ]);
  const organizationExperience = pluginExperience?.experience ?? null;
  const pluginRole = toOrganizationPluginAccessRole(userRole);
  const pluginTabsContributions = pluginRole
    ? await resolveOrganizationPluginBehaviorHook({
        organizationId: organization.id,
        organizationSlug: organization.username ?? organization.id,
        organizationName: organization.name,
        hook: "organization.tabs",
        viewerRole: pluginRole,
        viewerUserId: pluginViewerUserId,
        target: {
          userId: user?.id ?? null,
          userEmail: user?.email ?? null,
        },
        hookInput: { searchParams: resolvedSearchParams },
        useAdminClient: true,
      })
    : [];
  const hasEmbeddedOrganizationTabs = pluginTabsContributions.some(
    (contribution) => contribution.pluginKey === pluginExperience?.pluginKey,
  );

  if (!userRole && organizationExperience?.publicPage === "private") {
    notFound();
  }

  if (!userRole && organizationExperience?.publicPage === "plugin") {
    const organizationSlug = organization.username ?? organization.id;
    const routeSuffix = organizationExperience.publicRoute
      ? `/${organizationExperience.publicRoute}`
      : "";
    redirect(
      `/organization/${organizationSlug}/plugins/${pluginExperience.pluginKey}${routeSuffix}`,
    );
  }

  if (
    shouldRedirectMemberToPluginRoot({
      userRole,
      publicPage: organizationExperience?.publicPage ?? null,
      hasEmbeddedOrganizationTabs,
    })
  ) {
    const organizationSlug = organization.username ?? organization.id;
    redirect(
      `/organization/${organizationSlug}/plugins/${pluginExperience.pluginKey}`,
    );
  }

  // Check if members should be visible
  // Members are visible if: show_members_publicly is true OR user is a member
  const canViewMembers =
    organizationExperience?.members !== "hidden" &&
    (organization.show_members_publicly !== false || !!userRole);

  let memberCount = organization.public_member_count ?? 0;

  // Only fetch full member data if they should be visible
  let formattedMembers: FormattedOrganizationMember[] = [];

  if (canViewMembers) {
    const memberSource = userRole
      ? readClient.from("organization_members")
      : readClient.from("organization_public_member_read_model");
    const { data: membersData, error: membersError } = (await memberSource
      .select("id, role, joined_at, user_id, organization_id")
      .eq("organization_id", organization.id)
      .order("role", { ascending: false })) as {
      data: OrganizationMemberRow[] | null;
      error: { message: string } | null;
    };

    if (membersError) {
      console.error("Error fetching organization members:", membersError);
    }

    memberCount = membersData?.length ?? memberCount;

    // Get the list of user IDs
    const userIds = membersData?.map((member) => member.user_id) || [];

    // No need to query profiles if there are no members
    let profilesData: ProfileRow[] = [];
    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } =
        (await getPublicProfilesByIds(userIds)) as {
          data: ProfileRow[] | null;
          error: { message?: string } | null;
        };

      if (profilesError) {
        console.error("Error fetching member profiles:", profilesError);
      } else {
        profilesData = profiles || [];
      }
    }

    // Combine the data
    formattedMembers =
      membersData?.map((member) => {
        const profile =
          profilesData.find((p) => p.id === member.user_id) ||
          (previewSource === "remote"
            ? {
                id: member.user_id,
                username: `remote_${member.user_id.slice(0, 8)}`,
                full_name: `Remote ${member.role.charAt(0).toUpperCase() + member.role.slice(1)}`,
                avatar_url: null,
              }
            : null);
        return {
          ...member,
          profiles: profile,
        };
      }) || [];

    console.log(
      "Members query result:",
      formattedMembers.length,
      "members found",
    );
  }

  // Get organization projects
  const { data: projects } =
    organizationExperience?.projects === "hidden"
      ? { data: [] }
      : await readClient
          .from("projects")
          .select("*")
          .eq("organization_id", organization.id)
          .order("created_at", { ascending: false });

  let reportSummary: { totalHours: number } | null = null;

  if (userRole === "admin" || userRole === "staff") {
    const reportResult = await getOrganizationReportData(organization.id);
    if (reportResult.data?.metrics) {
      reportSummary = {
        totalHours: reportResult.data.metrics.totalHours,
      };
    }
  }

  if (!reportSummary) {
    reportSummary = await getPublicOrganizationReportSummary(organization.id);
  }

  const organizationCreatedLabel = formatUtcCalendarDateLabel(
    organization.created_at,
  );

  const pluginOverviewExtensions = pluginRole
    ? await resolveOrganizationPluginSurfaces({
        organizationId: organization.id,
        surface: "organization.overview.cards",
        viewerRole: pluginRole,
        viewerUserId: pluginViewerUserId,
        target: {
          userId: user?.id ?? null,
        },
        useAdminClient: true,
      })
    : [];
  const navOverridesContributions = pluginRole
    ? await resolveOrganizationPluginBehaviorHook({
        organizationId: organization.id,
        organizationSlug: organization.username ?? organization.id,
        organizationName: organization.name,
        hook: "organization.navigation.overrides",
        viewerRole: pluginRole,
        viewerUserId: pluginViewerUserId,
        target: {
          userId: user?.id ?? null,
          userEmail: user?.email ?? null,
        },
        useAdminClient: true,
      })
    : [];

  const navOverrides =
    navOverridesContributions.reduce<OrganizationNavigationBehavior>(
      (acc, c) => ({
        ...acc,
        ...c.behavior,
        coreTabReplacements: {
          ...(acc.coreTabReplacements ?? {}),
          ...(c.behavior.coreTabReplacements ?? {}),
        },
      }),
      {},
    );
  const allowedPluginSurfaces = navOverrides.pluginSurfaceAllowlist;
  const isAllowedPluginSurface = (pluginKey: string) =>
    !allowedPluginSurfaces?.length || allowedPluginSurfaces.includes(pluginKey);
  const visiblePluginOverviewExtensions = pluginOverviewExtensions.filter(
    (surface) => isAllowedPluginSurface(surface.pluginKey),
  );
  const pluginTabs = pluginTabsContributions
    .filter((contribution) => isAllowedPluginSurface(contribution.pluginKey))
    .flatMap((c) => c.behavior);
  // Admins get a setup checklist until the organization is configured or they
  // dismiss it. Everything but the dismissal flag comes from data already
  // loaded above, so this is one narrow read and only for admins.
  //
  // Skipped when a plugin owns this organization's page chrome. The checklist
  // is a platform onboarding surface, and an organization running a plugin
  // workspace has its own onboarding; rendering both also adds height above the
  // workspace, which is enough to introduce a scrollbar and re-wrap rows inside
  // it.
  const setupChecklist =
    userRole === "admin" && !organizationExperience
      ? await loadOrganizationSetupChecklist({
          organizationId: organization.id,
          organizationSlug: organization.username ?? organization.id,
          logoUrl: organization.logo_url ?? null,
          description: organization.description ?? null,
          type: organization.type ?? null,
          memberCount,
          projectCount: projects?.length ?? 0,
        })
      : null;

  const organizationForDisplay = {
    id: organization.id,
    name: organization.name,
    username: organization.username ?? organization.id,
    description: organization.description ?? undefined,
    website: organization.website,
    logo_url: organization.logo_url ?? undefined,
    type: organization.type,
    verified: organization.verified ?? false,
    show_members_publicly: organization.show_members_publicly,
    created_at: organization.created_at,
  } satisfies Organization & {
    website?: string | null;
    created_at?: string | null;
  };

  const resolvedPlugins = pluginRole
    ? (
        await resolveOrganizationPlugins({
          organizationId: organization.id,
          userRole: pluginRole,
          viewerUserId: pluginViewerUserId,
        })
      ).filter((plugin) => isAllowedPluginSurface(plugin.key))
    : [];
  const pluginRouteTabs: OrganizationPluginRouteTabLink[] =
    resolvedPlugins.flatMap((plugin) => {
      const definition = getRegisteredPlugin(plugin.key);
      if (!definition?.manifest.routes?.length) return [];

      return definition.manifest.routes
        .filter((route) => route.navSection === "organization")
        .filter((route) => {
          const minimumRole =
            route.minimumRole ?? plugin.minimumRole ?? "member";
          if (minimumRole === "public") return true;
          return hasOrganizationPluginAccess(pluginRole, minimumRole);
        })
        .map((route) => ({
          value: `${plugin.key}:${route.path}`,
          label: route.label,
          href: `/organization/${organizationForDisplay.username}/plugins/${plugin.key}${
            route.path === "overview" ? "" : `/${route.path}`
          }`,
          minimumRole: route.minimumRole ?? plugin.minimumRole ?? "member",
        }));
    });

  const overviewReplacement = navOverrides.coreTabReplacements?.overview;
  const canUseOverviewReplacement =
    overviewReplacement &&
    (overviewReplacement.minimumRole === "public" ||
      hasOrganizationPluginAccess(
        pluginRole,
        overviewReplacement.minimumRole ?? "member",
      ));

  if (
    !resolvedSearchParams.tab &&
    overviewReplacement &&
    canUseOverviewReplacement
  ) {
    redirect(
      `/organization/${organizationForDisplay.username}/plugins/${overviewReplacement.pluginKey}${
        overviewReplacement.routePath ? `/${overviewReplacement.routePath}` : ""
      }`,
    );
  }

  return (
    <div className="flex flex-col w-full">
      <div
        className={cn(
          // Purely decorative header wash behind the organization identity, so
          // it carries the brand green rather than the AA-tuned --primary.
          "w-full absolute bg-linear-to-br from-brand/15 via-brand/5 to-background/0 before:content-[''] before:absolute before:inset-0 before:bg-linear-to-b before:from-transparent before:to-background",
          navOverrides.compactHeader ? "min-h-40" : "min-h-72",
        )}
      />

      <div
        className={cn(
          "relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6",
          navOverrides.compactHeader ? "pt-4 sm:pt-5" : "pt-6 sm:pt-10",
        )}
      >
        {previewSource === "remote" && (
          <div className="mb-4 rounded-md border border-warning bg-warning/15 px-4 py-3 text-sm text-warning">
            Remote preview mode is active (read-only). Member and org data shown
            here comes from remote, but all edits still apply to local data.
          </div>
        )}
        <OrganizationHeader
          organization={organizationForDisplay}
          userRole={userRole}
          memberCount={memberCount}
          showMemberCount={!navOverrides.hideMemberCount}
          showInviteAction={!navOverrides.hideInviteAction}
          showProjectAction={!navOverrides.hideProjectAction}
          compact={navOverrides.compactHeader}
        />

        {setupChecklist?.shouldShow && (
          <OrganizationSetupChecklist
            organizationId={organization.id}
            checklist={setupChecklist}
          />
        )}

        <div
          className={cn(
            "bg-card rounded-xl border border-border/60 shadow-xs mb-8",
            navOverrides.compactHeader
              ? "mt-4 p-3 sm:mt-5 sm:p-4"
              : "mt-8 p-4 sm:mt-12 sm:p-6",
          )}
        >
          <OrganizationTabs
            organization={organizationForDisplay}
            members={formattedMembers}
            projects={projects || []}
            userRole={userRole}
            currentUserId={effectiveUserId}
            reportSummary={reportSummary}
            organizationSlug={organizationForDisplay.username}
            organizationCreatedLabel={organizationCreatedLabel}
            canViewMembers={canViewMembers}
            pluginOverviewExtensions={visiblePluginOverviewExtensions}
            pluginTabs={pluginTabs}
            pluginRouteTabs={pluginRouteTabs}
            pluginNavigationOverrides={navOverrides}
          />
        </div>
      </div>
    </div>
  );
}
