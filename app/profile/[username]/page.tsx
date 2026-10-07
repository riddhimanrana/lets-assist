import React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { format } from "date-fns";
import { BadgeCheck, Lock, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPublicProfileByUsername } from "@/lib/profile/public";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { EmptyStateIcon } from "@/components/organization/EmptyStateIcon";
import { StatStrip } from "@/components/layout/SettingsSection";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isTrustedForDisplay } from "@/utils/trust";
import OrganizationCard from "@/app/organization/OrganizationCard";
import { resolveOrganizationPluginExperiences } from "@/lib/plugins/resolve-org-plugins";
import { ProfileActions } from "./ProfileActions";
import { ProfileEditButton } from "./ProfileEditButton";
import { ProfileProjectCard } from "./ProfileProjectCard";
import {
  buildProfileMetadata,
  calculateHours,
  formatHours,
  type Organization,
  type OrganizationMembership,
  type OrganizationResponse,
  type Profile,
  type Project,
} from "./profile-page-data";

type Props = {
  params: Promise<{ username: string }>;
};

const PAGE_CONTAINER = "mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10";
const CARD_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

function ProfileNotice({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}): React.ReactElement {
  return (
    <div className={PAGE_CONTAINER}>
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

function ProfileSection({
  title,
  count,
  emptyTitle,
  emptyDescription,
  children,
}: {
  title: string;
  count: number;
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="grid gap-4">
      <SectionHeader
        title={
          <>
            {title}{" "}
            {count > 0 && (
              <span className="text-muted-foreground font-normal tabular-nums">
                {count}
              </span>
            )}
          </>
        }
      />
      {count > 0 ? (
        children
      ) : (
        <Empty className="border p-8">
          <EmptyHeader>
            <EmptyTitle className="text-base">{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
}

export async function generateMetadata(params: Props): Promise<Metadata> {
  const { username } = await params.params;
  return buildProfileMetadata(username);
}

export default async function ProfilePage(
  params: Props,
): Promise<React.ReactElement> {
  const supabase = await createClient();
  const admin = getAdminClient();
  const { username } = await params.params;

  const { data: rawProfile, error } =
    await getPublicProfileByUsername(username);

  if (error || !rawProfile) {
    notFound();
  }

  const profile: Profile = {
    id: rawProfile.id,
    username: rawProfile.username || username,
    full_name: rawProfile.full_name || rawProfile.username || username,
    avatar_url: rawProfile.avatar_url,
    created_at: rawProfile.created_at || new Date(0).toISOString(),
    trusted_member: rawProfile.trusted_member ?? false,
    profile_visibility: rawProfile.profile_visibility,
  };

  // Get current user using getClaims() for better performance
  const { user } = await getAuthUser();
  const isOwner = user?.id === profile.id;

  // Check profile visibility unless it's the owner viewing their own profile
  if (!isOwner && profile.profile_visibility !== "public") {
    if (
      profile.profile_visibility === "private" ||
      !profile.profile_visibility
    ) {
      return (
        <ProfileNotice
          icon={<Lock />}
          title="This profile is private"
          description="Only its owner can view it. Contact them if you need access."
        />
      );
    }

    if (profile.profile_visibility === "organization_only") {
      const { data: viewerOrgs } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user?.id || "");

      const { data: ownerOrgs } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", profile.id);

      const viewerOrgIds = viewerOrgs?.map((o) => o.organization_id) || [];
      const ownerOrgIds = ownerOrgs?.map((o) => o.organization_id) || [];

      const hasSharedOrg = viewerOrgIds.some((id) => ownerOrgIds.includes(id));

      if (!hasSharedOrg) {
        return (
          <ProfileNotice
            icon={<Users />}
            title="Organization members only"
            description="This profile is only visible to members of the same organization."
          />
        );
      }
    }
  }

  const isTrusted = await isTrustedForDisplay(profile.id);

  const { data: createdProjects } = await supabase
    .from("projects")
    .select("*")
    .eq("creator_id", profile.id)
    .eq("workflow_status", "published")
    .order("created_at", { ascending: false });

  const { data: attendedProjectIds } = await admin
    .from("project_signups")
    .select("project_id")
    .eq("user_id", profile.id);

  let attendedProjects: Project[] = [];
  if (attendedProjectIds && attendedProjectIds.length > 0) {
    const projectIds = attendedProjectIds.map((item) => item.project_id);
    const { data: fetchedProjects } = await supabase
      .from("projects")
      .select("*")
      .in("id", projectIds)
      .order("created_at", { ascending: false });

    attendedProjects = fetchedProjects || [];
  }

  // Memberships and organization details are fetched separately: the public
  // read model exposes the member count (and whether it may be shown at all),
  // which the embedded `organizations` join cannot provide.
  const { data: userMemberships } = (await supabase
    .from("organization_members")
    .select("role, organization_id")
    .eq("user_id", profile.id)
    .order("role", { ascending: false })) as {
    data: OrganizationResponse[] | null;
    error: { message: string } | null;
  };

  const membershipOrganizationIds = (userMemberships ?? []).map(
    (membership) => membership.organization_id,
  );

  let membershipOrganizations: Organization[] = [];
  if (membershipOrganizationIds.length > 0) {
    const { data } = (await supabase
      .from("organization_public_read_model")
      .select(
        `
        id,
        name,
        username,
        type,
        verified,
        logo_url,
        description,
        show_members_publicly,
        public_member_count
      `,
      )
      .in("id", membershipOrganizationIds)) as {
      data: Organization[] | null;
      error: { message: string } | null;
    };
    membershipOrganizations = data || [];
  }

  const organizationById = new Map(
    membershipOrganizations.map((organization) => [
      organization.id,
      organization,
    ]),
  );

  const { data: certificates, error: certificatesError } = await admin
    .from("certificates")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });

  if (certificatesError) {
    console.error(
      "Error fetching certificates for profile page:",
      certificatesError,
    );
  }

  let totalHours = 0;
  if (certificates) {
    totalHours = certificates.reduce((sum, cert) => {
      if (cert.event_start && cert.event_end) {
        return sum + calculateHours(cert.event_start, cert.event_end);
      }
      return sum;
    }, 0);
  }

  const hiddenMembershipOrganizationIds = isOwner
    ? new Set<string>()
    : new Set(
        (await resolveOrganizationPluginExperiences(membershipOrganizationIds))
          .filter(({ experience }) => experience.profileMembership === "hidden")
          .map(({ organizationId }) => organizationId),
      );

  const formattedOrganizations: OrganizationMembership[] = (
    userMemberships ?? []
  ).flatMap((membership) => {
    const organization = organizationById.get(membership.organization_id);
    if (!organization) return [];
    if (hiddenMembershipOrganizationIds.has(organization.id)) return [];

    return [
      {
        role: membership.role,
        organization,
        // The read model zeroes the count for organizations that hide their
        // member list, so distinguish "private" from a real zero.
        memberCount:
          organization.show_members_publicly === false
            ? null
            : (organization.public_member_count ?? null),
      },
    ];
  });

  const createdList: Project[] = createdProjects ?? [];
  const totalCreatedProjects = createdList.length;
  const totalAttendedProjects = attendedProjects.length;
  const totalOrganizations = formattedOrganizations.length;
  const hasAnything =
    totalCreatedProjects + totalAttendedProjects + totalOrganizations > 0;
  // Visitors only see sections that have something in them. The owner sees
  // every section so they know what will appear there.
  const showSection = (count: number) => isOwner || count > 0;

  return (
    <div className={`${PAGE_CONTAINER} grid gap-8`}>
      <div className="grid gap-4">
        <PageHeader
          media={
            <Avatar className="size-16">
              <AvatarImage
                src={profile.avatar_url || undefined}
                alt={profile.full_name}
              />
              <AvatarFallback className="text-lg">
                <NoAvatar fullName={profile.full_name} />
              </AvatarFallback>
            </Avatar>
          }
          title={
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{profile.full_name}</span>
              {isTrusted && (
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="inline-flex shrink-0" />}
                  >
                    <BadgeCheck
                      className="text-primary size-5"
                      aria-label="Trusted member"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Trusted member</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </span>
          }
          description={`@${profile.username} · Joined ${format(new Date(profile.created_at), "MMMM yyyy")}`}
          actions={
            isOwner ? (
              <ProfileEditButton />
            ) : (
              <ProfileActions
                profileId={profile.id}
                profileName={profile.full_name}
                profileUsername={profile.username}
              />
            )
          }
        />
        <StatStrip
          items={[
            { label: "Hours volunteered", value: formatHours(totalHours) },
            { label: "Projects attended", value: totalAttendedProjects },
            { label: "Projects created", value: totalCreatedProjects },
          ]}
        />
      </div>

      {!isOwner && !hasAnything && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <EmptyStateIcon name="user" />
            </EmptyMedia>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>
              {profile.full_name} hasn&apos;t joined or created any projects
              yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {showSection(totalAttendedProjects) && (
        <ProfileSection
          title="Attended projects"
          count={totalAttendedProjects}
          emptyTitle="No attended projects yet"
          emptyDescription="Projects you sign up for will show here."
        >
          <div className={CARD_GRID}>
            {attendedProjects.map((project) => (
              <ProfileProjectCard
                key={project.id}
                project={project}
                type="attended"
                isTrusted={isTrusted}
              />
            ))}
          </div>
        </ProfileSection>
      )}

      {showSection(totalCreatedProjects) && (
        <ProfileSection
          title="Created projects"
          count={totalCreatedProjects}
          emptyTitle="No created projects yet"
          emptyDescription="Projects you publish will show here."
        >
          <div className={CARD_GRID}>
            {createdList.map((project) => (
              <ProfileProjectCard
                key={project.id}
                project={project}
                type="created"
                isTrusted={isTrusted}
              />
            ))}
          </div>
        </ProfileSection>
      )}

      {showSection(totalOrganizations) && (
        <ProfileSection
          title="Organizations"
          count={totalOrganizations}
          emptyTitle="No organizations yet"
          emptyDescription="Organizations you join will show here."
        >
          <div className={CARD_GRID}>
            {formattedOrganizations.map(
              (membership: OrganizationMembership) => (
                <OrganizationCard
                  key={membership.organization.id}
                  org={{
                    ...membership.organization,
                    verified: membership.organization.verified || false,
                  }}
                  memberCount={membership.memberCount}
                  isUserMember={true}
                  userRole={membership.role}
                />
              ),
            )}
          </div>
        </ProfileSection>
      )}
    </div>
  );
}
