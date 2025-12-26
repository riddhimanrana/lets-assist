import { createClient } from "@/utils/supabase/server";
import { getProjectStatus } from "@/utils/project";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, parseISO } from "date-fns";
import { Calendar, MapPin, Users, Award } from "lucide-react"; // Add Award
import { NoAvatar } from "@/components/NoAvatar";
import Link from "next/link";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { redirect } from "next/navigation";
import type { Project } from "@/types";

// Formats the date display for different project types
function formatDateDisplay(project: any) {
  if (!project.event_type || !project.schedule) return "";

  switch (project.event_type) {
    case "oneTime": {
      const dateStr = project.schedule.oneTime?.date;
      return format(parseISO(dateStr), "MMM d, yyyy");
    }
    case "multiDay": {
      const dates = project.schedule.multiDay
        .map((day: any) => parseISO(day.date))
        .sort((a: Date, b: Date) => a.getTime() - b.getTime());

      return `${format(dates[0], "MMM d")} - ${format(dates[dates.length - 1], "MMM d, yyyy")}`;
    }
    case "sameDayMultiArea": {
      const dateStr = project.schedule.sameDayMultiArea?.date;
      return format(parseISO(dateStr), "MMM d, yyyy");
    }
    default:
      return "Date not specified";
  }
}

// Add interface for the project with creator
interface ProjectWithCreator extends Project {
  creator?: {
    id: string;
    full_name: string;
    avatar_url: string | null;
    username: string;
  };
  signup_id?: string;
  signup_status?: string;
  signup_schedule_id?: string;
  areHoursPublished?: boolean; // Add this field
}

export default async function UserProjects() {
  const supabase = await createClient();

  // Check if user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Get user profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  void profile;

  // Get projects user has created
  const { data: createdProjects, error: createdError } = await supabase
    .from("projects")
    .select(`
      *,
      organizations(name, logo_url, username),
      project_signups(id, user_id, status, schedule_id)
    `)
    .eq("creator_id", user.id)
    .order("created_at", { ascending: false });

  if (createdError) {
    console.error("Error fetching created projects:", createdError);
  }

  // Get projects user has signed up for
  const { data: signups, error: signupsError } = await supabase
    .from("project_signups")
    .select(`
      id,
      status,
      schedule_id,
      projects (
        *,
        organizations(name, logo_url, username),
        published
      )
    `)
    .eq("user_id", user.id)
    .not("status", "eq", "rejected")
    .order("created_at", { ascending: false });

  if (signupsError) {
    console.error("Error fetching signups:", signupsError);
  }

  // After getting the signups, fetch creator profiles separately if needed
  const projectCreatorIds = signups
    ?.filter(signup => signup.projects)
    .map(signup => {
      const project = Array.isArray(signup.projects) ? signup.projects[0] : signup.projects;
      return project.creator_id;
    })
    .filter(Boolean);

  let creatorProfiles: Record<string, any> = {};
  if (projectCreatorIds && projectCreatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, username")
      .in("id", projectCreatorIds);
    
    if (profiles) {
      creatorProfiles = profiles.reduce((acc: any, profile: any) => {
        acc[profile.id] = profile;
        return acc;
      }, {});
    }
  }

  // Transform and process volunteer projects properly with creator info
  const volunteeredProjects: ProjectWithCreator[] = signups?.filter(signup => signup.projects).map(signup => {
    const projectData = Array.isArray(signup.projects) ? signup.projects[0] : signup.projects;
    const creator = creatorProfiles[projectData.creator_id];
    
    // Determine if hours are published for this specific signup's schedule_id
    const areHoursPublished = projectData.published_hours && projectData.published_hours[signup.schedule_id] === true;

    return {
      ...(projectData as unknown as Project),
      creator,
      signup_id: signup.id,
      signup_status: signup.status,
      signup_schedule_id: signup.schedule_id,
      areHoursPublished, // Include this in the returned object
    };
  }) || [];

  // Process projects to add status
  const processedCreatedProjects = createdProjects?.map(project => ({
    ...project,
    status: getProjectStatus(project)
  })) || [];

  const processedVolunteeredProjects = volunteeredProjects.map(project => ({
    ...project,
    status: getProjectStatus(project)
  }));

  // Group volunteered projects by status
  const upcomingVolunteered = processedVolunteeredProjects.filter(p => 
    p.status === "upcoming"
  );
  
  const inProgressVolunteered = processedVolunteeredProjects.filter(p => 
    p.status === "in-progress"
  );
  
  const pastVolunteered = processedVolunteeredProjects.filter(p => 
    p.status === "completed" || p.status === "cancelled"
  );

  // Group created projects by status
  const upcomingCreated = processedCreatedProjects.filter(p => 
    p.status === "upcoming"
  );
  
  const inProgressCreated = processedCreatedProjects.filter(p => 
    p.status === "in-progress"
  );
  
  const pastCreated = processedCreatedProjects.filter(p => 
    p.status === "completed" || p.status === "cancelled"
  );

  return (
    <main className="mx-auto px-4 sm:px-8 lg:px-12 py-8 min-h-screen">
      <h1 className="text-3xl font-bold mb-2">My Projects</h1>
      <p className="text-muted-foreground mb-5">
        Projects you&apos;ve signed up for and projects you&apos;ve created.
      </p>
      
      <Tabs defaultValue="volunteering" className="space-y-5">
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="volunteering">Volunteering For</TabsTrigger>
          <TabsTrigger value="created">Created</TabsTrigger>
        </TabsList>

        {/* Projects you're volunteering for */}
        <TabsContent value="volunteering" className="space-y-6">
          {upcomingVolunteered.length === 0 && inProgressVolunteered.length === 0 && pastVolunteered.length === 0 ? (
            <div className="text-center py-10">
              <div className="mx-auto w-14 h-14 bg-muted flex items-center justify-center rounded-full mb-3">
                <Calendar className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">No volunteer signups yet</h3>
              <p className="text-muted-foreground mb-5 max-w-md mx-auto text-sm">
                You haven&apos;t signed up for any volunteer projects yet.
              </p>
              <Button asChild size="sm">
                <Link href="/projects">Browse Projects</Link>
              </Button>
            </div>
          ) : (
            <>
              {/* Upcoming volunteer projects */}
              <section>
                <h2 className="text-lg font-semibold mb-3">Upcoming ({upcomingVolunteered.length})</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {upcomingVolunteered.map((project) => (
                    <Card key={`volunteer-${project.id}`} className="overflow-hidden">
                      <CardHeader className="p-4 pb-0 space-y-1.5">
                        <div className="flex justify-between items-start gap-2">
                          <ProjectStatusBadge size="sm" status={project.status} />
                          <Badge variant="outline" className="text-xs">{formatDateDisplay(project)}</Badge>
                        </div>
                        <h3 className="font-medium line-clamp-1">{project.title}</h3>
                      </CardHeader>
                      <CardContent className="p-4 pt-2 pb-0 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{project.location}</span>
                        </div>
                        
                        {/* {project.event_type === "oneTime" && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>{formatTime(project.schedule?.oneTime?.startTime || "")} - {formatTime(project.schedule?.oneTime?.endTime || "")}</span>
                          </div>
                        )} */}
                        
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage 
                              src={project.organization?.logo_url || project.creator?.avatar_url || ""} 
                              alt={project.organization?.name || project.creator?.full_name || ""} 
                            />
                            <AvatarFallback>
                              <NoAvatar className="text-xs" fullName={project.organization?.name || project.creator?.full_name || ""} />
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs font-medium truncate">
                            {project.organization?.name || project.creator?.full_name || "Anonymous"}
                          </span>
                        </div>
                      </CardContent>
                      <CardFooter className="p-4 pt-3">
                        <Button variant="default" size="sm" asChild className="w-full">
                          <Link href={`/projects/${project.id}`}>
                            View Project
                          </Link>
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </section>

              {/* In progress volunteer projects */}
              {inProgressVolunteered.length > 0 && (
                <section className="mt-6">
                  <h2 className="text-lg font-semibold mb-3">In Progress ({inProgressVolunteered.length})</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {inProgressVolunteered.map((project) => (
                      <Card key={`volunteer-progress-${project.id}`} className="border-primary/30">
                        <CardHeader className="p-4 pb-0 space-y-1.5">
                          <div className="flex justify-between items-start gap-2">
                            <ProjectStatusBadge size="sm" status={project.status} />
                            <Badge variant="outline" className="text-xs">{formatDateDisplay(project)}</Badge>
                          </div>
                          <h3 className="font-medium line-clamp-1">{project.title}</h3>
                        </CardHeader>
                        <CardContent className="p-4 pt-2 pb-0 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{project.location}</span>
                          </div>
                          
                          {/* {project.event_type === "oneTime" && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>{formatTime(project.schedule?.oneTime?.startTime || "")} - {formatTime(project.schedule?.oneTime?.endTime || "")}</span>
                            </div>
                          )} */}
                          
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarImage 
                                src={project.organization?.logo_url || project.creator?.avatar_url || ""} 
                                alt={project.organization?.name || project.creator?.full_name || ""} 
                              />
                              <AvatarFallback>
                                <NoAvatar className="text-xs" fullName={project.organization?.name || project.creator?.full_name || ""} />
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-medium truncate">
                              {project.organization?.name || project.creator?.full_name || "Anonymous"}
                            </span>
                          </div>
                        </CardContent>
                        <CardFooter className="p-4 pt-3">
                          <Button variant="default" size="sm" asChild className="w-full">
                            <Link href={`/projects/${project.id}`}>
                              View Project
                            </Link>
                          </Button>
                        </CardFooter>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* Past volunteer projects */}
              {pastVolunteered.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold mb-3">Past ({pastVolunteered.length})</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {pastVolunteered.map((project) => (
                      // This key needs to be unique. Using project.signup_id ensures uniqueness per signup.
                      <Card key={`volunteer-past-${project.id}-${project.signup_id}`} className="bg-muted/30">
                        <CardHeader className="p-4 pb-0 space-y-1.5">
                          <div className="flex justify-between items-start gap-2">
                            {/* Display status based on project.status or if hours are published */}
                            {project.areHoursPublished ? (
                              <Badge variant="default" className="text-xs bg-chart-5 text-chart-5-foreground hover:bg-chart-5/90">
                                <Award className="h-3 w-3 mr-1" />
                                Hours Published
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-muted text-xs">
                                {project.status === 'cancelled' ? 'Cancelled' : 'Past Event'}
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-xs">{formatDateDisplay(project)}</Badge>
                          </div>
                          <h3 className="font-medium line-clamp-1">{project.title}</h3>
                        </CardHeader>
                        <CardContent className="p-4 pt-2 pb-0 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{project.location}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarImage
                                src={project.organization?.logo_url || project.creator?.avatar_url || ""}
                                alt={project.organization?.name || project.creator?.full_name || ""}
                              />
                              <AvatarFallback>
                                <NoAvatar className="text-xs" fullName={project.organization?.name || project.creator?.full_name || ""} />
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-medium truncate">
                              {project.organization?.name || project.creator?.full_name || "Anonymous"}
                            </span>
                          </div>
                        </CardContent>
                        <CardFooter className="p-4 pt-3">
                          <Button variant="outline" size="sm" asChild className="w-full">
                            <Link href={`/projects/${project.id}`}>
                              View Project
                            </Link>
                          </Button>
                        </CardFooter>
                      </Card>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </TabsContent>

        {/* Projects you've created */}
        <TabsContent value="created" className="space-y-6">
          {upcomingCreated.length === 0 && inProgressCreated.length === 0 && pastCreated.length === 0 ? (
            <div className="text-center py-10">
              <div className="mx-auto w-14 h-14 bg-muted flex items-center justify-center rounded-full mb-3">
                <Users className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">No projects created yet</h3>
              <p className="text-muted-foreground mb-5 max-w-md mx-auto text-sm">
                You haven&apos;t created any volunteer projects yet.
              </p>
              <Button asChild size="sm">
                <Link href="/projects/create">Create First Project</Link>
              </Button>
            </div>
          ) : (
            <>
              {/* Upcoming created projects */}
              <section>
                <h2 className="text-lg font-semibold mb-3">Upcoming ({upcomingCreated.length})</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {upcomingCreated.map((project) => (
                    <Card key={`created-${project.id}`}>
                      <CardHeader className="p-4 pb-0 space-y-1.5">
                        <div className="flex justify-between items-start gap-2">
                          <Badge variant="outline" className="text-xs">
                            {(project.project_signups || []).filter((s: any) => s.status === "approved").length} volunteers
                          </Badge>
                          <Badge variant="outline" className="text-xs">{formatDateDisplay(project)}</Badge>
                        </div>
                        <h3 className="font-medium line-clamp-1">{project.title}</h3>
                      </CardHeader>
                      <CardContent className="p-4 pt-2 pb-0 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{project.location}</span>
                        </div>
                        
                        {/* {project.event_type === "oneTime" && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>{formatTime(project.schedule?.oneTime?.startTime)} - {formatTime(project.schedule?.oneTime?.endTime)}</span>
                          </div>
                        )} */}
                      </CardContent>
                      <CardFooter className="p-4 pt-3">
                        <Button variant="default" size="sm" asChild className="w-full">
                            <Link href={`/projects/${project.id}`}>
                                View Project
                            </Link>
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </section>

              {/* In progress created projects */}
              {inProgressCreated.length > 0 && (
                <section className="mt-6">
                  <h2 className="text-lg font-semibold mb-3">In Progress ({inProgressCreated.length})</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {inProgressCreated.map((project) => (
                      <Card key={`created-progress-${project.id}`} className="border-primary/30">
                        <CardHeader className="p-4 pb-0 space-y-1.5">
                          <div className="flex justify-between items-start gap-2">
                            <Badge variant="outline" className="text-xs">
                              {(project.project_signups || []).filter((s: any) => s.status === "approved").length} volunteers
                            </Badge>
                            <Badge variant="outline" className="text-xs">{formatDateDisplay(project)}</Badge>
                          </div>
                          <h3 className="font-medium line-clamp-1">{project.title}</h3>
                        </CardHeader>
                        <CardContent className="p-4 pt-2 pb-0 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{project.location}</span>
                          </div>
                          
                          {/* {project.event_type === "oneTime" && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>{formatTime(project.schedule?.oneTime?.startTime)} - {formatTime(project.schedule?.oneTime?.endTime)}</span>
                            </div>
                          )} */}
                        </CardContent>
                        <CardFooter className="p-4 pt-3">
                          <Button variant="default" size="sm" asChild className="w-full">
                              <Link href={`/projects/${project.id}`}>
                                  View Project
                              </Link>
                          </Button>
                        </CardFooter>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* Past created projects */}
              {pastCreated.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold mb-3">Past ({pastCreated.length})</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {pastCreated.map((project) => (
                      <Card key={`created-past-${project.id}`} className="bg-muted/30">
                        <CardHeader className="p-4 pb-0 space-y-1.5">
                          <div className="flex justify-between items-start gap-2">
                            <Badge variant="outline" className="bg-muted text-xs">Past Event</Badge>
                            <Badge variant="outline" className="text-xs">{formatDateDisplay(project)}</Badge>
                          </div>
                          <h3 className="font-medium line-clamp-1">{project.title}</h3>
                        </CardHeader>
                        <CardContent className="p-4 pt-2 pb-0 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{project.location}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Users className="h-3 w-3" />
                            <span>{(project.project_signups || []).filter((s: any) => s.status === "approved").length} volunteers participated</span>
                          </div>
                        </CardContent>
                        <CardFooter className="p-4 pt-3">
                          <Button variant="outline" size="sm" asChild className="w-full">
                            <Link href={`/projects/${project.id}`}>
                              View Project
                            </Link>
                          </Button>
                        </CardFooter>
                      </Card>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
