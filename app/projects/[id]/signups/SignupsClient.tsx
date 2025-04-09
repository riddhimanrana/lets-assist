"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { Project, EventType } from "@/types";
import { NotificationService } from "@/services/notifications";
import { createRejectionNotification, togglePauseSignups } from "../actions";
import { format } from "date-fns";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Clock, ArrowLeft, Loader2, UserRoundSearch, ArrowUpDown, ChevronUp, ChevronDown, Printer, RefreshCw, Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface Props {
  projectId: string;
}

type Signup = {
  id: string;
  created_at: string;
  status: "pending" | "rejected" | "approved";
  user_id: string | null;
  anonymous_name: string | null;
  anonymous_email: string | null;
  anonymous_phone: string | null;
  schedule_id: string;
  profile?: {
    full_name: string;
    username: string;
    email: string;
    phone?: string;
  };
};

type SortField = "status"; // Add other fields like 'name', 'type', 'contact' if needed
type SortDirection = "asc" | "desc";

interface Sort {
  field: SortField;
  direction: SortDirection;
}

export function SignupsClient({ projectId }: Props): React.JSX.Element {
  const router = useRouter();
  const [signups, setSignups] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingSignups, setProcessingSignups] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [sort, setSort] = useState<Sort>({ field: "status", direction: "asc" });
  const [isPausingSignups, setIsPausingSignups] = useState(false);
  const [pausedSignups, setPausedSignups] = useState(false);

  const toggleSort = (field: SortField) => {
    setSort(current => ({
      field,
      direction: 
        current.field === field && current.direction === "asc" 
          ? "desc" 
          : "asc"
    }));
  };

  const getSortIcon = (field: SortField) => {
      if (sort.field !== field) return <ArrowUpDown className="h-4 w-4" />;
      return sort.direction === "asc" ? (
        <ChevronUp className="h-4 w-4" />
      ) : (
        <ChevronDown className="h-4 w-4" />
      );
    };

  // Print volunteers list
  const printVolunteers = () => {
    // Create a hidden print-only container if it doesn't exist yet
    let printContainer = document.getElementById('print-container');
    if (!printContainer) {
      printContainer = document.createElement('div');
      printContainer.id = 'print-container';
      printContainer.className = 'hidden print:block';
      document.body.appendChild(printContainer);
    }

    // Generate HTML content for printing - only approved volunteers
    const printContent = `
      <div class="print-content">
      <style>
        @media print {
        body > *:not(#print-container) { display: none !important; }
        #print-container { display: block !important; font-family: Arial, sans-serif; margin: 10px; color: black !important; }
        h1 { font-size: 18px; margin-bottom: 5px; }
        h2 { font-size: 14px; margin: 10px 0 5px; }
        table { width: 100%; border-collapse: collapse; margin: 5px 0; }
        th, td { border: 1px solid #ddd; padding: 4px; font-size: 12px; text-align: left; }
        th { background-color: #f2f2f2; }
        .no-print { display: none !important; }
        /* Removed page-break class */
        }
      </style>
      <h1>Approved Volunteers - ${project?.title || 'Project'}</h1>
      <div>Printed: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
      ${Object.entries(filteredSignupsBySlot).map(([slot, slotSignups]) => {
        const approved = slotSignups.filter(s => s.status !== "rejected");
        return approved.length > 0 ? `
        <div class="schedule-slot">
          <h2>${project && formatScheduleSlot(project, slot)}</h2>
          <table>
          <thead><tr><th>Name</th><th>Type</th><th>Contact</thead>
          <tbody>
            ${approved.map(s => `
            <tr>
              <td>${s.user_id ? s.profile?.full_name : s.anonymous_name || 'N/A'}</td>
              <td>${s.user_id ? 'Registered' : 'Anonymous'}</td>
              <td>${s.user_id 
              ? `${s.profile?.email || 'N/A'} ${s.profile?.phone ? '<br>' + s.profile.phone.replace(/(\\d{3})(\\d{3})(\\d{4})/, "$1-$2-$3") : ''}` 
              : `${s.anonymous_email || 'N/A'} ${s.anonymous_phone ? '<br>' + s.anonymous_phone.replace(/(\\d{3})(\\d{3})(\\d{4})/, "$1-$2-$3") : ''}`}</td>
            </tr>
            `).join('')}
          </tbody>
          </table>
        </div>
        ` : '';
      }).join('')}
      ${Object.entries(filteredSignupsBySlot).every(([_, slotSignups]) => slotSignups.filter(s => s.status !== 'rejected').length === 0) ? '<p>No approved volunteers found.</p>' : ''}
      </div>
    `;

    // Set the content and trigger print
    if (printContainer) {
      printContainer.innerHTML = printContent;
      
      // Give the browser a moment to render the content before printing
      setTimeout(() => {
        window.print();
      }, 100);
    }
  };

  // Group signups by schedule slot
  const signupsBySlot = useMemo(() => {
    return signups.reduce((acc, signup) => {
      if (!acc[signup.schedule_id]) {
        acc[signup.schedule_id] = [];
      }
      acc[signup.schedule_id].push(signup);
      return acc;
    }, {} as Record<string, Signup[]>);
  }, [signups]);

  // Filter and sort signups based on search term and sort state
  const filteredSignupsBySlot = useMemo(() => {
    let filtered: Record<string, Signup[]> = {};

    // Apply filtering first
    if (!searchTerm) {
      filtered = { ...signupsBySlot }; // Clone to avoid modifying original
    } else {
      const searchLower = searchTerm.toLowerCase();
      Object.entries(signupsBySlot).forEach(([slot, slotSignups]) => {
        const matchingSignups = slotSignups.filter(signup => {
          const nameMatch = signup.user_id
            ? signup.profile?.full_name.toLowerCase().includes(searchLower)
            : signup.anonymous_name?.toLowerCase().includes(searchLower);
          // Add more fields to search if needed (e.g., email)
          return nameMatch;
        });
        if (matchingSignups.length > 0) {
          filtered[slot] = matchingSignups;
        }
      });
    }

    // Apply sorting to each slot's signups
    Object.keys(filtered).forEach(slot => {
      filtered[slot].sort((a, b) => {
        const direction = sort.direction === "asc" ? 1 : -1;
        
        if (sort.field === "status") {
          // Sort logic: 'confirmed' (Approved) comes before 'cancelled' (Rejected) in asc order
          const statusA = a.status === 'rejected' ? 1 : 0; // 0 for Approved, 1 for Rejected
          const statusB = b.status === 'rejected' ? 1 : 0;
          return (statusA - statusB) * direction;
        }
        
        // Add sorting for other fields here if needed
        // Example for name:
        // if (sort.field === 'name') {
        //   const nameA = (a.profile?.full_name || a.anonymous_name || '').toLowerCase();
        //   const nameB = (b.profile?.full_name || a.anonymous_name || '').toLowerCase();
        //   return nameA.localeCompare(nameB) * direction;
        // }

        return 0; // Default: no change in order
      });
    });

    return filtered;
  }, [signupsBySlot, searchTerm, sort]);

  useEffect(() => {
    loadProject();
    loadSignups();
  }, [projectId]);

  const loadProject = async () => {
    const supabase = createClient();
    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (error) {
      console.error("Error loading project:", error);
      return;
    }

    setProject(project as Project);
    setPausedSignups(project.pause_signups || false);
  };

  const loadSignups = async () => {
    setRefreshing(true);
    const supabase = createClient();
    
    const { data, error } = await supabase
      .from("project_signups")
      .select(`
        id,
        created_at,
        status,
        user_id,
        anonymous_name,
        anonymous_email,
        anonymous_phone,
        schedule_id,
        profile:profiles!left (
          full_name,
          username,
          email,
          phone
        )
      `)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading signups:", error);
      console.log(error)
      toast.error("Failed to load signups");
    } else {
      setSignups(data as unknown as Signup[]);
      if (refreshing) {
        toast.success("Signups refreshed successfully");
      }
    }
    
    setLoading(false);
    setRefreshing(false);
  };

  const updateSignupStatus = async (signupId: string, status: "rejected") => {
    try {
      setProcessingSignups(prev => ({ ...prev, [signupId]: true }));
      const supabase = createClient();
      
      // Get the signup details first
      const { data: signup } = await supabase
        .from("project_signups")
        .select("user_id, project_id")
        .eq("id", signupId)
        .single();

      if (!signup) {
        throw new Error("Failed to get signup details");
      }

      // Update the signup status
      const { error: updateError } = await supabase
        .from("project_signups")
        .update({ status })
        .eq("id", signupId);

      if (updateError) {
        throw new Error("Failed to update signup status");
      }

      // Send notification if user is registered - directly from client
      if (signup.user_id) {
        // Get project title for the notification
        const { data: projectData } = await supabase
          .from("projects")
          .select("title")
          .eq("id", projectId)
          .single();
          
        if (projectData) {
          // Create notification directly using NotificationService
          await NotificationService.createNotification({
            title: "Project Status Update",
            body: `Your signup to volunteer for "${projectData.title}" has been rejected`,
            type: "project_updates",
            severity: "warning",
            actionUrl: `/projects/${projectId}`,
            data: { projectId, signupId }
          }, signup.user_id);
        }
      }

      // Refresh the signups list
      await loadSignups();
      toast.success("Signup rejected successfully");
    } catch (error) {
      console.error("Error updating signup:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update signup");
    } finally {
      setProcessingSignups(prev => ({ ...prev, [signupId]: false }));
    }
  };

  const togglePause = async () => {
    if (!project) return;
    
    try {
      setIsPausingSignups(true);
      const newPauseState = !pausedSignups;
      
      const result = await togglePauseSignups(projectId, newPauseState);
      
      if (result.error) {
        toast.error(result.error);
        return;
      }
      
      setPausedSignups(newPauseState);
      toast.success(newPauseState 
        ? "Signups have been paused" 
        : "Signups have been resumed");
    } catch (error) {
      console.error("Error toggling pause state:", error);
      toast.error("Failed to update signup status");
    } finally {
      setIsPausingSignups(false);
    }
  };

  const formatTimeTo12Hour = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const adjustedHours = hours % 12 || 12;
    return `${adjustedHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const formatScheduleSlot = (project: Project, slotId: string) => {
    if (!project) return slotId;
  
    if (project.event_type === "oneTime") {
      // Handle oneTime events - the scheduleId is simply "oneTime"
      if (slotId === "oneTime" && project.schedule.oneTime) {
        // Create date with no timezone offset issues
        const dateStr = project.schedule.oneTime.date;
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return `${format(date, "MMMM d, yyyy")} from ${formatTimeTo12Hour(project.schedule.oneTime.startTime)} to ${formatTimeTo12Hour(project.schedule.oneTime.endTime)}`;
      }
    }
  
    if (project.event_type === "multiDay") {
      // For multiDay events, the scheduleId format is "date-slotIndex"
      const parts = slotId.split("-");
      
      // Make sure we have at least 2 parts (date and slotIndex)
      if (parts.length >= 2) {
        // Last part is the slot index
        const slotIndex = parts.pop();
        // Everything else is the date (in case the date has hyphens)
        const date = parts.join("-");
        
        const day = project.schedule.multiDay?.find(d => d.date === date);
        
        if (day && slotIndex !== undefined) {
          const slotIdx = parseInt(slotIndex, 10);
          const slot = day.slots[slotIdx];
          
          if (slot) {
            // Create date with no timezone offset issues
            const [year, month, dayNum] = date.split('-').map(Number);
            // Use Date to correctly handle timezones
            const utcDate = new Date(year, month - 1, dayNum);
            return `${format(utcDate, "EEEE, MMMM d, yyyy")} from ${formatTimeTo12Hour(slot.startTime)} to ${formatTimeTo12Hour(slot.endTime)}`;
          }
        }
      }
    }
  
    if (project.event_type === "sameDayMultiArea") {
      // For sameDayMultiArea, the scheduleId is the role name
      const role = project.schedule.sameDayMultiArea?.roles.find(r => r.name === slotId);
      
      if (role) {
        const eventDate = project.schedule.sameDayMultiArea?.date;
        if (eventDate) {
          // Create date with no timezone offset issues
          const [year, month, day] = eventDate.split('-').map(Number);
          // Use Date to correctly handle timezones
          const utcDate = new Date(year, month - 1, day);
          return `${format(utcDate, "EEEE, MMMM d, yyyy")} - Role: ${role.name} (${formatTimeTo12Hour(role.startTime)} to ${formatTimeTo12Hour(role.endTime)})`;
        } else {
          return `Role: ${role.name} (${formatTimeTo12Hour(role.startTime)} to ${formatTimeTo12Hour(role.endTime)})`;
        }
      }
    }
  
    return slotId;
  };

  const getStatusBadge = (status: string) => {
    if (status === "rejected") {
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-4 w-4" />
          Rejected
        </Badge>
      );
    }
    return (
      <Badge className="gap-1">
        <CheckCircle2 className="h-4 w-4" />
        Approved
      </Badge>
    );
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="mb-6">
        <Button
          variant="ghost"
          className="gap-2"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Project
        </Button>
      </div>

      <Card className="min-h-[400px] relative">
      
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-2 mt-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading signups...</span>
            </div>
          </div>
        )}
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>Manage Volunteer Signups</CardTitle>
              <CardDescription>
                Review and manage volunteer signups.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center space-x-2">
                <Switch
                  id="pause-signups"
                  checked={pausedSignups}
                  onCheckedChange={togglePause}
                  disabled={isPausingSignups}
                />
                <Label htmlFor="pause-signups" className="flex items-center gap-2 cursor-pointer">
                  {pausedSignups ? (
                    <>
                      <Pause className="h-4 w-4 text-chart-4" />
                      <span>Signups Paused</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 text-chart-5" />
                      <span>Accepting Signups</span>
                    </>
                  )}
                  {isPausingSignups && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                </Label>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={printVolunteers}
                disabled={Object.keys(filteredSignupsBySlot).length === 0}
              >
                <Printer className="h-4 w-4" />
                Print Volunteer List
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={loadSignups}
                disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
          
          {project?.pause_signups && (
            <Alert className="bg-chart-4/15 border-chart-4/50 mb-4">
            <Pause className="h-4 w-4 text-chart-4" />
            <AlertTitle className="text-chart-4/90">
              Signups are currently paused
            </AlertTitle>
            <AlertDescription className="text-chart-4">
            New volunteer signups are disabled. Toggle the switch above to resume accepting volunteers.
            </AlertDescription>
          </Alert>
          )}
          
          {Object.entries(filteredSignupsBySlot).map(([slot, slotSignups]) => (
            <div key={slot} className="space-y-2">
              <h3 className="font-medium text-sm text-muted-foreground">
                {project && formatScheduleSlot(project, slot)}
              </h3>
              <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead 
                  className="cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => toggleSort("status")}
                >
                  <div className="flex items-center">
                    Status
                    {getSortIcon("status")}
                  </div>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slotSignups.map((signup) => (
                <TableRow key={signup.id}>
                  <TableCell className="font-medium">
                    {signup.user_id 
                      ? signup.profile?.full_name 
                      : signup.anonymous_name}
                  </TableCell>
                  <TableCell>
                    {signup.user_id ? (
                      <Link
                      href={`/profile/${signup.profile?.username}`}
                      className="text-primary"
                      >
                      Registered User
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Anonymous</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {signup.user_id ? (
                        <div>
                        <div>{signup.profile?.email}</div>
                        {signup.profile?.phone && (
                          <div className="text-sm text-muted-foreground">
                          {signup.profile.phone.replace(
                            /(\d{3})(\d{3})(\d{4})/,
                            "$1-$2-$3"
                          ) || "No phone provided"}
                          </div>
                        )}
                        </div>
                    ) : (
                      <div>
                        <div>{signup.anonymous_email || "No email provided"}</div>
                        <div className="text-sm text-muted-foreground">
                          {signup.anonymous_phone?.replace(
                            /(\d{3})(\d{3})(\d{4})/,
                            "$1-$2-$3"
                          ) || "No phone provided"}
                        </div>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{getStatusBadge(signup.status)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => updateSignupStatus(signup.id, "rejected")}
                      disabled={signup.status === "rejected" || processingSignups[signup.id]}
                    >
                      {signup.status === "rejected" ? (
                        "Rejected"
                      ) : processingSignups[signup.id] ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          <span className="inline-block">Rejecting...</span>
                        </>
                      ) : (
                        "Reject"
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && slotSignups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <div className="text-muted-foreground">
                      No signups found for your search criteria.
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
            </div>
          ))}

          {Object.keys(filteredSignupsBySlot).length === 0 && !loading && (
            <div className="flex flex-col items-center text-muted-foreground space-y-2">
            <UserRoundSearch className="h-8 w-8 mt-10" />
            <p className="text-lg font-medium">No signups found</p>
            <p className="text-sm">Try adjusting your search or check back later.</p>
          </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
