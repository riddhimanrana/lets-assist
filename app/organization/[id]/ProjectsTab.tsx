"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { CalendarIcon, Clock, MapPin, Plus, Search } from "lucide-react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Image from "next/image";

interface ProjectsTabProps {
  projects: any[];
  userRole: string | null;
  organizationId: string;
}

export default function ProjectsTab({
  projects,
  userRole,
  organizationId,
}: ProjectsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredProjects, setFilteredProjects] = useState(projects);
  const [activeTab, setActiveTab] = useState("all");

  // Filter projects when search term or active tab changes
  useEffect(() => {
    let result = projects;
    
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

  // Count projects by status for the tabs
  const activeCount = projects.filter(p => p.status === "active").length;
  const completedCount = projects.filter(p => p.status === "completed").length;
  const upcomingCount = projects.filter(p => p.status === "upcoming").length;

  const canCreateProjects = userRole === "admin" || userRole === "staff";
  
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
            <Button asChild>
              <Link href={`/projects/create?org=${organizationId}`}>
                <Plus className="h-4 w-4 mr-1.5" />
                New Project
              </Link>
            </Button>
          )}
        </div>
      </div>
      
      <Tabs 
        defaultValue="all" 
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <TabsList className="mb-4">
          <TabsTrigger className="text-xs sm:text-sm" value="all">
            All <span className="hidden sm:inline ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">{projects.length}</span>
          </TabsTrigger>
          <TabsTrigger className="text-xs sm:text-sm" value="active">
            Active <span className="hidden sm:inline ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">{activeCount}</span>
          </TabsTrigger>
          <TabsTrigger className="text-xs sm:text-sm" value="upcoming">
            Upcoming <span className="hidden sm:inline ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">{upcomingCount}</span>
          </TabsTrigger>
          <TabsTrigger className="text-xs sm:text-sm" value="completed">
            Completed <span className="hidden sm:inline ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">{completedCount}</span>
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
              {canCreateProjects && (
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

function ProjectCard({ project }: { project: any }) {
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="h-full hover:shadow-md transition-shadow overflow-hidden">
        {project.cover_image_url && (
          <div className="h-32 w-full relative">
            <Image
              src={project.cover_image_url}
              alt={project.title}
              fill
              className="object-cover"
            />
          </div>
        )}
        <CardContent className={`p-4 ${!project.cover_image_url ? 'pt-4' : 'pt-4'}`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-lg line-clamp-1">{project.title}</h3>
            <ProjectStatusBadge status={project.status} />
          </div>
          
          <p className="text-muted-foreground text-sm line-clamp-2 mb-3">
            {project.description ? project.description.replace(/<[^>]*>/g, '') : "No description provided."}
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
        </CardContent>
      </Card>
    </Link>
  );
}

function ProjectStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'active':
      return <Badge variant="default">Active</Badge>;
    case 'upcoming':
      return <Badge variant="secondary">Upcoming</Badge>;
    case 'completed':
      return <Badge variant="outline">Completed</Badge>;
    case 'cancelled':
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
