
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getPublicProfilesByIds } from "@/lib/profile/public";
import { getProjectStatus } from "@/utils/project";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button-variants";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, Award, Repeat } from "lucide-react";
import Link from "next/link";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { redirect } from "next/navigation";
import type { Project, RecurrenceRule, RecurrenceWeekday } from "@/types";
import { cn } from "@/lib/utils";
import { ProjectCard } from "./ProjectCard";
import { format } from "date-fns";

// Helper to format recurrence summary for display
function formatRecurrenceSummary(rule: RecurrenceRule): string {
  if (!rule.frequency) return "";

  const WEEKDAY_LABELS: Record<RecurrenceWeekday, string> = {
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
    sunday: "Sun",
  };

  const interval = rule.interval || 1;
  let frequencyLabel: string;
  switch (rule.frequency) {
    case "daily":
      frequencyLabel = interval === 1 ? "day" : `${interval} days`;
      break;
    case "weekly":
      frequencyLabel = interval === 1 ? "week" : `${interval} weeks`;
      break;
    case "monthly":
      frequencyLabel = interval === 1 ? "month" : `${interval} months`;
      break;
    case "yearly":
      frequencyLabel = interval === 1 ? "year" : `${interval} years`;
      break;
    default:
      frequencyLabel = "week";
  }

  let summary = `Repeats every ${frequencyLabel}`;

  if (rule.frequency === "weekly" && rule.weekdays && rule.weekdays.length > 0) {
    const dayNames = rule.weekdays
      .map((d) => WEEKDAY_LABELS[d])
      .filter(Boolean)
      .join(", ");
    summary += ` on ${dayNames}`;
  }

  if (rule.end_type === "on_date" && rule.end_date) {
    const [year, month, day] = rule.end_date.split('-').map(Number);
    summary += ` until ${format(new Date(year, month - 1, day), "MMM d, yyyy")}`;
  } else if (rule.end_type === "after_occurrences" && rule.end_occurrences) {
    summary += `, ${rule.end_occurrences} times`;
  } else if (rule.end_type === "never") {
    summary += " (ongoing)";
  }

  return summary;
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

type ProjectSignupRow = { status?: string | null };

interface ProjectWithSignups extends ProjectWithCreator {
  project_signups?: ProjectSignupRow[] | null;
}

export default async function UserProjects() {
  const supabase = await createClient();

  // Check if user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    redirect("/login");
  }

  // Get user profile
  const { data: userProfile } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, username")
    .eq("id", user.id)
    .single();

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

  type CreatorProfile = ProjectWithCreator["creator"];
  let creatorProfiles: Record<string, CreatorProfile> = {};
  if (projectCreatorIds && projectCreatorIds.length > 0) {
    const { data: profiles } = await getPublicProfilesByIds(projectCreatorIds);

    if (profiles) {
      creatorProfiles = profiles.reduce<Record<string, CreatorProfile>>((acc, profile) => {
        acc[profile.id] = profile as CreatorProfile;
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

  // Process projects to add status and creator info
  const processedCreatedProjects: ProjectWithSignups[] =
    (createdProjects as ProjectWithSignups[] | null)?.map((project) => ({
      ...project,
      creator: userProfile ? {
        id: userProfile.id,
        full_name: userProfile.full_name,
        avatar_url: userProfile.avatar_url,
        username: userProfile.username
      } : undefined,
      status: getProjectStatus(project),
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

  // Filter recurring projects (those with recurrence_rule set and have frequency)
  const recurringCreated = processedCreatedProjects.filter(p =>
    p.recurrence_rule && p.recurrence_rule.frequency && p.status !== "cancelled"
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
              <Link href="/projects" className={cn(buttonVariants({ size: "sm" }))}>Browse Projects</Link>
            </div>
          ) : (
            <>
              {/* Upcoming volunteer projects */}
              <section>
                <h2 className="text-lg font-semibold mb-3">Upcoming ({upcomingVolunteered.length})</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {upcomingVolunteered.map((project) => (
                    <ProjectCard
                      key={`volunteer-${project.id}`}
                      project={project}
                      href={`/projects/${project.id}`}
                      topLeftBadge={<ProjectStatusBadge size="sm" status={project.status} />}
                    />
                  ))}
                </div>
              </section>

              {/* In progress volunteer projects */}
              {inProgressVolunteered.length > 0 && (
                <section className="mt-6">
                  <h2 className="text-lg font-semibold mb-3">In Progress ({inProgressVolunteered.length})</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {inProgressVolunteered.map((project) => (
                      <ProjectCard
                        key={`volunteer-progress-${project.id}`}
                        project={project}
                        href={`/projects/${project.id}`}
                        topLeftBadge={<ProjectStatusBadge size="sm" status={project.status} />}
                        className="border-primary/30"
                      />
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
                      <ProjectCard
                        key={`volunteer-past-${project.id}-${project.signup_id}`}
                        project={project}
                        href={`/projects/${project.id}`}
                        topLeftBadge={
                          project.areHoursPublished ? (
                            <Badge variant="default" className="text-xs bg-success text-success-foreground hover:bg-success/90">
                              <Award className="h-3 w-3 mr-1" />
                              Hours Published
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-muted text-xs">
                              {project.status === 'cancelled' ? 'Cancelled' : 'Past Event'}
                            </Badge>
                          )
                        }
                        className="bg-muted/30"
                        actionVariant="outline"
                      />
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
              <Link href="/projects/create" className={cn(buttonVariants({ size: "sm" }))}>Create First Project</Link>
            </div>
          ) : (
            <>
              {/* Recurring Events section */}
              {recurringCreated.length > 0 && (
                <section className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Repeat className="h-5 w-5 text-primary" />
                      <h2 className="text-lg font-semibold">Recurring Events ({recurringCreated.length})</h2>
                    </div>
                    <p className="text-xs text-muted-foreground hidden sm:block">
                      Auto-repeat schedule
                    </p>
                  </div>
                  <div className="space-y-2">
                    {recurringCreated.map((project) => (
                      <Link
                        key={`recurring-${project.id}`}
                        href={`/projects/${project.id}`}
                        className="block group"
                      >
                        <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/20 bg-linear-to-r from-primary/5 to-transparent hover:from-primary/10 hover:border-primary/30 transition-all duration-200">
                          <div className="shrink-0">
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                              <Repeat className="h-5 w-5 text-primary" />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                              {project.title}
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-xs text-muted-foreground truncate">
                                {project.recurrence_rule && formatRecurrenceSummary(project.recurrence_rule)}
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0 hidden sm:flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {(project.project_signups || []).filter((s) => s.status === "approved" || s.status === "attended").length} volunteers
                            </Badge>
                            <ProjectStatusBadge size="sm" status={project.status} />
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Upcoming created projects */}
              <section>
                <h2 className="text-lg font-semibold mb-3">Upcoming ({upcomingCreated.length})</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {upcomingCreated.map((project) => (
                    <ProjectCard
                      key={`created-${project.id}`}
                      project={project}
                      href={`/projects/${project.id}`}
                      showIdentity={false}
                      topLeftBadge={
                        <Badge variant="outline" className="text-xs">
                          {(project.project_signups || []).filter((s) => s.status === "approved" || s.status === "attended").length} volunteers
                        </Badge>
                      }
                    />
                  ))}
                </div>
              </section>

              {/* In progress created projects */}
              {inProgressCreated.length > 0 && (
                <section className="mt-6">
                  <h2 className="text-lg font-semibold mb-3">In Progress ({inProgressCreated.length})</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {inProgressCreated.map((project) => (
                      <ProjectCard
                        key={`created-progress-${project.id}`}
                        project={project}
                        href={`/projects/${project.id}`}
                        showIdentity={false}
                        topLeftBadge={
                          <Badge variant="outline" className="text-xs">
                            {(project.project_signups || []).filter((s) => s.status === "approved" || s.status === "attended").length} volunteers
                          </Badge>
                        }
                        className="border-primary/30"
                      />
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
                      <ProjectCard
                        key={`created-past-${project.id}`}
                        project={project}
                        href={`/projects/${project.id}`}
                        showIdentity={false}
                        topLeftBadge={<Badge variant="outline" className="bg-muted text-xs">Past Event</Badge>}
                        className="bg-muted/30"
                        actionVariant="outline"
                        footerContent={
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Users className="h-3 w-3" />
                            <span>{(project.project_signups || []).filter((s) => s.status === "approved" || s.status === "attended").length} volunteers participated</span>
                          </div>
                        }
                      />
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
