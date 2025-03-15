"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MembersTab from "./MembersTab";
import ProjectsTab from "./ProjectsTab";
import { useState } from "react";
import { 
  LayoutDashboard, 
  Users, 
  Folders, 
  Calendar, 
  Building2, 
  Globe,
  MapPin,
  ShieldCheck
} from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { Button } from "@/components/ui/button"; 

interface OrganizationTabsProps {
  organization: any;
  members: any[];
  projects: any[];
  userRole: string | null;
  currentUserId: string | undefined;
}

export default function OrganizationTabs({
  organization,
  members,
  projects,
  userRole,
  currentUserId,
}: OrganizationTabsProps) {
  const [activeTab, setActiveTab] = useState("overview");

  // Validate input data
  if (!Array.isArray(members)) {
    console.error("OrganizationTabs: members prop is not an array");
    return <div className="text-destructive">Error: Invalid members data</div>;
  }

  if (!Array.isArray(projects)) {
    console.error("OrganizationTabs: projects prop is not an array");
    return <div className="text-destructive">Error: Invalid projects data</div>;
  }
  
  // Calculate stats
  const activeProjects = projects.filter(p => p.status === "active").length;
  const completedProjects = projects.filter(p => p.status === "completed").length;
  const adminCount = members.filter(m => m.role === "admin").length;
  const staffCount = members.filter(m => m.role === "staff").length;

  return (
    <Tabs 
      defaultValue="overview" 
      value={activeTab}
      onValueChange={setActiveTab}
      className="w-full"
    >
      <TabsList className="mb-6 bg-card border inline-flex h-10 items-center justify-center rounded-md p-1 text-muted-foreground">
        <TabsTrigger 
          value="overview" 
          className="flex items-center gap-2 data-[state=active]:text-foreground"
        >
          <LayoutDashboard className="h-4 w-4" />
          <span className="text-xs sm:text-sm">Overview</span>
        </TabsTrigger>
        <TabsTrigger 
          value="members" 
          className="flex items-center gap-2 data-[state=active]:text-foreground"
        >
          <Users className="h-4 w-4" />
          <span className="text-xs sm:text-sm">Members</span>
        </TabsTrigger>
        <TabsTrigger 
          value="projects" 
          className="flex items-center gap-2 data-[state=active]:text-foreground"
        >
          <Folders className="h-4 w-4" />
          <span className="text-xs sm:text-sm">Projects</span>
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="overview" className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">About</h3>
              
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Description</h4>
                  <p className="text-sm">
                    {organization.description || "No description provided."}
                  </p>
                </div>
                
                <div className="grid gap-3">
                  <div className="flex gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium">Organization Type</h4>
                      <p className="text-sm text-muted-foreground capitalize">
                        {organization.type}
                      </p>
                    </div>
                  </div>
                  
                  {organization.website && (
                    <div className="flex gap-2">
                      <Globe className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <h4 className="text-sm font-medium">Website</h4>
                        <a 
                          href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline"
                        >
                          {organization.website}
                        </a>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium">Created</h4>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(organization.created_at), "MMMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">Quick Stats</h3>
              
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Members</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-muted/40 rounded-lg p-3 text-center">
                      <p className="text-xl font-semibold">{adminCount}</p>
                      <p className="text-xs text-muted-foreground">Admins</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-3 text-center">
                      <p className="text-xl font-semibold">{staffCount}</p>
                      <p className="text-xs text-muted-foreground">Staff</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-3 text-center">
                      <p className="text-xl font-semibold">{members.length}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Projects</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-muted/40 rounded-lg p-3 text-center">
                      <p className="text-xl font-semibold">{activeProjects}</p>
                      <p className="text-xs text-muted-foreground">Active</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-3 text-center">
                      <p className="text-xl font-semibold">{completedProjects}</p>
                      <p className="text-xs text-muted-foreground">Completed</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-3 text-center">
                      <p className="text-xl font-semibold">{projects.length}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </div>
                  </div>
                </div>
              </div>
              
              {userRole && projects.length > 0 && (
                <div className="mt-6">
                  <Separator className="my-4" />
                  <h4 className="text-sm font-medium mb-3">Recent Projects</h4>
                  <div className="space-y-2">
                    {projects.slice(0, 3).map((project) => (
                      <Link 
                        href={`/projects/${project.id}`}
                        key={project.id}
                        className="block p-2 rounded-md hover:bg-muted transition-colors"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium truncate">{project.title}</span>
                          <Badge 
                            variant={project.status === "active" ? "default" : 
                                   project.status === "completed" ? "secondary" : "outline"}
                            className="ml-2 text-xs"
                          >
                            {project.status}
                          </Badge>
                        </div>
                        {project.location && (
                          <div className="flex items-center text-xs text-muted-foreground mt-1">
                            <MapPin className="h-3 w-3 mr-1" />
                            <span className="truncate">{project.location}</span>
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        
        {userRole === "admin" && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-full bg-chart-6/10 text-chart-6">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Admin Tools</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    You have admin privileges for this organization.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/organization/${organization.username}/settings`}>
                      <Button variant="outline" className="cursor-pointer hover:bg-muted">
                        Organization Settings
                      </Button>
                    </Link>
                    <Link href={`/organization/${organization.id}/invite`}>
                      <Button variant="outline" className="cursor-pointer hover:bg-muted">
                        Invite Members
                      </Button>
                    </Link>
                    <Link href={`/projects/create?org=${organization.id}`}>
                      <Button variant="outline" className="cursor-pointer hover:bg-muted">
                        New Project
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>
      
      <TabsContent value="members">
        <MembersTab
          members={members}
          userRole={userRole}
          organizationId={organization.id}
          currentUserId={currentUserId}
        />
      </TabsContent>
      
      <TabsContent value="projects">
        <ProjectsTab
          projects={projects}
          organizationId={organization.id}
          userRole={userRole}
        />
      </TabsContent>
    </Tabs>
  );
}
