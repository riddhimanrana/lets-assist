"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MembersTab from "@/app/organization/[id]/MembersTab";
import ProjectsTab from "@/app/organization/[id]/ProjectsTab";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Users,
  Folders,
  Calendar,
  Building2,
  Globe,
  MapPin,
  ShieldCheck,
  LogOut,
  BarChart3
} from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose, DialogFooter } from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { leaveOrganization } from "@/app/organization/actions";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { getProjectStatus } from "@/utils/project";
import ReportsTab from "@/app/organization/[id]/ReportsTab";
import { cn } from "@/lib/utils";
import type { Organization, Project } from "@/types";

type OrganizationMember = {
  id: string;
  user_id: string;
  role: "admin" | "staff" | "member";
  joined_at: string;
  profiles?: {
    id?: string;
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  } | Array<{
    id?: string;
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  }> | null;
};

type OrganizationWithWebsite = Organization & {
  website?: string | null;
  created_at?: string | null;
};

interface OrganizationTabsProps {
  organization: OrganizationWithWebsite;
  members: OrganizationMember[];
  projects: Project[];
  userRole: string | null;
  currentUserId: string | undefined;
  reportSummary?: {
    totalHours: number;
    verifiedHours: number;
    pendingHours: number;
  } | null;
}

function LeaveOrganizationDialog({
  organization,
  userRole
}: {
  organization: Organization;
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
      <DialogTrigger
        render={
          <Button
            variant="outline"
            className="w-full sm:w-auto text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Leave Organization
          </Button>
        }
      />
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
  reportSummary,
}: OrganizationTabsProps) {
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const docEl = document.documentElement;
    let raf: number | null = null;

    const updateGutter = () => {
      if (activeTab !== "reports") {
        docEl.style.removeProperty("scrollbar-gutter");
        return;
      }

      const needsScroll = docEl.scrollHeight - docEl.clientHeight > 1;
      if (needsScroll) {
        docEl.style.scrollbarGutter = "stable";
      } else {
        docEl.style.removeProperty("scrollbar-gutter");
      }
    };

    raf = window.requestAnimationFrame(updateGutter);
    window.addEventListener("resize", updateGutter);

    return () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
      docEl.style.removeProperty("scrollbar-gutter");
      window.removeEventListener("resize", updateGutter);
    };
  }, [activeTab]);

  // Validate input data
  if (!Array.isArray(members)) {
    console.error("OrganizationTabs: members prop is not an array");
    return <div className="text-destructive">Error: Invalid members data</div>;
  }

  if (!Array.isArray(projects)) {
    console.error("OrganizationTabs: projects prop is not an array");
    return <div className="text-destructive">Error: Invalid projects data</div>;
  }

  // Calculate stats - using a stable value during hydration if needed
  // but better to just use them directly if projects are static
  const upcomingProjects = projects.filter(p => getProjectStatus(p) === "upcoming").length;
  const completedProjects = projects.filter(p => getProjectStatus(p) === "completed").length;
  const canViewReports = userRole === "admin" || userRole === "staff";

  return (
    <Tabs
      defaultValue="overview"
      value={activeTab}
      onValueChange={setActiveTab}
      className="w-full"
    >
      <TabsList className="mb-6 flex h-auto w-full sm:w-fit self-start max-w-full items-center justify-start overflow-x-auto bg-muted p-1 text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <TabsTrigger value="overview" className="flex-1 sm:flex-none min-w-0 gap-2 px-3">
          <LayoutDashboard className="h-4 w-4 shrink-0" />
          <span className="truncate">Overview</span>
        </TabsTrigger>
        <TabsTrigger value="members" className="flex-1 sm:flex-none min-w-0 gap-2 px-3">
          <Users className="h-4 w-4 shrink-0" />
          <span className="truncate">Members</span>
        </TabsTrigger>
        <TabsTrigger value="projects" className="flex-1 sm:flex-none min-w-0 gap-2 px-3">
          <Folders className="h-4 w-4 shrink-0" />
          <span className="truncate">Projects</span>
        </TabsTrigger>
        {canViewReports && (
          <TabsTrigger value="reports" className="flex-1 sm:flex-none min-w-0 gap-2 px-3">
            <BarChart3 className="h-4 w-4 shrink-0" />
            <span className="truncate">Reports</span>
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="overview" className="space-y-6">
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 items-stretch justify-items-center sm:justify-items-stretch">
          <Card className="flex flex-col overflow-hidden w-full max-w-[560px] sm:max-w-none">
            <CardHeader>
              <CardTitle className="text-xl! font-bold tracking-tight">About</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="min-w-0">
                <h4 className="text-xs font-medium text-muted-foreground mb-1">Description</h4>
                <div className="relative">
                  <p className="leading-relaxed wrap-break-word">
                    {organization.description || "No description provided."}
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex gap-2 min-w-0">
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-medium">Organization Type</h4>
                    <p className="text-muted-foreground capitalize truncate">
                      {organization.type}
                    </p>
                  </div>
                </div>
                {organization.website && (
                  <div className="flex gap-2 min-w-0">
                    <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-medium">Website</h4>
                      <Link
                        href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate block"
                      >
                        {organization.website}
                      </Link>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 min-w-0">
                  <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-medium">Created</h4>
                    <p className="text-muted-foreground truncate">
                      {organization.created_at
                        ? format(new Date(organization.created_at), "MMMM d, yyyy")
                        : "N/A"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="sm:mt-auto sm:pt-2" />
            </CardContent>
          </Card>
          {/* Quick Stats Card */}
          <Card className="flex flex-col overflow-hidden w-full max-w-[560px] sm:max-w-none">
            <CardHeader>
              <CardTitle className="text-xl! font-bold tracking-tight">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4">
                <div className="rounded-md border bg-muted/30 p-2.5 sm:p-3 flex flex-col items-center justify-center min-w-0">
                  <p className="text-base sm:text-lg font-semibold leading-none truncate w-full text-center">{members.length}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 text-center truncate w-full">Members</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-2.5 sm:p-3 flex flex-col items-center justify-center min-w-0">
                  <p className="text-base sm:text-lg font-semibold leading-none truncate w-full text-center">
                    {reportSummary ? reportSummary.totalHours.toFixed(1) : "0.0"}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 text-center truncate w-full">Hours</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-2.5 sm:p-3 flex flex-col items-center justify-center min-w-0">
                  <p className="text-base sm:text-lg font-semibold leading-none truncate w-full text-center">{upcomingProjects}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 text-center truncate w-full">Upcoming</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-2.5 sm:p-3 flex flex-col items-center justify-center min-w-0">
                  <p className="text-base sm:text-lg font-semibold leading-none truncate w-full text-center">{completedProjects}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 text-center truncate w-full">Completed</p>
                </div>
                <div className="col-span-2 rounded-md bg-primary/10 p-4 flex flex-col items-center justify-center min-w-0">
                  <p className="text-xl sm:text-2xl font-bold text-primary leading-none truncate w-full text-center">{projects.length}</p>
                  <p className="text-[11px] sm:text-sm font-medium text-primary mt-1 text-center truncate w-full">Total Projects</p>
                </div>
              </div>
              {projects.length > 0 && (
                <div className="mt-4 sm:mt-auto">
                  <Separator className="my-3" />
                  <h4 className="text-xs sm:text-sm font-medium mb-2">Recent Projects</h4>
                  <div className="space-y-1.5">
                    {projects.slice(0, 3).map((project) => (
                      <Link
                        href={`/projects/${project.id}`}
                        key={project.id}
                        className="block p-2 rounded-md border hover:bg-muted/70 transition-colors text-xs sm:text-sm overflow-hidden"
                      >
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1.5 min-w-0">
                          <span className="font-medium truncate flex-1">{project.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <ProjectStatusBadge status={getProjectStatus(project)} className="text-[10px] h-5" />
                          </div>
                        </div>
                        {project.location && (
                          <div className="flex items-center text-[10px] sm:text-xs text-muted-foreground mt-1 min-w-0">
                            <MapPin className="h-3 w-3 mr-1 shrink-0" />
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
          <Card className="overflow-hidden w-full max-w-[560px] sm:max-w-none">
            {userRole === "admin" ? (
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-2 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl! font-bold tracking-tight">Admin Tools</CardTitle>
                    <CardDescription className="text-xs">
                      You have admin privileges for this organization.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            ) : userRole === "staff" ? (
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-2 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                    <Folders className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl! font-bold tracking-tight">Staff Actions</CardTitle>
                    <CardDescription className="text-xs">
                      You can manage projects for this organization.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            ) : (
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-2 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl! font-bold tracking-tight">Member Actions</CardTitle>
                    <CardDescription className="text-xs">
                      Manage your membership in this organization.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            )}
            <CardContent className="text-sm">
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                {userRole === "admin" ? (
                  <>
                    <Link href={`/organization/${organization.username}/settings`}>
                      <Button variant="outline" className="w-full sm:w-auto cursor-pointer hover:bg-muted">
                        Organization Settings
                      </Button>
                    </Link>
                    <Dialog>
                      <DialogTrigger
                        render={
                          <Button
                            variant="outline"
                            className="w-full sm:w-auto cursor-pointer hover:bg-muted"
                          >
                            Apply for Verification
                          </Button>
                        }
                      />
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
                                <div className="bg-primary/10 p-3 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                                  <span className="text-primary font-semibold">1</span>
                                </div>
                                <div className="text-left">
                                  <p className="text-sm font-medium">Send Email</p>
                                  <p className="text-xs text-muted-foreground">Submit verification materials to <Link href="mailto:support@lets-assist.com" className="text-primary hover:underline">support@lets-assist.com</Link></p>
                                </div>
                              </div>

                              <div className="flex items-center gap-4">
                                <div className="bg-primary/10 p-3 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                                  <span className="text-primary font-semibold">2</span>
                                </div>
                                <div className="text-left">
                                  <p className="text-sm font-medium">Review Process</p>
                                  <p className="text-xs text-muted-foreground">We&apos;ll contact you shortly</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-4">
                                <div className="bg-primary/10 p-3 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
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

                        <DialogClose
                          render={<Button className="ml-auto">Close</Button>}
                          nativeButton={false}
                        />
                      </DialogContent>
                    </Dialog>
                  </>
                ) : userRole === "staff" ? (
                  <>
                    <Link href={`/projects/create?org=${organization.id}`}>
                      <Button variant="outline" className="w-full sm:w-auto cursor-pointer hover:bg-muted">
                        <Folders className="h-4 w-4 mr-2" />
                        Create Project
                      </Button>
                    </Link>
                    <LeaveOrganizationDialog
                      organization={organization}
                      userRole={userRole}
                    />
                  </>
                ) : (
                  <>
                    <LeaveOrganizationDialog
                      organization={organization}
                      userRole={userRole}
                    />
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

      {canViewReports && (
        <TabsContent value="reports">
          <ReportsTab
            organizationId={organization.id}
            organizationName={organization.name}
            userRole={userRole}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
