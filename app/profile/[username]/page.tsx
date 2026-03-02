import React from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { format, parseISO, differenceInMinutes, isBefore } from "date-fns";
import { notFound } from "next/navigation";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { CalendarIcon, MapPin, BadgeCheck, Users, Briefcase, PenTool, Hash, Clock } from "lucide-react";
import Link from "next/link";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import type { Metadata } from "next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isTrustedForDisplay } from "@/utils/trust";
import { stripHtml } from "@/lib/utils";
import OrganizationCard from "@/app/organization/OrganizationCard";
import { ProfileActions } from "./ProfileActions";

interface Profile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  created_at: string;
  volunteer_hours?: number;
  verified_hours?: number;
  trusted_member?: boolean;
}

interface Project {
  id: string;
  title: string;
  description: string;
  location: string;
  event_type: string;
  status: "upcoming" | "in-progress" | "completed" | "cancelled";
  created_at: string;
  cover_image_url?: string;
}

interface Organization {
  id: string;
  name: string;
  username: string;
  type: string;
  verified: boolean;
  logo_url: string | null;
  description: string | null;
}

interface OrganizationMembership {
  role: 'admin' | 'staff' | 'member';
  organizations: Organization[];
}

interface OrganizationResponse {
  role: 'admin' | 'staff' | 'member';
  organizations: Organization[];
}

type Props = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata(
  params: Props,
): Promise<Metadata> {
  const { username } = await params.params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single<Profile>();

  const baseUrl = new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"),
  );
  const profileUrl = new URL(`/profile/${username}`, baseUrl);
  const ogImageUrl = new URL(
    `/profile/${username}/opengraph-image`,
    baseUrl,
  );
  const displayName = profile?.full_name || username;
  const isPublic = (profile as { profile_visibility?: string | null })
    ?.profile_visibility
    ? (profile as { profile_visibility?: string | null }).profile_visibility ===
    "public"
    : false;
  const description = isPublic
    ? `Profile page for ${displayName}`
    : "Profile on Let's Assist.";

  return {
    title: `${displayName} (${username})` || username,
    description,
    metadataBase: baseUrl,
    alternates: {
      canonical: profileUrl,
    },
    openGraph: {
      title: `${displayName} (${username})` || username,
      description,
      type: "profile",
      url: profileUrl,
      siteName: "Let's Assist",
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${displayName} — Let's Assist`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${displayName} (${username})` || username,
      description,
      images: [ogImageUrl],
    },
  };
}

// Helper function to calculate hours (copied from dashboard logic)
function calculateHours(startTimeStr: string, endTimeStr: string): number {
  try {
    if (!startTimeStr || !endTimeStr) return 0;
    const start = parseISO(startTimeStr);
    const end = parseISO(endTimeStr);
    if (isBefore(end, start)) return 0;
    // Calculate difference in minutes, then convert to hours, rounded to 1 decimal place
    const diffMins = differenceInMinutes(end, start);
    return Math.round((diffMins / 60) * 10) / 10;
  } catch (e) {
    console.error("Error calculating hours:", e, { startTimeStr, endTimeStr });
    return 0;
  }
}

export default async function ProfilePage(
  params: Props,
): Promise<React.ReactElement> {
  const supabase = await createClient();
  const { username } = await params.params;

  // Fetch user profile data including visibility
  const { data: profile, error } = (await supabase
    .from("profiles")
    .select("*, profile_visibility")
    .eq("username", username)
    .single()) as {
      data: (Profile & { profile_visibility?: string | null }) | null;
      error: { message: string } | null;
    };

  if (error || !profile) {
    notFound();
  }

  // Get current user using getClaims() for better performance
  const { user } = await getAuthUser();
  const isOwner = user?.id === profile.id;

  // Check profile visibility unless it's the owner viewing their own profile
  if (!isOwner && profile.profile_visibility !== 'public') {
    if (profile.profile_visibility === 'private' || !profile.profile_visibility) {
      return (
        <div className="flex items-center justify-center px-4 min-h-screen">
          <Card className="w-full max-w-md border-0 shadow-lg">
            <CardContent className="pt-8 pb-8 text-center">
              <div className="mb-4 flex justify-center">
                <div className="rounded-full bg-muted p-3">
                  <svg className="h-8 w-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-2">Profile is Private</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                This profile is set to private and cannot be viewed by others. Contact the user if you'd like access.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (profile.profile_visibility === 'organization_only') {
      const { data: viewerOrgs } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user?.id || '');

      const { data: ownerOrgs } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", profile.id);

      const viewerOrgIds = viewerOrgs?.map(o => o.organization_id) || [];
      const ownerOrgIds = ownerOrgs?.map(o => o.organization_id) || [];

      const hasSharedOrg = viewerOrgIds.some(id => ownerOrgIds.includes(id));

      if (!hasSharedOrg) {
        return (
          <div className="container mx-auto px-4 py-8">
            <Card className="max-w-md mx-auto">
              <CardContent className="pt-6 text-center">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h2 className="text-xl font-semibold mb-2">Organization Members Only</h2>
                <p className="text-muted-foreground">
                  This profile is only visible to members of the same organization.
                </p>
              </CardContent>
            </Card>
          </div>
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

  const { data: attendedProjectIds } = await supabase
    .from('project_signups')
    .select('project_id')
    .eq('user_id', profile.id);

  let attendedProjects: Project[] = [];
  if (attendedProjectIds && attendedProjectIds.length > 0) {
    const projectIds = attendedProjectIds.map(item => item.project_id);
    const { data: fetchedProjects } = await supabase
      .from("projects")
      .select("*")
      .in("id", projectIds)
      .order("created_at", { ascending: false });

    attendedProjects = fetchedProjects || [];
  }

  const { data: userOrganizations } = (await supabase
    .from('organization_members')
    .select(`
      role,
      organizations (
        id,
        name,
        username,
        type,
        verified,
        logo_url,
        description
      )
    `)
    .eq('user_id', profile.id)
    .order('role', { ascending: false })) as {
      data: OrganizationResponse[] | null;
      error: { message: string } | null;
    };

  const { data: certificates, error: certificatesError } = await supabase
    .from("certificates")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });

  if (certificatesError) {
    console.error("Error fetching certificates for profile page:", certificatesError);
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

  function formatHours(hours: number): string {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  const formattedOrganizations: OrganizationMembership[] =
    (userOrganizations || []).map((item) => ({
      role: item.role,
      organizations: item.organizations,
    }));

  const totalCreatedProjects = createdProjects?.length || 0;
  const totalAttendedProjects = attendedProjects?.length || 0;
  const totalProjects = totalCreatedProjects + totalAttendedProjects;

  const ProfileProjectCard = ({ project, type }: { project: Project, type: 'created' | 'attended' }) => (
    <Link href={`/projects/${project.id}`} className="block h-full group">
      <Card className="h-full hover:shadow-lg transition-all duration-300 flex flex-col group/project-card border-muted/60 py-0 hover:border-primary/20">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <CardTitle className="text-base font-bold line-clamp-1 group-hover/project-card:text-primary transition-colors truncate">
                {project.title}
              </CardTitle>
              {type === 'created' && isTrusted && (
                <Tooltip>
                  <TooltipTrigger>
                    <BadgeCheck className="h-4 w-4 text-primary shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Verified Project</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <ProjectStatusBadge
              status={project.status}
              size="sm"
              className="shrink-0"
            />
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 flex-1 flex flex-col">
          <CardDescription className="line-clamp-2 mb-3 text-xs break-all">
            {stripHtml(project.description)}
          </CardDescription>
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground mt-auto">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{project.location}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {type === 'created' ? (
                <>
                  <CalendarIcon className="h-3 w-3 shrink-0" />
                  <span>Created {format(new Date(project.created_at), "MMM d, yyyy")}</span>
                </>
              ) : (
                <>
                  <Users className="h-3 w-3 shrink-0" />
                  <span>Attended</span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  return (
    <div className="min-h-screen bg-background py-4 sm:py-12 flex flex-col items-center">
      <div className="w-full max-w-6xl px-4 space-y-8 sm:space-y-12">

        {/* Main Profile Card */}
        <Card className="w-full overflow-hidden border shadow-sm">
          <CardContent className="px-4 sm:px-6 py-5 sm:py-6 relative">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row items-center sm:items-center mb-4 sm:mb-6 gap-4 sm:gap-6">

              {/* Avatar */}
              <div className="relative shrink-0">
                <Avatar className="h-16 w-16 sm:h-24 sm:w-24 border shadow-sm">
                  <AvatarImage
                    src={profile.avatar_url || undefined}
                    alt={profile.full_name}
                    className="object-cover"
                  />
                  <AvatarFallback className="text-xl sm:text-3xl bg-muted text-muted-foreground">
                    <NoAvatar fullName={profile?.full_name} className="text-xl sm:text-3xl" />
                  </AvatarFallback>
                </Avatar>
                {isTrusted && (
                  <div className="absolute -bottom-0.5 -right-0.5 sm:-bottom-1 sm:-right-1 bg-background rounded-full shadow-sm border flex items-center justify-center p-0.5">
                    <Tooltip>
                      <TooltipTrigger className="p-1 hover:bg-transparent focus:ring-0">
                        <BadgeCheck className="h-4 w-4 sm:h-6 sm:w-6 text-primary fill-background" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>Trusted Member</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>

              {/* User Info */}
              <div className="flex-1 text-center sm:text-left space-y-1 min-w-0">
                <h1 className="text-xl sm:text-3xl font-bold tracking-tight truncate">{profile.full_name}</h1>
                <p className="text-muted-foreground font-medium text-sm sm:text-base">@{profile.username}</p>
                <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs sm:text-sm text-muted-foreground pt-0.5">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  <span>Joined {format(new Date(profile.created_at), "MMMM yyyy")}</span>
                </div>
              </div>

              {/* Actions Button */}
              <div className="absolute top-4 right-4 sm:static sm:ml-auto">
                <ProfileActions
                  profileId={profile.id}
                  profileName={profile.full_name}
                  profileUsername={profile.username}
                />
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {/* Hours */}
              <div className="flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl bg-primary/5 border hover:bg-primary/10 transition-colors group">
                <div className="flex items-center gap-2 mb-1 text-primary">
                  <Clock className="h-4 w-4" />
                  <span className="text-lg sm:text-xl font-bold text-foreground">{formatHours(totalHours)}</span>
                </div>
                <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-primary/80 transition-colors">Hours</span>
              </div>

              {/* Total Projects */}
              <div className="flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl bg-chart-3/10 border hover:bg-chart-3/20 transition-colors group">
                <div className="flex items-center gap-2 mb-1 text-chart-3">
                  <Briefcase className="h-4 w-4" />
                  <span className="text-lg sm:text-xl font-bold text-foreground">{totalProjects}</span>
                </div>
                <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-chart-3/80 transition-colors">Total</span>
              </div>

              {/* Created */}
              <div className="flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl bg-chart-5/10 border hover:bg-chart-5/20 transition-colors group">
                <div className="flex items-center gap-2 mb-1 text-chart-5">
                  <PenTool className="h-4 w-4" />
                  <span className="text-lg sm:text-xl font-bold text-foreground">{totalCreatedProjects}</span>
                </div>
                <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-chart-5/80 transition-colors">Created</span>
              </div>

              {/* Attended */}
              <div className="flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl bg-chart-4/10 border hover:bg-chart-4/20 transition-colors group">
                <div className="flex items-center gap-2 mb-1 text-chart-4">
                  <Hash className="h-4 w-4" />
                  <span className="text-lg sm:text-xl font-bold text-foreground">{totalAttendedProjects}</span>
                </div>
                <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-chart-4/80 transition-colors">Attended</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Content Sections */}
        <div className="space-y-12 sm:space-y-16 w-full">

          {/* Organizations */}
          {formattedOrganizations && formattedOrganizations.length > 0 && (
            <div className="space-y-4 sm:space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 sm:p-2.5 bg-chart-3/10 rounded-lg sm:rounded-xl text-chart-3">
                  <Users className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Organizations</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {formattedOrganizations.map((membership: OrganizationMembership) => {
                  const org = Array.isArray(membership.organizations)
                    ? membership.organizations[0]
                    : membership.organizations;
                  if (!org) return null;
                  return (
                    <OrganizationCard
                      key={org.id}
                      org={{ ...org, verified: org.verified || false }}
                      memberCount={0}
                      isUserMember={true}
                      userRole={membership.role}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Created Projects */}
          <div className="space-y-4 sm:space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-2.5 bg-chart-5/10 rounded-lg sm:rounded-xl text-chart-5">
                <PenTool className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Created Projects</h2>
            </div>
            {createdProjects && createdProjects.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {createdProjects.map((project) => (
                  <ProfileProjectCard key={project.id} project={project} type="created" />
                ))}
              </div>
            ) : (
              <div className="text-center py-10 sm:py-16 border border-dashed rounded-xl bg-muted/10 w-full">
                <div className="bg-muted/30 p-3 sm:p-4 rounded-full w-fit mx-auto mb-3 sm:mb-4">
                  <CalendarIcon className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground/50" />
                </div>
                <h3 className="font-medium text-base sm:text-lg">No Created Projects</h3>
                <p className="text-xs text-muted-foreground mt-1.5 sm:mt-2">Hasn&apos;t created any projects yet.</p>
              </div>
            )}
          </div>

          {/* Attended Projects */}
          <div className="space-y-4 sm:space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-2.5 bg-chart-4/10 rounded-lg sm:rounded-xl text-chart-4">
                <Hash className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Attended Projects</h2>
            </div>
            {attendedProjects && attendedProjects.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {attendedProjects.map((project) => (
                  <ProfileProjectCard key={project.id} project={project} type="attended" />
                ))}
              </div>
            ) : (
              <div className="text-center py-10 sm:py-16 border border-dashed rounded-xl bg-muted/10 w-full">
                <div className="bg-muted/30 p-3 sm:p-4 rounded-full w-fit mx-auto mb-3 sm:mb-4">
                  <Users className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground/50" />
                </div>
                <h3 className="font-medium text-base sm:text-lg">No Attended Projects</h3>
                <p className="text-xs text-muted-foreground mt-1.5 sm:mt-2">Hasn&apos;t attended any projects yet.</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}