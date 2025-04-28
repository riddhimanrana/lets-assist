"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Project, ProjectSignup } from "@/types"; // Use ProjectSignup type
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, Clock, CheckCircle, RefreshCw, Loader2, UserRoundCheck, Edit, AlertCircle, PencilLine } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { format, parseISO, differenceInMinutes, isAfter, isValid } from "date-fns";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// Remove the DateTimePicker import and add TimePicker
import { TimePicker } from "@/components/ui/time-picker";
// Import necessary utils if needed (like formatSessionName, formatTimeTo12Hour)
import { formatTimeTo12Hour } from "@/lib/utils"; // Assuming this exists and works

// Define the structure for edited times
type EditedTime = {
  check_in_time: string | null;
  check_out_time: string | null; // Add check_out_time
};

// Import or define ProjectSession type
type ProjectSession = {
  id: string;
  name: string;
  endDateTime: Date;
  hoursRemaining: number;
};

interface Props {
  project: Project;
  initialSignups: ProjectSignup[];
  hoursUntilWindowCloses: number | null;
  activeSessions: ProjectSession[];
}

export function HoursClient({ project, initialSignups, hoursUntilWindowCloses, activeSessions }: Props): React.JSX.Element {
  const router = useRouter();
  const [signups, setSignups] = useState<ProjectSignup[]>(initialSignups);
  const [loading, setLoading] = useState(false); // Initially false as data comes from server
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  
  // Track which sessions are currently being published
  const [publishingSessions, setPublishingSessions] = useState<Record<string, boolean>>({});

  // Log initial data for debugging
  useEffect(() => {
    console.log("HoursClient initialized with:", {
      projectId: project.id,
      eventType: project.event_type,
      signupsCount: initialSignups.length,
      activeSessionsCount: activeSessions.length
    });
    
    // Log the first few signups
    if (initialSignups.length > 0) {
      console.log("Sample signups:", initialSignups.slice(0, 3).map(s => ({
        id: s.id,
        scheduleId: s.schedule_id,
        status: s.status,
        checkIn: s.check_in_time,
        checkOut: s.check_out_time,
        name: s.profile?.full_name || s.anonymous_signup?.name
      })));
    } else {
      console.log("No initial signups provided");
    }
  }, [project.id, project.event_type, initialSignups, activeSessions]);

  // State to hold edited times, keyed by signup ID
  const [editedTimes, setEditedTimes] = useState<Record<string, EditedTime>>({});

  // Initialize editedTimes state when initialSignups change
  useEffect(() => {
    const initialEdits: Record<string, EditedTime> = {};
    initialSignups.forEach(signup => {
      // --- CORRECTED ACCESS ---
      initialEdits[signup.id] = {
        check_in_time: signup.check_in_time ?? null, // Ensure type is string | null
        check_out_time: signup.check_out_time || null // Use check_out_time if available
      };
      // --- END CORRECTION ---
    });
    setEditedTimes(initialEdits);
  }, [initialSignups]);


  // --- TODO: Add functions for: ---
  // - handleTimeChange(signupId, field, value) -> Update editedTimes state
  // - calculateDuration(checkIn, checkOut) -> Calculate and format duration string
  // - handlePublishHours() -> Call server action to save hours and generate certificates
  // - loadSignups() -> Function to refresh data from server if needed
  // - formatSessionName() -> Adapt from AttendanceClient or import
  // ---------------------------------

   // Enhanced formatSessionName function
   const formatSessionName = (proj: Project, sessionId: string): string => {
     if (!proj) return sessionId;
     
     // One-time events
     if (proj.event_type === "oneTime" && sessionId === "oneTime" && proj.schedule.oneTime) {
       const date = parseISO(proj.schedule.oneTime.date);
       const startTime = formatTimeTo12Hour(proj.schedule.oneTime.startTime);
       const endTime = formatTimeTo12Hour(proj.schedule.oneTime.endTime);
       return `${format(date, "MMMM d, yyyy")} (${startTime} - ${endTime})`;
     }
     
     // Multi-day events
     if (proj.event_type === "multiDay" && sessionId.startsWith("day-") && proj.schedule.multiDay) {
       const parts = sessionId.split('-');
       if (parts.length >= 4) {
         const dayIndex = parseInt(parts[1], 10);
         const slotIndex = parseInt(parts[3], 10);
         
         if (proj.schedule.multiDay[dayIndex] && proj.schedule.multiDay[dayIndex].slots[slotIndex]) {
           const day = proj.schedule.multiDay[dayIndex];
           const slot = day.slots[slotIndex];
           const date = parseISO(day.date);
           const startTime = formatTimeTo12Hour(slot.startTime);
           const endTime = formatTimeTo12Hour(slot.endTime);
           
           return `${format(date, "MMMM d, yyyy")} (${startTime} - ${endTime})`;
         }
       }
     }
     
     // Same-day multi-area events
     if (proj.event_type === "sameDayMultiArea" && sessionId.startsWith("role-") && proj.schedule.sameDayMultiArea) {
       const roleIndex = parseInt(sessionId.split('-')[1], 10);
       if (proj.schedule.sameDayMultiArea.roles[roleIndex]) {
         const role = proj.schedule.sameDayMultiArea.roles[roleIndex];
         const date = parseISO(proj.schedule.sameDayMultiArea.date);
         const startTime = formatTimeTo12Hour(role.startTime);
         const endTime = formatTimeTo12Hour(role.endTime);
         
         return `${format(date, "MMMM d, yyyy")} - ${role.name} (${startTime} - ${endTime})`;
       }
     }
     
     return sessionId; // Fallback if no formatting rules matched
   };

  // Convert ISO string to Date object
  const isoStringToDate = (isoString: string | null | undefined): Date | null => {
    if (!isoString) return null;
    try {
      const date = new Date(isoString);
      return isValid(date) ? date : null;
    } catch {
      return null;
    }
  };

  // Helper to format Date and Time for display (if needed elsewhere)
  const formatDateTimeForDisplay = (isoString: string | null | undefined): string => {
    if (!isoString) return 'N/A';
    try {
      return format(parseISO(isoString), "MMM d, yyyy h:mm a");
    } catch {
      return 'Invalid date';
    }
  };

  // Enhanced duration calculation with validation
  const calculateDuration = (checkInISO: string | null, checkOutISO: string | null): {
    text: string;
    isValid: boolean;
    minutes: number;
  } => {
    if (!checkInISO || !checkOutISO) {
      return { text: '--:--', isValid: false, minutes: 0 };
    }
    
    try {
      const checkIn = parseISO(checkInISO);
      const checkOut = parseISO(checkOutISO);
      const diffMins = differenceInMinutes(checkOut, checkIn);
      
      // Various validation checks
      if (diffMins < 0) {
        return { text: 'Invalid: Check-out before check-in', isValid: false, minutes: 0 };
      }
      
      // Check for unreasonably long duration (more than 24 hours)
      if (diffMins > 24 * 60) {
        return { 
          text: `${Math.floor(diffMins / 60)}h ${diffMins % 60}m (Excessive)`, 
          isValid: false, 
          minutes: diffMins 
        };
      }
      
      // Valid duration
      const hours = Math.floor(diffMins / 60);
      const minutes = diffMins % 60;
      return { 
        text: `${hours}h ${minutes}m`, 
        isValid: true, 
        minutes: diffMins 
      };
    } catch {
      return { text: 'Error parsing dates', isValid: false, minutes: 0 };
    }
  };

  // Handler for DateTimePicker changes
  const handleTimeChange = (signupId: string, field: keyof EditedTime, timeStr: string) => {
    // Get existing date from the current value
    const currentValue = editedTimes[signupId]?.[field];
    let date = currentValue ? new Date(currentValue) : new Date();
    
    // Parse the new time string (format: "HH:mm")
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // Update just the time portion of the date
    date.setHours(hours, minutes);
    
    setEditedTimes(prev => ({
      ...prev,
      [signupId]: {
        ...prev[signupId],
        [field]: date.toISOString(),
      }
    }));
  };

  // Enhanced publish function for individual sessions
  const handlePublishHours = async (sessionId: string) => {
    // Mark this session as publishing
    setPublishingSessions(prev => ({
      ...prev,
      [sessionId]: true
    }));
    
    try {
      console.log(`Publishing hours for session ${sessionId}`);
      
      // Find all signups for this session
      let sessionSignups: ProjectSignup[] = [];
      
      // Try exact match first
      if (signupsBySession[sessionId]) {
        sessionSignups = signupsBySession[sessionId];
      } else {
        // Try all alternative IDs
        const session = getAllProjectSessions.find(s => s.id === sessionId);
        if (session) {
          for (const altId of session.alternativeIds) {
            if (signupsBySession[altId]) {
              sessionSignups = signupsBySession[altId];
              console.log(`Found signups using alternative ID ${altId} for session ${sessionId}`);
              break;
            }
          }
        }
      }
      
      // Get all edited times for signups in this session
      const sessionData = sessionSignups.map(signup => {
        const edit = editedTimes[signup.id] || { check_in_time: null, check_out_time: null };
        const duration = calculateDuration(edit.check_in_time, edit.check_out_time);
        
        return {
          signupId: signup.id,
          userId: signup.user_id,
          profileData: signup.profile,
          name: signup.user_id ? signup.profile?.full_name : signup.anonymous_signup?.name,
          email: signup.user_id ? signup.profile?.email : signup.anonymous_signup?.email,
          checkIn: edit.check_in_time,
          checkOut: edit.check_out_time,
          durationMinutes: duration.minutes,
          isValid: duration.isValid
        };
      });
      
      // Check if any durations are invalid
      const invalidEntries = sessionData.filter(entry => !entry.isValid);
      if (invalidEntries.length > 0) {
        console.error("Invalid time entries detected:", invalidEntries);
        toast.error(`${invalidEntries.length} volunteer${invalidEntries.length > 1 ? 's have' : ' has'} invalid hours. Please fix before publishing.`);
        return;
      }
      
      // TODO: Call server action to publish hours for this session
      console.log("Publishing data:", sessionData);
      
      // Simulate server call
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Show success message
      const volunteerCount = sessionData.length;
      toast.success(`Published hours for ${volunteerCount} volunteer${volunteerCount !== 1 ? 's' : ''} in this session!`);
      
      // Optionally refresh data or mark session as published
      // e.g. router.refresh();
    } catch (error) {
      console.error("Error publishing hours:", error);
      toast.error("Failed to publish volunteer hours. Please try again.");
    } finally {
      // Clear publishing state for this session
      setPublishingSessions(prev => ({
        ...prev,
        [sessionId]: false
      }));
    }
  };

  // Group signups by session (similar to AttendanceClient)
  const signupsBySession = useMemo(() => {
    return signups.reduce((acc, record) => {
      // Include both 'attended' and 'approved' signups with check-in data
      if ((record.status === 'attended' || record.status === 'approved') && record.check_in_time) {
        // Make sure we have a valid schedule_id
        const scheduleId = record.schedule_id || 'unknown';
         
        if (!acc[scheduleId]) {
          acc[scheduleId] = [];
        }
        acc[scheduleId].push(record);
        
        // For debugging purposes, log the first few records
        if (acc[scheduleId].length <= 2) {
          console.log(`Signup in session ${scheduleId}:`, { 
            id: record.id, 
            name: record.profile?.full_name || record.anonymous_signup?.name,
            checkIn: record.check_in_time,
            checkOut: record.check_out_time
          });
        }
      }
      return acc;
    }, {} as Record<string, ProjectSignup[]>);
  }, [signups]);

  // Filter and sort signups (similar to AttendanceClient, but simpler sorting for now)
  const filteredSignupsBySession = useMemo(() => {
    let sessionData: Record<string, ProjectSignup[]> = {};
    if (sessionFilter === "all") {
      sessionData = { ...signupsBySession };
    } else {
      sessionData = { [sessionFilter]: signupsBySession[sessionFilter] || [] };
    }

    let filtered: Record<string, ProjectSignup[]> = {};
    if (!searchTerm) {
      filtered = { ...sessionData };
    } else {
      const searchLower = searchTerm.toLowerCase();
      Object.entries(sessionData).forEach(([session, sessionSignups]) => {
        const matchingSignups = sessionSignups.filter(record => {
          // --- CORRECTED ACCESS ---
          const nameMatch = record.user_id
            ? (record.profile?.full_name?.toLowerCase().includes(searchLower) || false) // Access nested profile
            : (record.anonymous_signup?.name?.toLowerCase().includes(searchLower) || false); // Access nested anonymous_signup
          const emailMatch = record.user_id
            ? (record.profile?.email?.toLowerCase().includes(searchLower) || false) // Access nested profile
            : (record.anonymous_signup?.email?.toLowerCase().includes(searchLower) || false); // Access nested anonymous_signup
          // --- END CORRECTION ---
          return nameMatch || emailMatch;
        });
        if (matchingSignups.length > 0) {
          filtered[session] = matchingSignups;
        }
      });
    }
    // Basic sort by name for now
     Object.keys(filtered).forEach(session => {
       filtered[session].sort((a, b) => {
         // --- CORRECTED ACCESS ---
         const nameA = (a.user_id ? a.profile?.full_name : a.anonymous_signup?.name) || ''; // Access nested
         const nameB = (b.user_id ? b.profile?.full_name : b.anonymous_signup?.name) || ''; // Access nested
         // --- END CORRECTION ---
         return nameA.localeCompare(nameB);
       });
     });

    return filtered;
  }, [signupsBySession, searchTerm, sessionFilter]);

  // Get available sessions for filter dropdown
  const availableSessions = useMemo(() => {
    // Include all active sessions 
    const sessionIds = [...Object.keys(signupsBySession)];
    
    // Add any active sessions that might not have signups yet
    activeSessions.forEach(session => {
      if (!sessionIds.includes(session.id) && session.id !== "all") {
        sessionIds.push(session.id);
      }
    });
    
    return sessionIds;
  }, [signupsBySession, activeSessions]);

  // Get all possible sessions from the project
  const getAllProjectSessions = useMemo(() => {
    const sessions: { id: string; name: string; endDateTime: Date; status: 'upcoming' | 'in-progress' | 'completed' | 'editing'; alternativeIds: string[] }[] = [];
    const now = new Date();
    
    if (project.event_type === "oneTime" && project.schedule.oneTime) {
      const date = parseISO(project.schedule.oneTime.date);
      const [endHours, endMinutes] = project.schedule.oneTime.endTime.split(':').map(Number);
      const endDateTime = new Date(new Date(date).setHours(endHours, endMinutes));
      
      // Determine status
      let status: 'upcoming' | 'in-progress' | 'completed' | 'editing' = 'upcoming';
      if (isAfter(now, endDateTime)) {
        // Check if in editing window
        const hoursSinceEnd = differenceInMinutes(now, endDateTime) / 60;
        if (hoursSinceEnd < 48) {
          status = 'editing';
        } else {
          status = 'completed';
        }
      } else {
        const [startHours, startMinutes] = project.schedule.oneTime.startTime.split(':').map(Number);
        const startDateTime = new Date(new Date(date).setHours(startHours, startMinutes));
        if (isAfter(now, startDateTime)) {
          status = 'in-progress';
        }
      }
      
      sessions.push({
        id: "oneTime",
        name: formatSessionName(project, "oneTime"),
        endDateTime,
        status,
        alternativeIds: ["0", "oneTime", "default"]
      });
    }
    
    else if (project.event_type === "multiDay" && project.schedule.multiDay) {
      project.schedule.multiDay.forEach((day, dayIndex) => {
        const dayDate = parseISO(day.date);
        
        day.slots.forEach((slot, slotIndex) => {
          const sessionId = `day-${dayIndex}-slot-${slotIndex}`;
          const [endHours, endMinutes] = slot.endTime.split(':').map(Number);
          const endDateTime = new Date(new Date(dayDate).setHours(endHours, endMinutes));
          
          // Determine status
          let status: 'upcoming' | 'in-progress' | 'completed' | 'editing' = 'upcoming';
          if (isAfter(now, endDateTime)) {
            // Check if in editing window
            const hoursSinceEnd = differenceInMinutes(now, endDateTime) / 60;
            if (hoursSinceEnd < 48) {
              status = 'editing';
            } else {
              status = 'completed';
            }
          } else {
            const [startHours, startMinutes] = slot.startTime.split(':').map(Number);
            const startDateTime = new Date(new Date(dayDate).setHours(startHours, startMinutes));
            if (isAfter(now, startDateTime)) {
              status = 'in-progress';
            }
          }
          
          // Create alternative IDs that might be used in the database
          const simplifiedId = `${dayIndex}-${slotIndex}`;
          const dateString = format(dayDate, "yyyy-MM-dd");
          const dateBasedId = `${dateString}-${slotIndex}`;
          
          sessions.push({
            id: sessionId,
            name: formatSessionName(project, sessionId),
            endDateTime,
            status,
            alternativeIds: [simplifiedId, dateBasedId]
          });
        });
      });
    }
    
    else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
      const date = parseISO(project.schedule.sameDayMultiArea.date);
      
      project.schedule.sameDayMultiArea.roles.forEach((role, roleIndex) => {
        const sessionId = `role-${roleIndex}`;
        const [endHours, endMinutes] = role.endTime.split(':').map(Number);
        const endDateTime = new Date(new Date(date).setHours(endHours, endMinutes));
        
        // Determine status
        let status: 'upcoming' | 'in-progress' | 'completed' | 'editing' = 'upcoming';
        if (isAfter(now, endDateTime)) {
          // Check if in editing window
          const hoursSinceEnd = differenceInMinutes(now, endDateTime) / 60;
          if (hoursSinceEnd < 48) {
            status = 'editing';
          } else {
            status = 'completed';
          }
        } else {
          const [startHours, startMinutes] = role.startTime.split(':').map(Number);
          const startDateTime = new Date(new Date(date).setHours(startHours, startMinutes));
          if (isAfter(now, startDateTime)) {
            status = 'in-progress';
          }
        }
        
        sessions.push({
          id: sessionId,
          name: formatSessionName(project, sessionId),
          endDateTime,
          status,
          alternativeIds: [`role${roleIndex}`, `${roleIndex}`]
        });
      });
    }
    
    // Log session IDs for debugging 
    console.log("All possible project sessions:", sessions.map(s => ({ 
      id: s.id, 
      status: s.status,
      alternativeIds: s.alternativeIds 
    })));
    
    return sessions;
  }, [project]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="mb-6">
        <Button variant="ghost" className="gap-2" asChild>
           <Link href={`/projects/${project.id}`}>
             <ArrowLeft className="h-4 w-4" />
             Back to Project
           </Link>
         </Button>
      </div>

      <Card className="min-h-[400px] relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/50">
            <div className="flex flex-col items-center gap-2 mt-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          </div>
        )}
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>Manage Volunteer Hours</CardTitle>
              <CardDescription>
                Review and edit volunteer check-in/out times. Publish hours to generate certificates.
              </CardDescription>
            </div>
            {/* Optional Refresh Button */}
            {/* <Button variant="outline" className="p-3 sm:gap-2" onClick={loadSignups} disabled={refreshing} aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button> */}
          </div>
          {/* {hoursUntilWindowCloses !== null && (
             <Alert variant="warning" className="mt-4">
               <Clock className="h-4 w-4" />
               <AlertTitle>Editing Window Closing Soon</AlertTitle>
               <AlertDescription>
                 You have approximately {hoursUntilWindowCloses} hour{hoursUntilWindowCloses !== 1 ? 's' : ''} left to edit and publish volunteer hours.
               </AlertDescription>
             </Alert>
           )} */}
           
           {/* Display active session information */}
        {activeSessions.length > 0 && (
            <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                    <Edit className="h-4 w-4 text-chart-4" aria-hidden="true" />
                    <span className="text-base font-semibold text-chart-4">Editing Windows Open</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {activeSessions.map(session => (
                        <div
                            key={session.id}
                            className="flex flex-col gap-1 p-4 rounded-xl border border-chart-4/30 bg-gradient-to-br from-chart-4/10 to-white/80 dark:to-background shadow-sm transition hover:shadow-lg"
                            aria-label={`Editing window for ${session.name}`}
                        >
                            <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-chart-4">{session.name}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                                <Clock
                                    className="h-4 w-4 text-chart-4 animate-spin"
                                    style={{ animationDuration: "8s" }}
                                    aria-hidden="true"
                                />
                                <span className="text-xs text-muted-foreground">
                                    <span className="font-semibold text-chart-4">{session.hoursRemaining}h</span> left to edit &amp; publish
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Search and Filter */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between">
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
              <div className="flex flex-row gap-2 w-full sm:w-auto items-center">
                <Select value={sessionFilter} onValueChange={setSessionFilter}>
                  <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter by session">
                    <SelectValue placeholder="Filter by session" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sessions</SelectItem>
                    
                    {/* Group sessions by status */}
                    {getAllProjectSessions.filter(s => s.status === 'editing').length > 0 && (
                      <>
                        <SelectItem value="header-editing" disabled className="text-xs font-semibold opacity-70">
                          Editing Window Open
                        </SelectItem>
                        {getAllProjectSessions
                          .filter(s => s.status === 'editing')
                          .map(session => (
                            <SelectItem key={`editing-${session.id}`} value={session.id} className="pl-6">
                              {session.name}
                            </SelectItem>
                          ))}
                      </>
                    )}
                    
                    {getAllProjectSessions.filter(s => s.status === 'in-progress').length > 0 && (
                      <>
                        <SelectItem value="header-in-progress" disabled className="text-xs font-semibold opacity-70">
                          In Progress
                        </SelectItem>
                        {getAllProjectSessions
                          .filter(s => s.status === 'in-progress')
                          .map(session => (
                            <SelectItem key={`in-progress-${session.id}`} value={session.id} className="pl-6">
                              {session.name}
                            </SelectItem>
                          ))}
                      </>
                    )}
                    
                    {getAllProjectSessions.filter(s => s.status === 'upcoming').length > 0 && (
                      <>
                        <SelectItem value="header-upcoming" disabled className="text-xs font-semibold opacity-70">
                          Upcoming
                        </SelectItem>
                        {getAllProjectSessions
                          .filter(s => s.status === 'upcoming')
                          .map(session => (
                            <SelectItem key={`upcoming-${session.id}`} value={session.id} className="pl-6">
                              {session.name}
                              
                            </SelectItem>
                          ))}
                      </>
                    )}
                    
                    {getAllProjectSessions.filter(s => s.status === 'completed').length > 0 && (
                      <>
                        <SelectItem value="header-completed" disabled className="text-xs font-semibold opacity-70">
                          Completed
                        </SelectItem>
                        {getAllProjectSessions
                          .filter(s => s.status === 'completed')
                          .map(session => (
                            <SelectItem key={`completed-${session.id}`} value={session.id} className="pl-6">
                              {session.name}
                            </SelectItem>
                          ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Display all sessions */}
          {(sessionFilter === "all" ? getAllProjectSessions : getAllProjectSessions.filter(s => s.id === sessionFilter)).map(session => {
            // Find signups for this session by checking both exact ID and alternative IDs
            let sessionSignups: ProjectSignup[] = [];
            
            // Try exact match first
            if (filteredSignupsBySession[session.id]) {
              sessionSignups = filteredSignupsBySession[session.id];
            } else {
              // Try all alternative IDs
              for (const altId of session.alternativeIds) {
                if (filteredSignupsBySession[altId]) {
                  sessionSignups = filteredSignupsBySession[altId];
                  console.log(`Found signups using alternative ID ${altId} for session ${session.id}`);
                  break;
                }
              }
            }
            
            // For debugging
            if (sessionSignups.length > 0) {
              console.log(`Session ${session.id} has ${sessionSignups.length} signups`);
            }
            
            const hasSignups = sessionSignups.length > 0;
            const isPublishing = publishingSessions[session.id] || false;
            const hasInvalidTimes = hasSignups && sessionSignups.some(signup => {
              const edit = editedTimes[signup.id] || { check_in_time: null, check_out_time: null };
              const duration = calculateDuration(edit.check_in_time, edit.check_out_time);
              return !duration.isValid;
            });
            
            // Check if any volunteer in this session has valid hours data
            const hasValidHoursData = hasSignups && sessionSignups.some(signup => {
              const edit = editedTimes[signup.id] || { check_in_time: null, check_out_time: null };
              return edit.check_in_time && edit.check_out_time;
            });
            
            return (
              <div key={session.id} className="space-y-4 mb-8 border rounded-lg p-4">
                <div className="flex flex-col sm:flex-row justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-base">
                      {session.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      {session.status === "upcoming" && (
                        <span className="text-xs px-2 py-1 rounded-full bg-chart-3/10 text-chart-3 font-medium">
                          Upcoming
                        </span>
                      )}
                      {session.status === "in-progress" && (
                        <span className="text-xs px-2 py-1 rounded-full bg-chart-2/10 text-chart-2 font-medium">
                          In Progress
                        </span>
                      )}
                      {session.status === "editing" && (
                        <span className="text-xs px-2 py-1 rounded-full bg-chart-4/10 text-chart-4 font-medium">
                          Editing Window Open
                        </span>
                      )}
                      {session.status === "completed" && (
                        <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                          Completed
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {session.status === "editing" && hasSignups && (
                    <Button 
                      onClick={() => handlePublishHours(session.id)}
                      disabled={isPublishing || !hasValidHoursData || hasInvalidTimes}
                      className="whitespace-nowrap"
                    >
                      {isPublishing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                          Publishing...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Publish Hours & Generate Certificates
                        </>
                      )}
                    </Button>
                  )}
                </div>
                
                {hasInvalidTimes && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Invalid Hours Detected</AlertTitle>
                    <AlertDescription>
                      Some volunteers have invalid hours (negative or over 24 hours). Please fix these before publishing.
                    </AlertDescription>
                  </Alert>
                )}
                
                {hasSignups ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Check-in Time</TableHead>
                        <TableHead>Check-out Time</TableHead>
                        <TableHead>Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessionSignups.map((signup) => {
                        const isRegistered = !!signup.user_id;
                        const name = isRegistered ? signup.profile?.full_name : signup.anonymous_signup?.name;
                        const email = isRegistered ? signup.profile?.email : signup.anonymous_signup?.email;
                        const currentEdit = editedTimes[signup.id] || { check_in_time: null, check_out_time: null };
                        const duration = calculateDuration(currentEdit.check_in_time, currentEdit.check_out_time);
                        
                        // Check if this record has been edited 
                        const checkInOriginal = signup.check_in_time;
                        const checkOutOriginal = signup.check_out_time;
                        const hasBeenEdited = 
                          currentEdit.check_in_time !== checkInOriginal || 
                          currentEdit.check_out_time !== checkOutOriginal;

                        return (
                          <TableRow key={signup.id} className={hasBeenEdited ? "bg-muted/40" : ""}>
                            <TableCell className="font-medium">
                              {name || 'N/A'}
                              {hasBeenEdited && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  <PencilLine className="h-3 w-3 inline-block" /> Edited
                                </span>
                              )}
                            </TableCell>
                            <TableCell>{email || 'N/A'}</TableCell>
                            <TableCell>
                              <TimePicker
                                value={currentEdit.check_in_time 
                                  ? format(new Date(currentEdit.check_in_time), 'HH:mm')
                                  : ''}
                                onChangeAction={(time) => handleTimeChange(signup.id, 'check_in_time', time)}
                                disabled={session.status !== 'editing'}
                              />
                            </TableCell>
                            <TableCell>
                              <TimePicker
                                value={currentEdit.check_out_time 
                                  ? format(new Date(currentEdit.check_out_time), 'HH:mm')
                                  : ''}
                                onChangeAction={(time) => handleTimeChange(signup.id, 'check_out_time', time)}
                                disabled={session.status !== 'editing'}
                              />
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs font-medium ${!duration.isValid ? 'text-destructive' : ''}`}>
                                {duration.text}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="border rounded-md p-4 bg-muted/30 flex flex-col items-center justify-center py-6 text-center">
                    {session.status === "upcoming" && (
                      <>
                        <p className="text-muted-foreground">This session hasn&apos;t started yet.</p>
                        <p className="text-xs text-muted-foreground mt-1">Check back after the session is complete.</p>
                      </>
                    )}
                    {session.status === "in-progress" && (
                      <>
                        <p className="text-muted-foreground">This session is currently in progress.</p>
                        <p className="text-xs text-muted-foreground mt-1">Volunteer hours will be available after the session ends.</p>
                      </>
                    )}
                    {(session.status === "editing" || session.status === "completed") && (
                      <>
                        <p className="text-muted-foreground">No volunteers attended this session.</p>
                        <p className="text-xs text-muted-foreground mt-1">There are no hours to manage.</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          
          {getAllProjectSessions.length === 0 && !loading && (
            <div className="flex flex-col items-center text-muted-foreground space-y-2 py-10">
              <UserRoundCheck className="h-8 w-8 mt-10" />
              <p className="text-lg font-medium">No Sessions Found</p>
              <p className="text-sm">This project doesn&apos;t have any scheduled sessions.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
