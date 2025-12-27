"use client";

import type { OrganizationRole } from "@/types";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { CalendarIcon, Clock, MapPin, Plus, Search, Calendar, CheckCircle2, AlertCircle, Clock3, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ProjectStatus } from "@/types";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { getProjectStatus } from "@/utils/project";
import { useRouter } from "next/navigation";
import { stripHtml } from "@/lib/utils";

interface ProjectWithStatus {
  id: string;
  title: string;
  status?: string;
  [key: string]: unknown;
}

interface ProjectsTabProps {
  projects: ProjectWithStatus[];
  userRole: OrganizationRole | null;
  organizationId: string;
}

export default function ProjectsTab({
  projects,
  userRole,
  organizationId,
}: ProjectsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredProjects, setFilteredProjects] = useState(projects);
  const [activeTab, setActiveTab] = useState<ProjectStatus | "all">("all");
  const router = useRouter();

  // Filter projects when search term or active tab changes
  useEffect(() => {
    let result = projects.map(project => ({
      ...project,
      status: getProjectStatus(project)
    }));
    
    // Filter by status
    if (activeTab !== "all") {
      result = result.filter(project => project.status === activeTab);
    }
    
    // Filter by search term
    if (searchTerm.trim() !== "") {
      const lowercasedFilter = searchTerm.toLowerCase();
      result = result.filter(project => {
        const title = project.title.toLowerCase();
        const description = (project.description || "").toLowerCase();
        const location = (project.location || "").toLowerCase();
        return title.includes(lowercasedFilter) || 
              description.includes(lowercasedFilter) || 
              location.includes(lowercasedFilter);
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
        <h2 className="text-xl font-semibold">Organization Projects</h2>
        
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
            <Button onClick={handleCreateProject}>
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
        <TabsList className="mb-4">
          <TabsTrigger value="all" className="flex items-center space-x-1.5">
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:block">All</span>
          </TabsTrigger>
          <TabsTrigger value="upcoming" className="flex items-center space-x-1.5">
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:block">Upcoming</span>
          </TabsTrigger>
          <TabsTrigger value="in-progress" className="flex items-center space-x-1.5">
            <Clock3 className="h-4 w-4" />
            <span className="hidden sm:block">In Progress</span>
          </TabsTrigger>
          <TabsTrigger value="completed" className="flex items-center space-x-1.5">
            <CheckCircle2 className="h-4 w-4" />
            <span className="hidden sm:block">Completed</span>
          </TabsTrigger>
          <TabsTrigger value="cancelled" className="flex items-center space-x-1.5">
            <AlertCircle className="h-4 w-4" />
            <span className="hidden sm:block">Cancelled</span>
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
                    : `No ${activeTab} projects found`
                }
              </p>
              {canCreateProjects && activeTab !== "cancelled" && (
                <Button asChild variant="outline" className="mt-4">
                  <Link href={`/projects/create?org=${organizationId}`}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Create Project
                  </Link>
                </Button>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectWithStatus }) {
  const currentStatus = getProjectStatus(project);

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="h-full hover:shadow-md transition-shadow overflow-hidden">
        {/* {project.cover_image_url && (
          <div className="h-32 w-full relative">
            <Image
              src={project.cover_image_url}
              alt={project.title}
              fill
              className="object-cover"
            />
          </div>
        )} */}
        <CardContent className={`p-4 ${!project.cover_image_url ? 'pt-4' : 'pt-4'}`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-lg line-clamp-1">{project.title}</h3>
            <ProjectStatusBadge status={currentStatus} />
          </div>
          
          <p className="text-muted-foreground text-sm line-clamp-2 mb-3">
            {project.description ? stripHtml(project.description) : "No description provided."}
          </p>
          
          <div className="flex flex-col gap-1.5">
            {project.location && (
              <div className="flex items-center text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 mr-1.5 flex-shrink-0" />
                <span className="truncate">{project.location}</span>
              </div>
            )}
            
            <div className="flex items-center text-xs text-muted-foreground">
              <CalendarIcon className="h-3 w-3 mr-1.5 flex-shrink-0" />
              <span>Created {format(new Date(project.created_at), "MMM d, yyyy")}</span>
            </div>
            
            {project.event_start && (
              <div className="flex items-center text-xs text-muted-foreground">
                <Clock className="h-3 w-3 mr-1.5 flex-shrink-0" />
                <span>{format(new Date(project.event_start), "MMM d, yyyy h:mm a")}</span>
              </div>
            )}
          </div>

          {project.organization && (
            <div className="mt-3 pt-3 border-t flex items-center gap-2 text-xs text-muted-foreground">
              <span>Posted by</span>
              <span className="font-medium">
                {project.profiles?.full_name || "Anonymous"}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
