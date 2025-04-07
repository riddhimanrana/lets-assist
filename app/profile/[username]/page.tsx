import React from "react";
import { createClient } from "@/utils/supabase/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { NoAvatar } from "@/components/NoAvatar";
import { Metadata } from "next";
import { CalendarIcon, Calendar, MapPin, BadgeCheck, Users } from "lucide-react";
import Link from "next/link";
import { Shield, UserRoundCog, UserRound } from "lucide-react";
import { ProjectStatusBadge } from "@/components/ui/status-badge";

interface Profile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  created_at: string;
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

interface OrganizationResponse {
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

export default async function ProfilePage(
  params: Props,
): Promise<React.ReactElement> {
  const supabase = await createClient();
  const { username } = await params.params;
  
  // Fetch user profile data
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single<Profile>();

  if (error || !profile) {
    notFound();
  }

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

  // Transform the data to match the expected structure
  const formattedOrganizations: OrganizationMembership[] = userOrganizations?.map((item: any) => ({
    role: item.role,
    organizations: item.organizations
  })) || [];

  // Stats calculation
  const upcomingCreatedProjects = createdProjects?.filter(p => p.status === "upcoming").length || 0;
  const completedCreatedProjects = createdProjects?.filter(p => p.status === "completed").length || 0;
  const totalCreatedProjects = createdProjects?.length || 0;
  
  const totalAttendedProjects = attendedProjects?.length || 0;
  const totalProjects = totalCreatedProjects + totalAttendedProjects;

  return (
    <div className="flex justify-center w-full">
      <div className="container max-w-5xl py-4 sm:py-8 px-4 sm:px-6">
        {/* Profile Header Card */}
        <Card className="mb-6 sm:mb-8 overflow-hidden">
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
                <h1 className="text-xl sm:text-2xl font-bold">{profile.full_name}</h1>
                <p className="text-muted-foreground text-xs">@{profile.username}</p>
                </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 sm:px-6 pt-2 pb-4">
            <div className="flex flex-col sm:flex-row justify-between gap-4 sm:gap-3">
              <div className="flex gap-2 flex-wrap">
              <Badge variant="secondary">{totalAttendedProjects} Projects Attended</Badge>
                <Badge variant="outline">{completedCreatedProjects} Projects Created</Badge>
                <Badge variant="outline">{totalProjects} Total</Badge>
                
              </div>
              <div className="flex items-center text-xs text-muted-foreground">
                <CalendarIcon className="h-3 w-3 mr-1.5" />
                <span>Joined {format(new Date(profile.created_at), "MMMM yyyy")}</span>
              </div>
            </div>
          </CardContent>
        </Card>

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
                    <h3 className="font-semibold text-base sm:text-lg line-clamp-1">{project.title}</h3>
                    <ProjectStatusBadge 
                      status={project.status}
                      size="sm"
                      className="ml-auto flex-shrink-0"
                    />
                  </div>
                  <p className="text-muted-foreground text-xs sm:text-sm mb-2 sm:mb-3 line-clamp-2">
                    {project.description.replace(/<[^>]*>/g, '')}
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
                    {project.description.replace(/<[^>]*>/g, '')}
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
