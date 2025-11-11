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
  ShieldCheck,
  LogOut
} from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { Button } from "@/components/ui/button"; 
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose, DialogFooter } from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { leaveOrganization } from "../actions";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { getProjectStatus } from "@/utils/project";

interface OrganizationTabsProps {
  organization: any;
  members: any[];
  projects: any[];
  userRole: string | null;
  currentUserId: string | undefined;
}

function LeaveOrganizationDialog({ 
  organization, 
  userRole 
}: { 
  organization: any;
  userRole: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const router = useRouter();

  const handleLeave = async () => {
    setIsLeaving(true);
    try {
      const result = await leaveOrganization(organization.id);
      
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Successfully left the organization");
      router.push("/organization");
    } catch (error) {
      console.error("Error leaving organization:", error);
      toast.error("Failed to leave organization");
    } finally {
      setIsLeaving(false);
      setIsOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          className="text-destructive hover:bg-destructive/10"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Leave Organization
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave Organization</DialogTitle>
          <DialogDescription>
            Are you sure you want to leave this organization? You will lose access to all organization resources.
            {userRole === "admin" && (
              <div className="mt-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                As an admin, you cannot leave if you are the last admin. Please promote another member to admin first.
              </div>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setIsOpen(false)}
            disabled={isLeaving}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleLeave}
            disabled={isLeaving}
          >
            {isLeaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Leaving...
              </>
            ) : (
              "Leave Organization"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function OrganizationTabs({
  organization,
  members,
  projects,
  userRole,
  currentUserId,
}: OrganizationTabsProps) {
  const [activeTab, setActiveTab] = useState("overview");
  // Removed collapsible description per request; keeping state commented for easy restore.
  // const [showFullDescription, setShowFullDescription] = useState(false);

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
  const upcomingProjects = projects.filter(p => getProjectStatus(p) === "upcoming").length;
  const completedProjects = projects.filter(p => getProjectStatus(p) === "completed").length;
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
        <div className="grid gap-5 md:gap-6 md:grid-cols-2 items-stretch">
          {/* About Card */}
          <Card className="flex flex-col">
            <CardContent className="p-5 sm:p-6 flex flex-col flex-1">
              <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">About</h3>
              <div className="space-y-4 flex-1">
                <div>
                  <h4 className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Description</h4>
                  <div className="relative">
                    <p className="text-xs sm:text-sm break-words leading-relaxed">
                      {organization.description || "No description provided."}
                    </p>
                    { /* Collapsible description logic removed */ }
                </div>
                </div>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs sm:text-sm font-medium">Organization Type</h4>
                      <p className="text-xs sm:text-sm text-muted-foreground capitalize">
                        {organization.type}
                      </p>
                    </div>
                  </div>
                  {organization.website && (
                    <div className="flex gap-2">
                      <Globe className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs sm:text-sm font-medium">Website</h4>
                        <Link
                          href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs sm:text-sm text-primary hover:underline break-all"
                        >
                          {organization.website}
                        </Link>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs sm:text-sm font-medium">Created</h4>
                      <p className="text-xs sm:text-sm text-muted-foreground">
                        {format(new Date(organization.created_at), "MMMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-auto pt-2" />
              </div>
            </CardContent>
          </Card>
          {/* Quick Stats Card */}
          <Card className="flex flex-col">
            <CardContent className="p-5 sm:p-6 flex flex-col flex-1">
              <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Quick Stats</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 mb-4">
                <div className="rounded-md border bg-muted/30 p-3 flex flex-col items-center justify-center">
                  <p className="text-base sm:text-lg font-semibold leading-none">{members.length}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Members</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 flex flex-col items-center justify-center">
                  <p className="text-base sm:text-lg font-semibold leading-none">0</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Hours</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 flex flex-col items-center justify-center">
                  <p className="text-base sm:text-lg font-semibold leading-none">{upcomingProjects}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 text-center">Upcoming</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 flex flex-col items-center justify-center">
                  <p className="text-base sm:text-lg font-semibold leading-none">{completedProjects}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 text-center">Completed</p>
                </div>
                <div className="col-span-2 sm:col-span-3 rounded-md bg-primary/10 p-4 flex flex-col items-center justify-center">
                  <p className="text-xl sm:text-2xl font-bold text-primary leading-none">{projects.length}</p>
                  <p className="text-[11px] sm:text-sm font-medium text-primary mt-1">Total Projects</p>
                </div>
              </div>
              {projects.length > 0 && (
                <div className="mt-auto">
                  <Separator className="my-3" />
                  <h4 className="text-xs sm:text-sm font-medium mb-2">Recent Projects</h4>
                  <div className="space-y-1.5">
                    {projects.slice(0, 3).map((project) => (
                      <Link
                        href={`/projects/${project.id}`}
                        key={project.id}
                        className="block p-2 rounded-md border hover:bg-muted/70 transition-colors text-xs sm:text-sm"
                      >
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1.5">
                          <span className="font-medium truncate pr-2">{project.title}</span>
                          <div className="flex items-center gap-2">
                            <ProjectStatusBadge status={getProjectStatus(project)} className="flex-shrink-0" />
                          </div>
                        </div>
                        {project.location && (
                          <div className="flex items-center text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                            <MapPin className="h-3 w-3 mr-1 flex-shrink-0" />
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
        
  {userRole && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
          {userRole === "admin" ? (
            <>
              <div className="bg-primary/10 p-3 rounded-full h-12 w-12 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <div className="w-full">
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
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" className="cursor-pointer hover:bg-muted">
                  Apply for Verification
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-bold text-center pb-2">
              Organization Verification
                  </DialogTitle>
                  <DialogDescription className="text-center text-base">
              Get your organization verified to build trust with volunteers and partners
                  </DialogDescription>
                </DialogHeader>
                
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
              <div className="bg-primary/10 p-2 rounded-full">
              <Globe className="h-4 w-4 text-primary" />
              </div>
              <div>
              <h3 className="font-medium text-sm">Official Email Verification</h3>
              <p className="text-xs text-muted-foreground">Send email from your domain to <span className="text-primary">support@lets-assist.com</span></p>
              </div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
              <div className="bg-primary/10 p-2 rounded-full">
              <Folders className="h-4 w-4 text-primary" />
              </div>
              <div>
              <h3 className="font-medium text-sm">Portfolio Evidence</h3>
              <p className="text-xs text-muted-foreground">Submit documentation of previous projects</p>
              </div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
              <div className="bg-primary/10 p-2 rounded-full">
              <Calendar className="h-4 w-4 text-primary" />
              </div>
              <div>
              <h3 className="font-medium text-sm">Activity Records</h3>
              <p className="text-xs text-muted-foreground">Provide proof of volunteer hours and initiatives</p>
              </div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
              <div className="bg-primary/10 p-2 rounded-full">
              <ShieldCheck className="h-4 w-4 text-primary" />
              </div>
              <div>
              <h3 className="font-medium text-sm">Legal Documentation</h3>
              <p className="text-xs text-muted-foreground">Submit registration certificates or credentials</p>
              </div>
                  </div>
                  </div>
                  
              <div className="mt-10 flex justify-center">
                <div className="space-y-6 max-w-sm mt-6">
                <div className="flex items-center gap-4">
                  <div className="bg-primary/10 p-3 rounded-full h-10 w-10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-semibold">1</span>
                  </div>
                  <div className="text-left">
                  <p className="text-sm font-medium">Send Email</p>
                  <p className="text-xs text-muted-foreground">Submit verification materials to <Link href="mailto:support@lets-assist.com" className="text-primary hover:underline">support@lets-assist.com</Link></p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="bg-primary/10 p-3 rounded-full h-10 w-10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-semibold">2</span>
                  </div>
                  <div className="text-left">
                  <p className="text-sm font-medium">Review Process</p>
                  <p className="text-xs text-muted-foreground">We&apos;ll contact you shortly</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="bg-primary/10 p-3 rounded-full h-10 w-10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-semibold">3</span>
                  </div>
                  <div className="text-left">
                  <p className="text-sm font-medium">Get Verified</p>
                  <p className="text-xs text-muted-foreground">Receive verified badge</p>
                  </div>
                </div>
                </div>
              </div>
                  </div>
                
                  <DialogClose asChild>
              <Button className="ml-auto">Close</Button>
                  </DialogClose>
              </DialogContent>
            </Dialog>
                </div>
              </div>
            </>
          ) : userRole === "staff" ? (
            <>
              <div className="bg-primary/10 p-3 rounded-full h-12 w-12 flex items-center justify-center flex-shrink-0">
                <Folders className="h-6 w-6 text-primary" />
              </div>
              <div className="w-full">
                <h3 className="font-semibold mb-1">Staff Actions</h3>
                <p className="text-sm text-muted-foreground mb-3">
            You can manage projects for this organization
                </p>
                <div className="flex flex-wrap gap-2">
            <Link href={`/projects/create?org=${organization.id}`}>
              <Button variant="outline" className="cursor-pointer hover:bg-muted">
                <Folders className="h-4 w-4 mr-2" />
                Create Project
              </Button>
            </Link>
            <LeaveOrganizationDialog 
              organization={organization}
              userRole={userRole}
            />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-primary/10 p-3 rounded-full h-12 w-12 flex items-center justify-center flex-shrink-0">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div className="w-full">
                <h3 className="font-semibold mb-1">Member Actions</h3>
                <p className="text-sm text-muted-foreground mb-3">
            Manage your membership in this organization
                </p>
                <LeaveOrganizationDialog 
            organization={organization}
            userRole={userRole}
                />
              </div>
            </>
          )}
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
