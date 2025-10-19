"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, Clock, CheckCircle, Printer, RefreshCw, ArrowUpDown, ChevronUp, ChevronDown, Loader2, UserRoundCheck, CalendarClock, AlertCircle } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Project } from "@/types";
import { format, parseISO, addHours, isBefore } from "date-fns";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { checkInUser, checkOutUser } from "@/app/attend/[projectId]/actions";

interface Props {
  projectId: string;
  initialAvailability: {
    isActive: boolean;
    earliestTime?: string;
    project?: Project;
  };
}

type Attendance = {
  id: string;
  check_in_time: string | null;
  check_out_time: string | null;
  schedule_id: string;
  user_id: string | null;
  anonymous_id: string | null;
  profile?: {
    full_name: string;
    username: string;
    email: string;
    phone?: string;
  };
  anonymous_signup?: {
    id: string;
    name: string;
    email: string;
    phone_number?: string | null;
  };
};

type SortField = "check_in_time" | "name";
type SortDirection = "asc" | "desc";

interface Sort {
  field: SortField;
  direction: SortDirection;
}

export function AttendanceClient({ projectId, initialAvailability }: Props): React.JSX.Element {
  const router = useRouter();
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [project, setProject] = useState<Project | null>(initialAvailability.project || null);
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  const [sort, setSort] = useState<Sort>({ field: "check_in_time", direction: "desc" });
  const [isAttendanceActive] = useState<boolean>(initialAvailability.isActive);
  const [earliestSessionTime] = useState<Date | null>(
    initialAvailability.earliestTime ? new Date(initialAvailability.earliestTime) : null
  );
  const [timeUntilOpen, setTimeUntilOpen] = useState<string>("");

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

  // Print attendance list
  const printAttendance = () => {
    // Create a hidden print-only container if it doesn't exist yet
    let printContainer = document.getElementById('print-container');
    if (!printContainer) {
      printContainer = document.createElement('div');
      printContainer.id = 'print-container';
      printContainer.className = 'hidden print:block';
      document.body.appendChild(printContainer);
    }

    // Generate HTML content for printing
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
        }
      </style>
      <h1>Attendance Record - ${project?.title || 'Project'}</h1>
      <div>Printed: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
      ${Object.entries(filteredAttendanceBySession).map(([session, sessionAttendance]) => {
        return sessionAttendance.length > 0 ? `
        <div class="session-attendance">
          <h2>${project && formatSessionName(project, session)}</h2>
          <table>
          <thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Check-in Time</th><th>Check-out Time</th></tr></thead>
          <tbody>
            ${sessionAttendance.map(a => {
              const isRegistered = !!a.user_id;
              const name = isRegistered ? a.profile?.full_name : a.anonymous_signup?.name;
              const email = isRegistered ? a.profile?.email : a.anonymous_signup?.email;
              const type = isRegistered ? 'Registered' : 'Anonymous';
              const checkInTime = a.check_in_time ? format(parseISO(a.check_in_time), 'MMM d, yyyy h:mm a') : 'N/A';
              const checkOutTime = a.check_out_time ? format(parseISO(a.check_out_time), 'MMM d, yyyy h:mm a') : 'N/A';

              return `
              <tr>
                <td>${name || 'N/A'}</td>
                <td>${email || 'N/A'}</td>
                <td>${type}</td>
                <td>${checkInTime}</td>
                <td>${checkOutTime}</td>
              </tr>
              `;
            }).join('')}
          </tbody>
          </table>
        </div>
        ` : '';
      }).join('')}
      ${Object.keys(filteredAttendanceBySession).length === 0 ? '<p>No attendance records found.</p>' : ''}
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

  // Group attendance by session
  const attendanceBySession = useMemo(() => {
    return attendance.reduce((acc, record) => {
      if (!acc[record.schedule_id]) {
        acc[record.schedule_id] = [];
      }
      acc[record.schedule_id].push(record);
      return acc;
    }, {} as Record<string, Attendance[]>);
  }, [attendance]);

  // Filter and sort attendance based on search term, session filter, and sort state
  const filteredAttendanceBySession = useMemo(() => {
    // First filter by session if needed
    let sessionData: Record<string, Attendance[]> = {};
    
    if (sessionFilter === "all") {
      sessionData = { ...attendanceBySession };
    } else {
      sessionData = {
        [sessionFilter]: attendanceBySession[sessionFilter] || []
      };
    }
    
    // Then filter by search term
    let filtered: Record<string, Attendance[]> = {};
    
    if (!searchTerm) {
      filtered = { ...sessionData };
    } else {
      const searchLower = searchTerm.toLowerCase();
      Object.entries(sessionData).forEach(([session, sessionAttendance]) => {
        const matchingAttendance = sessionAttendance.filter(record => {
          const nameMatch = record.user_id
            ? (record.profile?.full_name?.toLowerCase().includes(searchLower) || false)
            : (record.anonymous_signup?.name?.toLowerCase().includes(searchLower) || false);
          const emailMatch = record.user_id
            ? (record.profile?.email?.toLowerCase().includes(searchLower) || false)
            : (record.anonymous_signup?.email?.toLowerCase().includes(searchLower) || false);
          return nameMatch || emailMatch;
        });
        if (matchingAttendance.length > 0) {
          filtered[session] = matchingAttendance;
        }
      });
    }

    // Finally, sort each session's attendance records
    Object.keys(filtered).forEach(session => {
      filtered[session].sort((a, b) => {
        const direction = sort.direction === "asc" ? 1 : -1;
        
        if (sort.field === "check_in_time") {
          const timeA = a.check_in_time || '';
          const timeB = b.check_in_time || '';
          return (timeA.localeCompare(timeB)) * direction;
        }
        
        if (sort.field === "name") {
          const nameA = (a.user_id ? a.profile?.full_name : a.anonymous_signup?.name) || '';
          const nameB = (b.user_id ? b.profile?.full_name : b.anonymous_signup?.name) || '';
          return nameA.localeCompare(nameB) * direction;
        }
        
        return 0;
      });
    });

    return filtered;
  }, [attendanceBySession, searchTerm, sessionFilter, sort]);

  // Get all available sessions for the filter dropdown
  const availableSessions = useMemo(() => {
    return Object.keys(attendanceBySession);
  }, [attendanceBySession]);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  useEffect(() => {
    if (earliestSessionTime && !isAttendanceActive) {
      const now = new Date();
      const openTime = addHours(earliestSessionTime, -2);
      const diffMs = openTime.getTime() - now.getTime();
      
      if (diffMs > 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        setTimeUntilOpen(`${diffHours} hour${diffHours !== 1 ? 's' : ''} and ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`);
      }
    }
  }, [earliestSessionTime, isAttendanceActive]);

  useEffect(() => {
    if (project && isAttendanceActive) {
      loadAttendance();
    }
  }, [project, isAttendanceActive]);

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

  const loadAttendance = async () => {
    setRefreshing(true);
    const supabase = createClient();
    
    const { data, error } = await supabase
      .from("project_signups")
      .select(`
      id,
      check_in_time,
  check_out_time,
      schedule_id,
      user_id,
      anonymous_id,
      profile:profiles!left (
        full_name,
        username,
        email,
        phone
      ),
      anonymous_signup:anonymous_signups!project_signups_anonymous_id_fkey (
        id,
        name,
        email,
        phone_number
      )
      `)
      .eq("project_id", projectId)
      .order("check_in_time", { ascending: false });

    if (error) {
      console.error("Error loading attendance:", error);
      toast.error("Failed to load attendance records");
    } else {
      setAttendance(data as unknown as Attendance[]);
      if (refreshing) {
        toast.success("Attendance records refreshed successfully");
      }
    }
    
    setLoading(false);
    setRefreshing(false);
  };

  // Add new helper for manual check-in
  const handleManualCheckIn = async (signupId: string) => {
    try {
      const result = await checkInUser(signupId);
      if (result.success) {
        toast.success("User checked in successfully");
        loadAttendance(); // Refresh the list
      } else {
        toast.error(result.error || "Failed to check in user");
      }
    } catch {
      toast.error("Failed to check in user");
    }
  };

  const handleManualCheckOut = async (signupId: string) => {
    try {
      const result = await checkOutUser(signupId);
      if (result.success) {
        toast.success("User checked out successfully");
        loadAttendance();
      } else {
        toast.error(result.error || "Failed to check out user");
      }
    } catch {
      toast.error("Failed to check out user");
    }
  };

  const formatTimeTo12Hour = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const adjustedHours = hours % 12 || 12;
    return `${adjustedHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const formatSessionName = (project: Project, sessionId: string) => {
    if (!project) return sessionId;
  
    if (project.event_type === "oneTime") {
      if (sessionId === "oneTime" && project.schedule.oneTime) {
        const dateStr = project.schedule.oneTime.date;
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return `${format(date, "MMMM d, yyyy")} from ${formatTimeTo12Hour(project.schedule.oneTime.startTime)} to ${formatTimeTo12Hour(project.schedule.oneTime.endTime)}`;
      }
    }
  
    if (project.event_type === "multiDay") {
      const parts = sessionId.split("-");
      
      if (parts.length >= 2) {
        const slotIndex = parts.pop();
        const date = parts.join("-");
        
        const day = project.schedule.multiDay?.find(d => d.date === date);
        
        if (day && slotIndex !== undefined) {
          const slotIdx = parseInt(slotIndex, 10);
          const slot = day.slots[slotIdx];
          
          if (slot) {
            const [year, month, dayNum] = date.split('-').map(Number);
            const utcDate = new Date(year, month - 1, dayNum);
            return `${format(utcDate, "EEEE, MMMM d, yyyy")} from ${formatTimeTo12Hour(slot.startTime)} to ${formatTimeTo12Hour(slot.endTime)}`;
          }
        }
      }
    }
  
    if (project.event_type === "sameDayMultiArea") {
      const role = project.schedule.sameDayMultiArea?.roles.find(r => r.name === sessionId);
      
      if (role) {
        const eventDate = project.schedule.sameDayMultiArea?.date;
        if (eventDate) {
          const [year, month, day] = eventDate.split('-').map(Number);
          const utcDate = new Date(year, month - 1, day);
          return `${format(utcDate, "EEEE, MMMM d, yyyy")} - Role: ${role.name} (${formatTimeTo12Hour(role.startTime)} to ${formatTimeTo12Hour(role.endTime)})`;
        } else {
          return `Role: ${role.name} (${formatTimeTo12Hour(role.startTime)} to ${formatTimeTo12Hour(role.endTime)})`;
        }
      }
    }
  
    return sessionId;
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

      {!isAttendanceActive ? (
        <Card className="min-h-[400px] relative">
          <CardHeader>
            <CardTitle>Attendance Records</CardTitle>
            <CardDescription>
              Attendance management will be available soon
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center space-y-4">
            <div className="rounded-full bg-muted p-6 w-fit">
              <CalendarClock className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mt-6">Attendance management not yet available</h3>
            <p className="text-muted-foreground max-w-md">
              Attendance records will be available 2 hours before the event starts.
              {earliestSessionTime && timeUntilOpen && (
                <>
                  <br /><br />
                  <span className="block">
                    <AlertCircle className="inline-block h-4 w-4 mr-2 mb-1" />
                    Attendance will open in {timeUntilOpen}
                  </span>
                  <span className="block mt-2 text-sm">
                    First session starts at: {format(earliestSessionTime, "MMMM d, yyyy 'at' h:mm a")}
                  </span>
                </>
              )}
            </p>
          </CardContent>
          <CardFooter className="justify-center border-t p-4">
            <Button variant="outline" onClick={() => router.back()}>
              Return to Project
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card className="min-h-[400px] relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-2 mt-10">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading attendance records...</span>
              </div>
            </div>
          )}
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle>Attendance Records</CardTitle>
                <CardDescription>
                  {project?.verification_method === 'manual' 
                    ? "Check in volunteers and manage attendee records" 
                    : project?.verification_method === 'auto'
                    ? "View volunteer attendance (check-ins are automatic)"
                    : project?.verification_method === 'signup-only'
                    ? "View volunteer attendance records"
                    : "View and track check-ins for your project"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          
          {/* Display explanatory message for automatic or signup-only methods */}
          {(project?.verification_method === 'auto' || project?.verification_method === 'signup-only') && (
            <div className="mx-6 mb-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>
                  {project?.verification_method === 'auto' 
                    ? "Automatic Check-in Enabled" 
                    : "Sign-up Only Project"}
                </AlertTitle>
                <AlertDescription>
                  {project?.verification_method === 'auto'
                    ? "Volunteers will be automatically checked in at their scheduled start time. Manual check-in is not required."
                    : "This project is configured for sign-up tracking only. No check-in functionality is available."}
                </AlertDescription>
              </Alert>
            </div>
          )}

          <CardContent className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between">
              {/* Search input always full width on mobile */}
              <div className="flex flex-col gap-2 flex-1 sm:flex-row sm:items-center">
                <div className="relative w-full">
                  <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or email..."
                    className="pl-8 w-full"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    aria-label="Search by name or email"
                  />
                </div>
                {/* Session filter and action buttons row */}
                <div className="flex flex-row gap-2 w-full sm:w-auto items-center">
                  <Select
                    value={sessionFilter}
                    onValueChange={setSessionFilter}
                  >
                    <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter by session">
                      <SelectValue placeholder="Filter by session" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sessions</SelectItem>
                      {availableSessions.map(session => (
                        <SelectItem key={session} value={session}>
                          {formatSessionName(project as Project, session)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Action buttons: icons only on mobile, icons+text on desktop */}
                  <div className="flex flex-row gap-1 sm:gap-2">
                    <Button
                      variant="outline"
                      className="p-3 sm:gap-2"
                      onClick={printAttendance}
                      disabled={Object.keys(filteredAttendanceBySession).length === 0}
                      aria-label="Print Attendance"
                    >
                      <Printer className="h-4 w-4" />
                      <span className="hidden sm:inline">Print Attendance</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="p-3 sm:gap-2"
                      onClick={loadAttendance}
                      disabled={refreshing}
                      aria-label="Refresh"
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                      <span className="hidden sm:inline">Refresh</span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          
            {Object.entries(filteredAttendanceBySession).map(([session, sessionAttendance]) => (
              <div key={session} className="space-y-2">
                <h3 className="font-medium text-sm text-muted-foreground">
                  {project && formatSessionName(project, session)}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead 
                        className="cursor-pointer hover:text-foreground transition-colors"
                        onClick={() => toggleSort("name")}
                      >
                        <div className="flex items-center min-w-[120px]">
                          Name
                          {getSortIcon("name")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:text-foreground transition-colors"
                        onClick={() => toggleSort("check_in_time")}
                      >
                        <div className="flex items-center min-w-[115px]">
                          Check-in Time
                          {getSortIcon("check_in_time")}
                        </div>
                      </TableHead>
                      <TableHead>Check-out Time</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Actions</TableHead> {/* Changed from Type to Actions */}
                      
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionAttendance.map((record) => {
                      const isRegistered = !!record.user_id;
                      const name = isRegistered ? record.profile?.full_name : record.anonymous_signup?.name;
                      const email = isRegistered ? record.profile?.email : record.anonymous_signup?.email;
                      const phone = isRegistered ? record.profile?.phone : record.anonymous_signup?.phone_number;
                      const checkInTime = record.check_in_time ? format(parseISO(record.check_in_time), 'h:mm a') : 'N/A';
                      const checkOutTime = record.check_out_time ? format(parseISO(record.check_out_time), 'h:mm a') : 'N/A';

                      return (
                        <TableRow key={record.id}>
                          <TableCell className="font-medium">
                            {name || 'N/A'}
                          </TableCell>
                          <TableCell>
                              <Badge
                              variant={checkInTime !== "N/A" ? "default" : "outline"}
                              className="gap-1"
                              >
                              {checkInTime !== "N/A" ? (
                                <CheckCircle className="h-3 w-3 flex-shrink-0" aria-label="Checked in" />
                              ) : (
                                <Clock className="h-3 w-3 flex-shrink-0" aria-label="Not checked in" />
                              )}
                              {checkInTime}
                              </Badge>
                          </TableCell>
                          <TableCell>
                              <Badge
                              variant={checkOutTime !== "N/A" ? "default" : "outline"}
                              className="gap-1"
                              >
                              {checkOutTime !== "N/A" ? (
                                <CheckCircle className="h-3 w-3 flex-shrink-0" aria-label="Checked out" />
                              ) : (
                                <Clock className="h-3 w-3 flex-shrink-0" aria-label="Not checked out" />
                              )}
                              {checkOutTime}
                              </Badge>
                          </TableCell>
                          <TableCell><div className="flex flex-col gap-0.5">
                              <span>{email}</span>
                              {isRegistered && phone && (
                                  <span className="text-xs text-muted-foreground">
                                  {phone.replace(
                                    /^(\d{3})(\d{3})(\d{4})$/,
                                    "$1-$2-$3"
                                  )}
                                  </span>
                              )}
                              </div></TableCell>
                          <TableCell>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleManualCheckIn(record.id)}
                                disabled={!!record.check_in_time || project?.verification_method === 'auto' || project?.verification_method === 'signup-only'}
                                className={cn(
                                  (record.check_in_time || project?.verification_method === 'auto' || project?.verification_method === 'signup-only') && "opacity-50 cursor-not-allowed"
                                )}
                              >
                                Check in
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleManualCheckOut(record.id)}
                                disabled={!record.check_in_time || project?.verification_method === 'auto' || project?.verification_method === 'signup-only'}
                                className={cn(
                                  (!record.check_in_time || project?.verification_method === 'auto' || project?.verification_method === 'signup-only') && "opacity-50 cursor-not-allowed"
                                )}
                              >
                                Check out
                              </Button>
                            </div>
                          </TableCell>
                          
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}

            {Object.keys(filteredAttendanceBySession).length === 0 && !loading && (
              <div className="flex flex-col items-center text-muted-foreground space-y-2 py-10">
                <UserRoundCheck className="h-8 w-8 mt-10" />
                <p className="text-lg font-medium">No attendance records found</p>
                <p className="text-sm">No one has checked in yet or no records match your filters.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
