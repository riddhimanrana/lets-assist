import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";
import { safeConsole } from "@/lib/safe-console";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getPublicProfilesByIds } from "@/lib/profile/public";
import { getProjectStatus } from "@/utils/project";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  CalendarDaysIcon,
  CompassIcon,
  PlusIcon,
  UsersIcon,
} from "@/components/icons/animated";
import { AnimatedLinkButton } from "@/components/projects/AnimatedLinkButton";
import { EmptyStateIcon } from "@/components/projects/EmptyStateIcon";
import { Award, Repeat, Users } from "lucide-react";
import Link from "next/link";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { redirect } from "next/navigation";
import type { Project } from "@/types";
import { ProjectCard } from "./ProjectCard";
import { formatRecurrenceSummary } from "./recurrence-summary";
import { ACTIVE_PROJECT_SIGNUP_STATUSES } from "@/lib/projects/availability";
import {
  deduplicateVolunteerProjectCards,
  isHoursPublished,
} from "@/lib/projects/user-project-cards";

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

const CARD_GRID =
  "grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4";

const countVolunteers = (project: ProjectWithSignups) =>
  (project.project_signups || []).filter(
    (s) => s.status === "approved" || s.status === "attended",
  ).length;

const formatVolunteers = (count: number) =>
  `${count} ${count === 1 ? "volunteer" : "volunteers"}`;

function GroupHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-3 flex items-baseline gap-2 text-lg font-semibold tracking-tight">
      {title}
      <span className="text-muted-foreground text-sm font-normal tabular-nums">
        {count}
      </span>
    </h2>
  );
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
    .select(
      `
      ${PROJECT_CLIENT_SELECT},
      organizations(name, logo_url, username),
      project_signups!project_signups_project_id_fkey(id, user_id, status, schedule_id)
    `,
    )
    .eq("creator_id", user.id)
    .order("created_at", { ascending: false });

  if (createdError) {
    safeConsole.error("Error fetching created projects:", createdError);
  }

  // Get projects user has signed up for
  const { data: signups, error: signupsError } = await supabase
    .from("project_signups")
    .select(
      `
      id,
      status,
      schedule_id,
      projects!project_signups_project_id_fkey (
        ${PROJECT_CLIENT_SELECT},
        organizations(name, logo_url, username)
      )
    `,
    )
    .eq("user_id", user.id)
    .in("status", [...ACTIVE_PROJECT_SIGNUP_STATUSES])
    .order("created_at", { ascending: false });

  if (signupsError) {
    safeConsole.error("Error fetching signups:", signupsError);
  }

  // After getting the signups, fetch creator profiles separately if needed
  const projectCreatorIds = signups
    ?.filter((signup) => signup.projects)
    .map((signup) => {
      const project = Array.isArray(signup.projects)
        ? signup.projects[0]
        : signup.projects;
      return project.creator_id;
    })
    .filter(Boolean);

  type CreatorProfile = ProjectWithCreator["creator"];
  let creatorProfiles: Record<string, CreatorProfile> = {};
  if (projectCreatorIds && projectCreatorIds.length > 0) {
    const { data: profiles } = await getPublicProfilesByIds(projectCreatorIds);

    if (profiles) {
      creatorProfiles = profiles.reduce<Record<string, CreatorProfile>>(
        (acc, profile) => {
          acc[profile.id] = profile as CreatorProfile;
          return acc;
        },
        {},
      );
    }
  }

  // Transform and process volunteer projects properly with creator info
  const volunteeredProjects = deduplicateVolunteerProjectCards(
    signups
      ?.filter((signup) => signup.projects)
      .map((signup) => {
        const projectData = Array.isArray(signup.projects)
          ? signup.projects[0]
          : signup.projects;
        const creator = creatorProfiles[projectData.creator_id];

        const areHoursPublished = isHoursPublished(
          projectData.published,
          signup.schedule_id,
        );

        return {
          ...(projectData as unknown as Project),
          creator,
          signup_id: signup.id,
          signup_status: signup.status,
          signup_schedule_id: signup.schedule_id,
          areHoursPublished, // Include this in the returned object
        };
      }) || [],
  );

  // Process projects to add status and creator info
  const processedCreatedProjects: ProjectWithSignups[] =
    (createdProjects as ProjectWithSignups[] | null)?.map((project) => ({
      ...project,
      creator: userProfile
        ? {
            id: userProfile.id,
            full_name: userProfile.full_name,
            avatar_url: userProfile.avatar_url,
            username: userProfile.username,
          }
        : undefined,
      status: getProjectStatus(project),
    })) || [];

  const processedVolunteeredProjects = volunteeredProjects.map((project) => ({
    ...project,
    status: getProjectStatus(project),
  }));

  // Group volunteered projects by status
  const upcomingVolunteered = processedVolunteeredProjects.filter(
    (p) => p.status === "upcoming",
  );

  const inProgressVolunteered = processedVolunteeredProjects.filter(
    (p) => p.status === "in-progress",
  );

  const pastVolunteered = processedVolunteeredProjects.filter(
    (p) => p.status === "completed" || p.status === "cancelled",
  );

  // A draft is a project row that is not published yet: a duplicated project,
  // or one whose waiver is still missing. Volunteers cannot see it, so it is
  // listed on its own and opens in the editor, where it can be published.
  const draftCreated = processedCreatedProjects.filter(
    (p) => p.workflow_status === "draft" && p.status !== "cancelled",
  );
  const publishedCreated = processedCreatedProjects.filter(
    (p) => !draftCreated.includes(p),
  );

  // Group created projects by status
  const upcomingCreated = publishedCreated.filter(
    (p) => p.status === "upcoming",
  );

  const inProgressCreated = publishedCreated.filter(
    (p) => p.status === "in-progress",
  );

  const pastCreated = publishedCreated.filter(
    (p) => p.status === "completed" || p.status === "cancelled",
  );

  // Filter recurring projects (those with recurrence_rule set and have frequency)
  const recurringCreated = publishedCreated.filter(
    (p) =>
      p.recurrence_rule &&
      p.recurrence_rule.frequency &&
      p.status !== "cancelled",
  );

  const volunteeredCount = processedVolunteeredProjects.length;
  const createdCount = processedCreatedProjects.length;

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="My projects"
        description="Projects you've signed up for and projects you've created."
      />

      <Tabs defaultValue="volunteering" className="mt-6 gap-6">
        <TabsList variant="line" className="border-b">
          <TabsTrigger value="volunteering" className="flex-none px-3">
            Volunteering for
            <span className="text-muted-foreground tabular-nums">
              {volunteeredCount}
            </span>
          </TabsTrigger>
          <TabsTrigger value="created" className="flex-none px-3">
            Created
            <span className="text-muted-foreground tabular-nums">
              {createdCount}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Projects you're volunteering for */}
        <TabsContent value="volunteering" className="grid gap-8">
          {upcomingVolunteered.length === 0 &&
          inProgressVolunteered.length === 0 &&
          pastVolunteered.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <EmptyStateIcon icon={CalendarDaysIcon} />
                </EmptyMedia>
                <EmptyTitle>No volunteer signups yet</EmptyTitle>
                <EmptyDescription>
                  You haven&apos;t signed up for any volunteer projects yet.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <AnimatedLinkButton href="/home" icon={CompassIcon}>
                  Browse projects
                </AnimatedLinkButton>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              {/* In progress volunteer projects */}
              {inProgressVolunteered.length > 0 && (
                <section>
                  <GroupHeading
                    title="In progress"
                    count={inProgressVolunteered.length}
                  />
                  <div className={CARD_GRID}>
                    {inProgressVolunteered.map((project) => (
                      <ProjectCard
                        key={`volunteer-progress-${project.id}`}
                        project={project}
                        href={`/projects/${project.id}`}
                        badge={
                          <ProjectStatusBadge
                            size="sm"
                            status={project.status}
                          />
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Upcoming volunteer projects */}
              <section>
                <GroupHeading
                  title="Upcoming"
                  count={upcomingVolunteered.length}
                />
                {upcomingVolunteered.length > 0 ? (
                  <div className={CARD_GRID}>
                    {upcomingVolunteered.map((project) => (
                      <ProjectCard
                        key={`volunteer-${project.id}`}
                        project={project}
                        href={`/projects/${project.id}`}
                        badge={
                          <ProjectStatusBadge
                            size="sm"
                            status={project.status}
                          />
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Nothing upcoming.
                  </p>
                )}
              </section>

              {/* Past volunteer projects */}
              {pastVolunteered.length > 0 && (
                <section>
                  <GroupHeading title="Past" count={pastVolunteered.length} />
                  <div className={CARD_GRID}>
                    {pastVolunteered.map((project) => (
                      <ProjectCard
                        key={`volunteer-past-${project.id}-${project.signup_id}`}
                        project={project}
                        href={`/projects/${project.id}`}
                        badge={
                          project.areHoursPublished ? (
                            <Badge variant="success">
                              <Award aria-hidden="true" />
                              Hours published
                            </Badge>
                          ) : (
                            <Badge variant="neutral">
                              {project.status === "cancelled"
                                ? "Cancelled"
                                : "Past event"}
                            </Badge>
                          )
                        }
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </TabsContent>

        {/* Projects you've created */}
        <TabsContent value="created" className="grid gap-8">
          {draftCreated.length === 0 &&
          upcomingCreated.length === 0 &&
          inProgressCreated.length === 0 &&
          pastCreated.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <EmptyStateIcon icon={UsersIcon} />
                </EmptyMedia>
                <EmptyTitle>No projects created yet</EmptyTitle>
                <EmptyDescription>
                  You haven&apos;t created any volunteer projects yet.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <AnimatedLinkButton href="/projects/create" icon={PlusIcon}>
                  Create first project
                </AnimatedLinkButton>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              {draftCreated.length > 0 && (
                <section>
                  <GroupHeading title="Drafts" count={draftCreated.length} />
                  <div className={CARD_GRID}>
                    {draftCreated.map((project) => (
                      <ProjectCard
                        key={`created-draft-${project.id}`}
                        project={project}
                        href={`/projects/${project.id}/edit`}
                        showIdentity={false}
                        badge={<Badge variant="neutral">Draft</Badge>}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* In progress created projects */}
              {inProgressCreated.length > 0 && (
                <section>
                  <GroupHeading
                    title="In progress"
                    count={inProgressCreated.length}
                  />
                  <div className={CARD_GRID}>
                    {inProgressCreated.map((project) => (
                      <ProjectCard
                        key={`created-progress-${project.id}`}
                        project={project}
                        href={`/projects/${project.id}`}
                        showIdentity={false}
                        badge={
                          <Badge variant="outline">
                            {formatVolunteers(countVolunteers(project))}
                          </Badge>
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Upcoming created projects */}
              <section>
                <GroupHeading title="Upcoming" count={upcomingCreated.length} />
                {upcomingCreated.length > 0 ? (
                  <div className={CARD_GRID}>
                    {upcomingCreated.map((project) => (
                      <ProjectCard
                        key={`created-${project.id}`}
                        project={project}
                        href={`/projects/${project.id}`}
                        showIdentity={false}
                        badge={
                          <Badge variant="outline">
                            {formatVolunteers(countVolunteers(project))}
                          </Badge>
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Nothing upcoming.
                  </p>
                )}
              </section>

              {/* Recurring events */}
              {recurringCreated.length > 0 && (
                <section>
                  <GroupHeading
                    title="Recurring events"
                    count={recurringCreated.length}
                  />
                  <ul className="divide-y rounded-lg border">
                    {recurringCreated.map((project) => (
                      <li key={`recurring-${project.id}`}>
                        <Link
                          href={`/projects/${project.id}`}
                          className="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-3 px-4 py-3 outline-none focus-visible:ring-[3px]"
                        >
                          <Repeat
                            className="text-muted-foreground size-4 shrink-0"
                            aria-hidden="true"
                          />
                          <div className="grid min-w-0 flex-1 gap-0.5">
                            <h3 className="truncate text-sm font-medium">
                              {project.title}
                            </h3>
                            <p className="text-muted-foreground truncate text-sm">
                              {project.recurrence_rule &&
                                formatRecurrenceSummary(
                                  project.recurrence_rule,
                                )}
                            </p>
                          </div>
                          <span className="text-muted-foreground hidden shrink-0 text-sm tabular-nums sm:block">
                            {formatVolunteers(countVolunteers(project))}
                          </span>
                          <ProjectStatusBadge
                            size="sm"
                            status={project.status}
                            className="hidden sm:inline-flex"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Past created projects */}
              {pastCreated.length > 0 && (
                <section>
                  <GroupHeading title="Past" count={pastCreated.length} />
                  <div className={CARD_GRID}>
                    {pastCreated.map((project) => (
                      <ProjectCard
                        key={`created-past-${project.id}`}
                        project={project}
                        href={`/projects/${project.id}`}
                        showIdentity={false}
                        badge={<Badge variant="secondary">Past event</Badge>}
                        footerContent={
                          <div className="flex items-center gap-2">
                            <Users
                              className="text-muted-foreground size-4 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="truncate tabular-nums">
                              {formatVolunteers(countVolunteers(project))}{" "}
                              participated
                            </span>
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
