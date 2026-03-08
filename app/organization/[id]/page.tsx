import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { formatUtcCalendarDateLabel } from "@/lib/date-format";
import { getPublicProfilesByIds } from "@/lib/profile/public";
import { Metadata } from "next";
import OrganizationHeader from "@/components/organization/OrganizationHeader";
import OrganizationTabs from "@/components/organization/OrganizationTabs";
import {
  getOrganizationReportData,
  getOrganizationReportDataForSync,
} from "./reports/actions";

type Props = {
  params: Promise<{ id: string }>;
};

type OrganizationMemberRecord = {
  user_id: string;
  role: string;
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
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lets-assist.com";

  // Try to fetch by username first
  const { data: orgByUsername } = await supabase
    .from("organizations")
    .select("id, name, description, username, logo_url")
    .eq("username", id)
    .single();

  // If not found by username, try by ID
  const { data: orgById } = !orgByUsername
    ? await supabase
        .from("organizations")
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
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const supabase = await createClient();
  // Get current user using getClaims() for better performance
  const { user } = await getAuthUser();

  // Check if ID is a username or UUID
  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  // Try to fetch organization by username or ID depending on the format
  const { data: organization } = isUUID
    ? await supabase
        .from("organizations")
        .select("*, created_by, organization_members(user_id, role)")
        .eq("id", id)
        .single()
    : await supabase
        .from("organizations")
        .select("*, created_by, organization_members(user_id, role)")
        .eq("username", id)
        .single();

  if (!organization) {
    notFound();
  }

  // If accessed by ID but has username, redirect to the username URL for better SEO
  if (isUUID && organization.username) {
    redirect(`/organization/${organization.username}`);
  }

  // Determine the user's role in this organization
  let userRole = null;
  if (user) {
    const memberRecord = organization.organization_members.find(
      (member: OrganizationMemberRecord) => member.user_id === user.id,
    );
    userRole = memberRecord?.role || null;
  }

  // Check if members should be visible
  // Members are visible if: show_members_publicly is true OR user is a member
  const canViewMembers = organization.show_members_publicly !== false || !!userRole;

  console.log("Fetching members for organization ID:", organization.id);

  // Get member count from the already-fetched organization_members relationship
  const memberCount = organization.organization_members?.length || 0;

  // Only fetch full member data if they should be visible
  let formattedMembers: FormattedOrganizationMember[] = [];

  if (canViewMembers) {
    // FIXED: First fetch members from organization_members table
    const { data: membersData, error: membersError } = (await supabase
      .from("organization_members")
      .select(
        `
        id, 
        role, 
        joined_at,
        user_id,
        organization_id
      `,
      )
      .eq("organization_id", organization.id)
      .order("role", { ascending: false })) as {
      data: OrganizationMemberRow[] | null;
      error: { message: string } | null;
    };

    if (membersError) {
      console.error("Error fetching organization members:", membersError);
    }

    // Get the list of user IDs
    const userIds = membersData?.map((member) => member.user_id) || [];

    // No need to query profiles if there are no members
    let profilesData: ProfileRow[] = [];
    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = (await getPublicProfilesByIds(
        userIds,
      )) as {
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
        const profile = profilesData.find((p) => p.id === member.user_id) || null;
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
  const { data: projects } = await supabase
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
    const reportResult = await getOrganizationReportDataForSync(organization.id);
    if (reportResult.data?.metrics) {
      reportSummary = {
        totalHours: reportResult.data.metrics.totalHours,
      };
    }
  }

  const organizationCreatedLabel = formatUtcCalendarDateLabel(
    organization.created_at,
  );

  return (
    <div className="flex flex-col w-full">
      <div className="w-full absolute bg-linear-to-br from-primary/15 via-primary/5 to-background/0 min-h-72 before:content-[''] before:absolute before:inset-0 before:bg-linear-to-b before:from-transparent before:to-background" />

      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10">
        <OrganizationHeader
          organization={organization}
          userRole={userRole}
          memberCount={memberCount}
        />

        <div className="mt-8 sm:mt-12 bg-card rounded-xl border border-border/60 shadow-xs p-4 sm:p-6 mb-8">
          <OrganizationTabs
            organization={organization}
            members={formattedMembers}
            projects={projects || []}
            userRole={userRole}
            currentUserId={user?.id}
            reportSummary={reportSummary}
            organizationSlug={organization.username || organization.id}
            organizationCreatedLabel={organizationCreatedLabel}
            canViewMembers={canViewMembers}
          />
        </div>
      </div>
    </div>
  );
}
