"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MembersTab from "./MembersTab";
import ProjectsTab from "./ProjectsTab";
import { useState } from "react";
import { Building2, Calendar, ClipboardList, Users } from "lucide-react";

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

  return (
    <Tabs
      defaultValue="overview"
      value={activeTab}
      onValueChange={setActiveTab}
      className="w-full"
    >
      <TabsList className="grid grid-cols-3 md:grid-cols-4 mb-8">
        <TabsTrigger value="overview" className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          <span className="hidden sm:inline">Overview</span>
        </TabsTrigger>
        <TabsTrigger value="members" className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <span className="hidden sm:inline">Members</span>
          <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-xs">
            {members.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="projects" className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4" />
          <span className="hidden sm:inline">Projects</span>
          <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-xs">
            {projects.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="events" className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          <span className="hidden sm:inline">Events</span>
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="overview" className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xl font-medium mb-3">About {organization.name}</h3>
            <p className="text-muted-foreground">
              {organization.description || "No description provided."}
            </p>
          </div>
          
          <div>
            <h3 className="text-xl font-medium mb-3">Recent Activity</h3>
            <div className="bg-muted/30 rounded-lg p-6 text-center">
              <p className="text-muted-foreground">Activity feed coming soon!</p>
            </div>
          </div>
        </div>
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
          userRole={userRole} 
          organizationId={organization.id} 
        />
      </TabsContent>
      
      <TabsContent value="events">
        <div className="text-center py-12">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">Events Coming Soon</h3>
          <p className="text-muted-foreground mt-2">
            Organization events will be available soon.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  );
}
