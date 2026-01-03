import React from "react";
import { createClient } from "@/utils/supabase/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { format, parseISO, differenceInMinutes, isBefore } from "date-fns"; // Added parseISO, differenceInMinutes, isBefore
import { notFound } from "next/navigation";
import { NoAvatar } from "@/components/NoAvatar";
import { CalendarIcon, Calendar, MapPin, BadgeCheck, Users, Clock, MoreVertical, Flag } from "lucide-react";
import Link from "next/link";
import { Shield, UserRoundCog, UserRound } from "lucide-react";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import type { Metadata } from "next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isTrustedForDisplay } from "@/utils/trust";
import { stripHtml } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ReportContentButton } from "@/components/ReportContentButton";

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
  organizations: Organization;
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

  return {
    title: `${profile?.full_name} (${username})` || username,
    description: `Profile page for ${username}`,
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
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*, profile_visibility")
    .eq("username", username)
    .single<Profile & { profile_visibility?: string }>();

  if (error || !profile) {
    notFound();
  }

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  const isOwner = user?.id === profile.id;

  // Check profile visibility unless it's the owner viewing their own profile
  if (!isOwner && profile.profile_visibility !== 'public') {
    // Check if viewer has permission (e.g., is org admin/staff for school accounts)
    // For now, just block access to private profiles
    if (profile.profile_visibility === 'private' || !profile.profile_visibility) {
      return (
        <div className="container mx-auto px-4 py-8">
          <Card className="max-w-md mx-auto">
            <CardContent className="pt-6 text-center">
              <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h2 className="text-xl font-semibold mb-2">Private Profile</h2>
              <p className="text-muted-foreground">
                This profile is set to private and cannot be viewed.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }
    
    // Organization-only profile - check if viewer is in same org
    if (profile.profile_visibility === 'organization_only') {
      // Get viewer's organizations
      const { data: viewerOrgs } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user?.id || '');
      
      // Get profile owner's organizations
      const { data: ownerOrgs } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", profile.id);
      
      const viewerOrgIds = viewerOrgs?.map(o => o.organization_id) || [];
      const ownerOrgIds = ownerOrgs?.map(o => o.organization_id) || [];
      
      // Check for any overlap
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

  // Determine robust trusted flag for display (owner sees trusted immediately)
  const isTrusted = await isTrustedForDisplay(profile.id);

  // Fetch projects created by this user
  const { data: createdProjects } = await supabase
    .from("projects")
    .select("*")
    .eq("creator_id", profile.id)
    .order("created_at", { ascending: false });

  // Fetch projects this user has attended/signed up for
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

  // Updated organizations fetch with correct typing
  const { data: userOrganizations } = await supabase
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
    .order('role', { ascending: false });

  // Fetch certificates for this user
  // This query should select event_start and event_end if they exist in the table
  const { data: certificates, error: certificatesError } = await supabase
    .from("certificates")
    .select("*") // Ensure event_start and event_end are selected
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false }); // Assuming 'issue_date' is the correct field for ordering

  if (certificatesError) {
    console.error("Error fetching certificates for profile page:", certificatesError);
    // Handle error appropriately
  }
  
  // Calculate total hours from certificates
  let totalHours = 0;
  if (certificates) {
    totalHours = certificates.reduce((sum, cert) => {
      // Ensure event_start and event_end are present on the cert object
      if (cert.event_start && cert.event_end) {
        return sum + calculateHours(cert.event_start, cert.event_end);
      }
      return sum;
    }, 0);
  }

// Utility: Format hours as "Xh Ym"
function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

  // Transform the data to match the expected structure
  const formattedOrganizations: OrganizationMembership[] = userOrganizations?.map((item: any) => ({
    role: item.role,
    organizations: item.organizations
  })) || [];

  // Stats calculation
  const completedCreatedProjects = createdProjects?.filter(p => p.status === "completed").length || 0;
  const totalCreatedProjects = createdProjects?.length || 0;
  
  const totalAttendedProjects = attendedProjects?.length || 0;
  const totalProjects = totalCreatedProjects + totalAttendedProjects;
  
  return (
    <div className="flex justify-center w-full">
      <div className="container max-w-5xl py-4 sm:py-8 px-4 sm:px-6">
        {/* Profile Header Card */}
        <Card className="mb-6 sm:mb-8 overflow-hidden relative">
          {/* Three-dot menu in top-right corner */}
          <div className="absolute top-4 right-4 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                >
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <ReportContentButton
                  contentType="profile"
                  contentId={profile.id}
                  contentTitle={profile.full_name || profile.username}
                  contentCreator={profile.full_name || profile.username}
                  triggerButton={
                    <DropdownMenuItem>
                      <Flag className="mr-2 h-4 w-4" />
                      <span>Report Profile</span>
                    </DropdownMenuItem>
                  }
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          <div className="h-24 sm:h-32 bg-gradient-to-r from-primary/40 via-primary/20 to-primary/10"></div>
          <CardHeader className="pt-0 px-4 sm:px-6 pb-2">
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 -mt-6 sm:-mt-16">
              <Avatar className="h-20 w-20 sm:h-32 sm:w-32 border-4 border-background">
                <AvatarImage
                  src={profile.avatar_url || undefined}
                  alt={profile.full_name}
                />
                <AvatarFallback className="sm:text-2xl">
                  <NoAvatar fullName={profile?.full_name} className="text-2xl sm:text-3xl"/>
                </AvatarFallback>
              </Avatar>
                <div className="sm:pt-16 flex flex-col justify-center">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold">{profile.full_name}</h1>
                  {isTrusted && (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="default" className="h-6 px-2 py-0 text-xs flex items-center gap-1">
                            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                            Trusted
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="start">
                          <p className="max-w-xs text-sm">Trusted Member: verified by Let’s Assist. Projects they create are marked as Verified.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">@{profile.username}</p>
                </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 sm:px-6 pt-2 pb-4">
            <div className="flex flex-col sm:flex-row justify-between gap-4 sm:gap-3">
              <div className="flex gap-2 flex-wrap">                <Badge variant="secondary">{totalAttendedProjects} Projects Attended</Badge>
                <Badge variant="outline">{completedCreatedProjects} Projects Created</Badge>
                <Badge variant="outline">{totalProjects} Total</Badge>
                <Badge variant="default">{totalHours} Volunteer Hours</Badge>
              </div>
              <div className="flex items-center text-xs text-muted-foreground">
                <CalendarIcon className="h-3 w-3 mr-1.5" />
                <span>Joined {format(new Date(profile.created_at), "MMMM yyyy")}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Volunteer Hours Section */}
        <div className="mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4 flex items-center">
            <Clock className="h-5 w-5 mr-2 text-primary" aria-hidden="true" />
            Volunteer Hours
          </h2>
          <Separator className="mb-4" />
          
          <Card className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 rounded-full p-2.5">
                  <Clock className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div className="flex flex-col">
                  <span className="text-3xl font-bold text-primary" aria-label={`Total volunteer hours: ${formatHours(totalHours)}`}>
                    {formatHours(totalHours)}
                  </span>
                  <span className="text-sm text-muted-foreground">from {totalProjects} projects</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Certificates Section
        <div className="mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4 flex items-center">
            <Award className="h-6 w-6 mr-2 text-primary" />
            Certificates & Achievements
          </h2>
          <Separator className="mb-4 sm:mb-6" />
          
          {certificates && certificates.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {certificates.map((certificate) => (
                <Card key={certificate.id} className="hover:shadow-md transition-shadow overflow-hidden">
                  {certificate.image_url && (
                    <div className="h-32 w-full overflow-hidden bg-muted" style={{ position: "relative" }}>
                      <Image
                        src={certificate.image_url}
                        alt={certificate.title}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 100vw, 33vw"
                        priority={false}
                      />
                    </div>
                  )}
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <h3 className="font-semibold text-base sm:text-lg line-clamp-1">{certificate.title}</h3>
                      {certificate.verification_url && (
                        <Link href={certificate.verification_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-primary" />
                        </Link>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Issued by {certificate.issuer}
                    </p>
                    {certificate.description && (
                      <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                        {certificate.description}
                      </p>
                    )}
                    <div className="flex items-center text-xs text-muted-foreground mt-2">
                      <CalendarIcon className="h-3 w-3 mr-1.5" />
                      <span>Issued on {format(new Date(certificate.created_at), "MMM d, yyyy")}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center p-8 bg-muted/20 rounded-lg">
              <Award className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-1">No Certificates Yet</h3>
              <p className="text-muted-foreground">This user hasn&apos;t earned any certificates yet.</p>
            </div>
          )}
        </div> */}

        {/* Organizations Section */}
        {formattedOrganizations && formattedOrganizations.length > 0 && (
          <div className="mb-6 sm:mb-8">
            <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">Organizations</h2>
            <Separator className="mb-4 sm:mb-6" />
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {formattedOrganizations.map((membership: OrganizationMembership) => {
          const org = membership.organizations;
          return (
            <Link href={`/organization/${org.username}`} key={org.id} className="relative block">
              {/* Gradient background behind the card */}
              <div className="absolute inset-0 h-full w-full bg-gradient-to-r from-primary/40 via-primary/20 to-primary/10 rounded-lg"></div>
              
              <Card className="relative h-full hover:shadow-md transition-shadow overflow-hidden">
                <CardContent className="p-4">
            <div className="flex flex-col">
              {/* Header with Avatar and Name */}
              <div className="flex items-center gap-3 mb-3">
                <Avatar className="h-14 w-14 border-2 border-background flex-shrink-0">
                  {org.logo_url ? (
              <AvatarImage src={org.logo_url} alt={org.name} />
                  ) : (
              <AvatarFallback>
                <NoAvatar fullName={org.name} className="text-base" />
              </AvatarFallback>
                  )}
                </Avatar>
                
                <div>
                  <div className="flex items-center gap-2">
              <h3 className="font-semibold text-base sm:text-lg line-clamp-1">{org.name}</h3>
              {org.verified && (
                <BadgeCheck className="h-5 w-5" fill="hsl(var(--primary))" stroke="hsl(var(--popover))" strokeWidth={2.5} />
              )}
                  </div>
                  <p className="text-xs sm:text-sm text-muted-foreground">@{org.username}</p>
                </div>
              </div>
              
              {/* Badges */}
              <div className="flex gap-2 mb-2">
                <Badge variant="outline" className="text-xs capitalize">
                  {org.type}
                </Badge>
                <Badge 
                  variant={
              membership.role === "admin" ? "default" : 
              membership.role === "staff" ? "secondary" : "outline"
                  }
                  className="text-xs flex items-center gap-1"
                >
                  {membership.role === "admin" && <Shield className="h-3 w-3" />}
                  {membership.role === "staff" && <UserRoundCog className="h-3 w-3" />}
                  {membership.role === "member" && <UserRound className="h-3 w-3" />}
                  {membership.role.charAt(0).toUpperCase() + membership.role.slice(1)}
                </Badge>
              </div>
              
              {/* Description */}
              <p className="text-xs sm:text-sm line-clamp-2 text-muted-foreground">
                {org.description || "No description provided."}
              </p>
            </div>
                </CardContent>
              </Card>
            </Link>
          );
              })}
            </div>
          </div>
        )}

        {/* Created Projects Section */}
        <div className="mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">Created Projects</h2>
          <Separator className="mb-4 sm:mb-6" />
          
          {createdProjects && createdProjects.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {createdProjects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-3 sm:p-4">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3 className="font-semibold text-base sm:text-lg line-clamp-1 truncate">{project.title}</h3>
                      {isTrusted && (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" className="h-5 px-1.5 py-0 text-[10px] flex items-center gap-1">
                                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                                Verified
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="start">
                              <p className="max-w-xs text-xs">Created by a Trusted Member. This project is Let’s Assist verified.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <ProjectStatusBadge 
                      status={project.status}
                      size="sm"
                      className="ml-auto flex-shrink-0"
                    />
                  </div>
                  <p className="text-muted-foreground text-xs sm:text-sm mb-2 sm:mb-3 line-clamp-2">
                    {stripHtml(project.description)}
                  </p>
                  <div className="flex items-center text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 mr-1 flex-shrink-0" />
                    <span className="truncate">{project.location}</span>
                  </div>
                  <div className="flex items-center mt-1.5 sm:mt-2 text-xs text-muted-foreground">
                    <CalendarIcon className="h-3 w-3 mr-1" />
                    <span>Created {format(new Date(project.created_at), "MMM d, yyyy")}</span>
                  </div>
                  </CardContent>
                </Card>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center p-8 bg-muted/20 rounded-lg">
              <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-1">No Created Projects</h3>
              <p className="text-muted-foreground">This user hasn&apos;t created any projects yet.</p>
            </div>
          )}
        </div>

        {/* Attended Projects Section */}
        <div className="mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">Attended Projects</h2>
          <Separator className="mb-4 sm:mb-6" />
          
          {attendedProjects && attendedProjects.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {attendedProjects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-3 sm:p-4">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <h3 className="font-semibold text-base sm:text-lg line-clamp-1">{project.title}</h3>
                    <ProjectStatusBadge 
                      status={project.status}
                      size="sm"
                      className="ml-auto flex-shrink-0"
                    />
                  </div>
                  <p className="text-muted-foreground text-xs sm:text-sm mb-2 sm:mb-3 line-clamp-2">
                    {stripHtml(project.description)}
                  </p>
                  <div className="flex items-center text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 mr-1 flex-shrink-0" />
                    <span className="truncate">{project.location}</span>
                  </div>
                  <div className="flex items-center mt-1.5 sm:mt-2 text-xs text-muted-foreground">
                    <Users className="h-3 w-3 mr-1" />
                    <span>Attended</span>
                  </div>
                  </CardContent>
                </Card>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center p-8 bg-muted/20 rounded-lg">
              <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-1">No Attended Projects</h3>
              <p className="text-muted-foreground">This user hasn&apos;t attended any projects yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
