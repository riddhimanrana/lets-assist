"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { Project, EventType } from "@/types";
import { createRejectionNotification } from "../actions";
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
import { CheckCircle2, XCircle, Clock, ArrowLeft, Loader2, UserRoundSearch, ArrowUpDown, ChevronUp, ChevronDown, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Props {
  projectId: string;
}

type Signup = {
  id: string;
  created_at: string;
  status: "pending" | "cancelled";
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
  const [processingSignups, setProcessingSignups] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [sort, setSort] = useState<Sort>({ field: "status", direction: "asc" });

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
            /* Hide everything else when printing */
            body > *:not(#print-container) {
              display: none !important;
            }
            
            #print-container {
              display: block !important;
              width: 100% !important;
              font-family: Arial, sans-serif;
              margin: 20px;
              color: black !important; /* Ensure all text is black */
            }
            
            h1 { font-size: 24px; margin-bottom: 10px; color: black !important; }
            h2 { font-size: 18px; margin-top: 20px; margin-bottom: 8px; color: black !important; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; margin-bottom: 24px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; color: black !important; }
            th { background-color: #f2f2f2; color: black !important; }
            
            /* Hide the button itself when printing */
            .no-print { display: none !important; }
            
            /* Add page break before each new schedule slot */
            .page-break { page-break-before: always; }
          }
          
          /* For screen preview (normally hidden) */
          .print-content {
            font-family: Arial, sans-serif;
            padding: 20px;
          }
        </style>
        
        <div class="header">
          <h1>Approved Volunteer List - ${project?.title || 'Project'}</h1>
          <div class="print-date">Printed on: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
        </div>
        
        ${Object.entries(filteredSignupsBySlot).map(([slot, slotSignups]) => {
          // Filter to only include approved volunteers (status !== 'cancelled')
          const approvedSignups = slotSignups.filter(signup => signup.status !== 'cancelled');
          
          // Only include this slot if it has approved signups
          return approvedSignups.length > 0 ? `
            <div class="schedule-slot ${slot !== Object.keys(filteredSignupsBySlot)[0] ? 'page-break' : ''}">
              <h2>${project && formatScheduleSlot(project, slot)}</h2>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  ${approvedSignups.map(signup => `
                    <tr>
                      <td>${signup.user_id ? signup.profile?.full_name : signup.anonymous_name || 'N/A'}</td>
                      <td>${signup.user_id ? 'Registered User' : 'Anonymous'}</td>
                      <td>
                        ${signup.user_id 
                          ? `${signup.profile?.email || 'N/A'} ${signup.profile?.phone ? '<br>' + signup.profile.phone.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3") : ''}` 
                          : `${signup.anonymous_email || 'N/A'} ${signup.anonymous_phone ? '<br>' + signup.anonymous_phone.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3") : ''}`}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '';
        }).join('')}
        
        ${Object.entries(filteredSignupsBySlot).every(([_, slotSignups]) => 
          slotSignups.filter(signup => signup.status !== 'cancelled').length === 0) 
          ? '<p>No approved volunteers found.</p>' 
          : ''}
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
          const statusA = a.status === 'cancelled' ? 1 : 0; // 0 for Approved, 1 for Rejected
          const statusB = b.status === 'cancelled' ? 1 : 0;
          return (statusA - statusB) * direction;
        }
        
        // Add sorting for other fields here if needed
        // Example for name:
        // if (sort.field === 'name') {
        //   const nameA = (a.profile?.full_name || a.anonymous_name || '').toLowerCase();
        //   const nameB = (b.profile?.full_name || b.anonymous_name || '').toLowerCase();
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
  };

  const loadSignups = async () => {
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
      toast.error("Failed to load signups");
      return;
    }

    setSignups(data as unknown as Signup[]);
    setLoading(false);
  };

  const updateSignupStatus = async (signupId: string, status: "cancelled") => {
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

      // Send notification if user is registered
      if (signup.user_id) {
        const result = await createRejectionNotification(
          signup.user_id,
          projectId,
          signupId
        );
        
        if (result.error) {
          console.error("Error sending notification:", result.error);
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

  const formatScheduleSlot = (project: Project, slotId: string) => {
    if (!project) return slotId;

    if (project.event_type === "oneTime") {
      // Handle oneTime events - the scheduleId is simply "oneTime"
      if (slotId === "oneTime" && project.schedule.oneTime) {
        // Create date with UTC to prevent timezone offset issues
        const dateStr = project.schedule.oneTime.date;
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        return `One-time Event on ${format(date, "MMMM d, yyyy")} at ${project.schedule.oneTime.startTime}`;
      }
    }

    if (project.event_type === "multiDay") {
      // For multiDay events, the scheduleId format is "date-slotIndex"
      const [date, slotIndex] = slotId.split("-");
      const day = project.schedule.multiDay?.find(d => d.date === date);
      
      if (day && slotIndex !== undefined) {
        const slotIdx = parseInt(slotIndex, 10);
        const slot = day.slots[slotIdx];
        
        if (slot) {
          // Create date with UTC to prevent timezone offset issues
          const [year, month, dayNum] = date.split('-').map(Number);
          const utcDate = new Date(Date.UTC(year, month - 1, dayNum));
          return `${format(utcDate, "MMMM d, yyyy")} at ${slot.startTime}`;
        }
      }
    }

    if (project.event_type === "sameDayMultiArea") {
      // For sameDayMultiArea, the scheduleId is the role name
      const role = project.schedule.sameDayMultiArea?.roles.find(r => r.name === slotId);
      
      if (role) {
        const eventDate = project.schedule.sameDayMultiArea?.date;
        if (eventDate) {
          // Create date with UTC to prevent timezone offset issues
          const [year, month, day] = eventDate.split('-').map(Number);
          const utcDate = new Date(Date.UTC(year, month - 1, day));
          return `Role: ${role.name} on ${format(utcDate, "MMMM d, yyyy")}`;
        } else {
          return `Role: ${role.name}`;
        }
      }
    }

    return slotId;
  };

  const getStatusBadge = (status: string) => {
    if (status === "cancelled") {
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
          <CardTitle>Manage Volunteer Signups</CardTitle>
          <CardDescription>
            Review and manage volunteer signups.
          </CardDescription>
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
            <Button
              variant="outline"
              className="gap-2"
              onClick={printVolunteers}
              disabled={Object.keys(filteredSignupsBySlot).length === 0}
            >
              <Printer className="h-4 w-4" />
              Print Volunteer List
            </Button>
          </div>
          
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
                      onClick={() => updateSignupStatus(signup.id, "cancelled")}
                      disabled={signup.status === "cancelled" || processingSignups[signup.id]}
                    >
                      {signup.status === "cancelled" ? (
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
