"use client";

import { useState, useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { CalendarIcon, MapPin, Plus, Search, Calendar, CheckCircle2, AlertCircle, Clock3, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectStatus, Project } from "@/types";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { getProjectStatus } from "@/utils/project";
import { useRouter } from "next/navigation";
import { stripHtml, cn } from "@/lib/utils";

interface ProjectsTabProps {
  projects: Project[];
  userRole: string | null;
  organizationId: string;
}

export default function ProjectsTab({
  projects,
  userRole,
  organizationId,
}: ProjectsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredProjects, setFilteredProjects] = useState<Project[]>(projects);
  const [activeTab, setActiveTab] = useState<ProjectStatus | "all">("all");
  const router = useRouter();

  // Filter projects when search term or active tab changes
  useEffect(() => {
    let result = projects.map((project) => ({
      ...project,
      status: getProjectStatus(project),
    }));

    // Filter by status
    if (activeTab !== "all") {
      result = result.filter((project) => project.status === activeTab);
    }

    // Filter by search term
    if (searchTerm.trim() !== "") {
      const lowercasedFilter = searchTerm.toLowerCase();
      result = result.filter((project) => {
        const title = project.title.toLowerCase();
        const description = (project.description || "").toLowerCase();
        const location = (project.location || "").toLowerCase();
        return (
          title.includes(lowercasedFilter) ||
          description.includes(lowercasedFilter) ||
          location.includes(lowercasedFilter)
        );
      });
    }

    setFilteredProjects(result);
  }, [searchTerm, activeTab, projects]);

  const canCreateProjects = userRole === "admin" || userRole === "staff";

  // Handle navigation to create project with organization context
  const handleCreateProject = () => {
    router.push(`/projects/create?org=${organizationId}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">Organization Projects</h2>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2 top-1/2 h-4 w-4 text-muted-foreground -translate-y-1/2" />
            <Input
              placeholder="Search projects..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {canCreateProjects && (
            <Button onClick={handleCreateProject} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-1.5" />
              New Project
            </Button>
          )}
        </div>
      </div>

      <Tabs
        defaultValue="all"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ProjectStatus | "all")}
        className="w-full"
      >
        <TabsList className="mb-4 flex h-auto w-fit self-start max-w-full items-center justify-start overflow-x-auto bg-muted p-1 text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <TabsTrigger value="all" className="gap-2 px-3">
            <LayoutGrid className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline truncate">All</span>
          </TabsTrigger>
          <TabsTrigger value="upcoming" className="gap-2 px-3">
            <Calendar className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline truncate">Upcoming</span>
          </TabsTrigger>
          <TabsTrigger value="in-progress" className="gap-2 px-3">
            <Clock3 className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline truncate">Progress</span>
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-2 px-3">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline truncate">Done</span>
          </TabsTrigger>
          <TabsTrigger value="cancelled" className="gap-2 px-3">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline truncate">Cancelled</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab} className="mt-0">
          {filteredProjects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProjects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 border rounded-md bg-muted/10">
              <p className="text-muted-foreground">
                {searchTerm
                  ? `No projects found matching "${searchTerm}"`
                  : activeTab === "all"
                    ? "No projects found in this organization"
                    : `No ${activeTab} projects found`}
              </p>
              {canCreateProjects && activeTab !== "cancelled" && (
                <Link
                  href={`/projects/create?org=${organizationId}`}
                  className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Create Project
                </Link>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const currentStatus = getProjectStatus(project);

  return (
    <Link href={`/projects/${project.id}`} className="group block h-full">
      <Card className="h-full hover:shadow-xl dark:hover:shadow-primary/10 transition-all duration-200 overflow-hidden border-border/50 bg-card">
        <div className="px-4 flex flex-col h-full">
          <CardHeader className="p-0 mb-2">
            <CardTitle className="text-lg font-bold line-clamp-1 pr-2 leading-tight">{project.title}</CardTitle>
            <CardAction>
              <ProjectStatusBadge status={currentStatus} className="shrink-0" />
            </CardAction>
          </CardHeader>
          
          <CardContent className="p-0 ">
            <CardDescription className="line-clamp-2 mb-3 text-sm text-muted-foreground/90">
              {project.description ? stripHtml(project.description) : "No description provided."}
            </CardDescription>

             <div className="space-y-1.5 text-xs font-medium text-muted-foreground/80">
              {project.location && (
                <div className="flex items-center">
                  <MapPin className="h-4 w-4 mr-2 shrink-0" />
                  <span className="truncate">{project.location}</span>
                </div>
              )}

              <div className="flex items-center">
                <CalendarIcon className="h-4 w-4 mr-2 shrink-0" />
                <span>Created {format(new Date(project.created_at), "MMM d, yyyy")}</span>
              </div>
            </div>
          </CardContent>

          {project.organization && (
             <div className="mt-auto flex items-center gap-2">
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60">Organized by</div>
                <span className="text-sm font-semibold text-foreground/80 truncate">
                  {project.profiles?.full_name || "Anonymous"}
                </span>
             </div>
          )}
        </div>
      </Card>
    </Link>
  );
}