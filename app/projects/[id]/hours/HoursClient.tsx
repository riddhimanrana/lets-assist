"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Project, ProjectSignup } from "@/types"; // Use ProjectSignup type
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, Clock, CheckCircle, Loader2, UserRoundCheck, Info, Edit, AlertCircle, PencilLine, FileText, Mail } from "lucide-react";
import { format, parseISO, differenceInMinutes, differenceInSeconds, isAfter, isValid } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogClose, DialogFooter 
} from "@/components/ui/dialog";
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
import { toast } from "sonner"; // Import sonner toast
// Fixed: Added the missing Select imports
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// Import the server action
import { publishVolunteerHours } from "./actions"; // Import the server action
import { TimePicker } from "@/components/ui/time-picker"; // Import the TimePicker
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

export function HoursClient({ project, initialSignups, hoursUntilWindowCloses: _hoursUntilWindowCloses, activeSessions }: Props): React.JSX.Element {
  const [signups] = useState<ProjectSignup[]>(initialSignups);
  const [loading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  
  // State to track which sessions are currently being published
  const [publishingSessions, setPublishingSessions] = useState<Record<string, boolean>>({});
  
  // Add state for confirmation dialog
  const [confirmPublishSessionId, setConfirmPublishSessionId] = useState<string | null>(null);
  const [confirmPublishCount, setConfirmPublishCount] = useState<number>(0);

  // State for publish success modal
  const [showPublishSuccessModal, setShowPublishSuccessModal] = useState(false);
  const [currentPublishedSessionName, setCurrentPublishedSessionName] = useState<string>("");
  const [emailsSentCount, setEmailsSentCount] = useState<number>(0);
  const [emailErrors, setEmailErrors] = useState<string[]>([]);
  
  // State for certificates modal
  const [showCertificatesModal, setShowCertificatesModal] = useState(false);
  const [certificatesModalData, setCertificatesModalData] = useState<{
    sessionName: string;
    volunteers: Array<{
      name: string;
      email: string;
      checkInTime: string;
      checkOutTime: string;
      hours: string;
      durationMinutes: number;
    }>;
  } | null>(null);
  const [loadingCertificates, setLoadingCertificates] = useState(false);
  
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
     if (!proj) return sessionId; // Added missing return statement
     
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
      
      // Calculate difference in seconds and convert to minutes with rounding
      const diffSeconds = differenceInSeconds(checkOut, checkIn);
      const diffMins = Math.round(diffSeconds / 60);
      
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
    const date = currentValue ? new Date(currentValue) : new Date();
    
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

  // Function to load certificates data for a session
  const loadCertificatesData = async (sessionId: string) => {
    setLoadingCertificates(true);
    try {
      // Find all signups for this session
      let sessionSignups: ProjectSignup[] = [];
      const allSessions = getAllProjectSessions;
      
      // Try exact match first
      if (signupsBySession[sessionId]) {
        sessionSignups = signupsBySession[sessionId];
      } else {
        // Try all alternative IDs
        const session = allSessions.find((s: { id: string; name: string; endDateTime: Date; status: 'upcoming' | 'in-progress' | 'completed' | 'editing'; alternativeIds: string[] }) => s.id === sessionId);
        if (session) {
          for (const altId of session.alternativeIds) {
            if (signupsBySession[altId]) {
              sessionSignups = signupsBySession[altId];
              break;
            }
          }
        }
      }

      // Filter to only volunteers with valid hours (those that would have certificates)
      const volunteersWithHours = sessionSignups
        .map(signup => {
          const edited = editedTimes[signup.id];
          if (!edited || !edited.check_in_time || !edited.check_out_time) {
            return null;
          }
          const duration = calculateDuration(edited.check_in_time, edited.check_out_time);
          if (!duration.isValid) {
            return null;
          }

          return {
            name: signup.profile?.full_name || signup.anonymous_signup?.name || "Anonymous Volunteer",
            email: signup.profile?.email || signup.anonymous_signup?.email || "N/A",
            checkInTime: format(new Date(edited.check_in_time), "MMM d, yyyy h:mm a"),
            checkOutTime: format(new Date(edited.check_out_time), "MMM d, yyyy h:mm a"),
            hours: duration.text,
            durationMinutes: duration.minutes
          };
        })
        .filter(v => v !== null) as Array<{
          name: string;
          email: string;
          checkInTime: string;
          checkOutTime: string;
          hours: string;
          durationMinutes: number;
        }>;

      setCertificatesModalData({
        sessionName: formatSessionName(project, sessionId),
        volunteers: volunteersWithHours
      });
      setShowCertificatesModal(true);
    } catch (error) {
      console.error("Error loading certificates data:", error);
      toast.error("Failed to load certificates data");
    } finally {
      setLoadingCertificates(false);
    }
  };

  // Add function to initiate the publish confirmation
  const initiatePublishHours = (sessionId: string) => {
    // Find all signups for this session to show count in confirmation
    let sessionSignups: ProjectSignup[] = [];
    const allSessions = getAllProjectSessions; // Ensure getAllProjectSessions is in scope
    
    // Try exact match first
    if (signupsBySession[sessionId]) {
      sessionSignups = signupsBySession[sessionId];
    } else {
      // Try all alternative IDs
      const session = allSessions.find((s: { id: string; name: string; endDateTime: Date; status: 'upcoming' | 'in-progress' | 'completed' | 'editing'; alternativeIds: string[] }) => s.id === sessionId);
      if (session) {
        for (const altId of session.alternativeIds) {
          if (signupsBySession[altId]) {
            sessionSignups = signupsBySession[altId];
            break;
          }
        }
      }
    }
    
    // Count valid volunteers
    const validVolunteers = sessionSignups.filter(signup => {
      const edit = editedTimes[signup.id] || { check_in_time: null, check_out_time: null };
      const duration = calculateDuration(edit.check_in_time, edit.check_out_time);
      return duration.isValid && edit.check_in_time && edit.check_out_time;
    });
    
    // Set state for confirmation dialog
    setConfirmPublishCount(validVolunteers.length);
    setConfirmPublishSessionId(sessionId);
  };

  // Modify the handle publish function to be called after confirmation
  const handlePublishHours = async (sessionId: string) => {
    // Close the confirmation dialog
    setConfirmPublishSessionId(null);
    
    setPublishingSessions((prev: Record<string, boolean>) => ({ // Added type for prev
      ...prev,
      [sessionId]: true
    }));
    
    try {
      // Find all signups for this session
      let sessionSignups: ProjectSignup[] = [];
      // Try exact match first
      if (signupsBySession[sessionId]) {
        sessionSignups = signupsBySession[sessionId];
      } else {
        // Fallback for alternative session IDs (e.g., from getAllProjectSessions)
        const allProjSessions = getAllProjectSessions; // Ensure getAllProjectSessions is in scope
        const targetSessionInfo = allProjSessions.find((s: { id: string; alternativeIds: string[] }) => s.id === sessionId || s.alternativeIds.includes(sessionId));
        if (targetSessionInfo) {
          // Check primary ID first
          if (signupsBySession[targetSessionInfo.id]) {
            sessionSignups = signupsBySession[targetSessionInfo.id];
          } else {
            // Check alternative IDs
            for (const altId of targetSessionInfo.alternativeIds) {
              if (signupsBySession[altId]) {
                sessionSignups = signupsBySession[altId];
                break;
              }
            }
          }
        }
      }

      const volunteersData = sessionSignups
        .map(signup => {
          const edited = editedTimes[signup.id];
          if (!edited || !edited.check_in_time || !edited.check_out_time) {
            return null; // Skip if no valid times
          }
          const duration = calculateDuration(edited.check_in_time, edited.check_out_time);
          return {
            signupId: signup.id,
            userId: signup.user_id,
            name: signup.profile?.full_name || signup.anonymous_signup?.name || "Anonymous Volunteer",
            email: signup.profile?.email || signup.anonymous_signup?.email,
            checkIn: edited.check_in_time,
            checkOut: edited.check_out_time,
            durationMinutes: duration.minutes,
            isValid: duration.isValid,
          };
        })
        .filter(v => v !== null && v.isValid) as { 
            signupId: string; userId: string | null; name: string | null; email: string | null; 
            checkIn: string; checkOut: string; durationMinutes: number; isValid: boolean; 
        }[]; // Type assertion

      if (volunteersData.length === 0) {
        toast.error("No Valid Hours", {
          description: "No volunteers with valid check-in and check-out times to publish.",
        });
        return;
      }

      const result = await publishVolunteerHours(project.id, sessionId, volunteersData);

      if (result.success) {
        const resultWithEmails = result as { success: true; certificatesCreated: number; emailsSent?: number; emailErrors?: string[] };
        const emailsSent = resultWithEmails.emailsSent || 0;
        const emailErrors = resultWithEmails.emailErrors || [];
        
        if (emailsSent > 0) {
          toast.success("Hours Published & Emails Sent!", {
            description: `${result.certificatesCreated} certificates generated and ${emailsSent} email notifications sent for session: ${formatSessionName(project, sessionId)}.`,
          });
        } else {
          toast.success("Hours Published!", {
            description: `${result.certificatesCreated} certificates generated for session: ${formatSessionName(project, sessionId)}. ${emailErrors.length > 0 ? 'However, some email notifications failed to send.' : 'Email notifications were not sent.'}`,
          });
        }
        
        // Update published status locally
        const publishKey = getPublishStateKey(sessionId); // Ensure getPublishStateKey is in scope
        setPublishedSessions((prev: Record<string, boolean>) => ({ ...prev, [publishKey]: true })); // Corrected to setPublishedSessions and added type for prev

        setCurrentPublishedSessionName(formatSessionName(project, sessionId));
        
        // Store email sent information for the modal
        setEmailsSentCount(emailsSent);
        setEmailErrors(emailErrors);
        setShowPublishSuccessModal(true);

      } else {
        toast.error("Publishing Failed", {
          description: result.error || "An unknown error occurred.",
        });
      }
    } catch (error) {
      console.error("Error publishing hours:", error);
      toast.error("Publishing Error", {
        description: "An unexpected error occurred while publishing hours.",
      });
    } finally {
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
            ? (record.profile?.full_name?.toLowerCase().includes(searchLower) || false) 
            : (record.anonymous_signup?.name?.toLowerCase().includes(searchLower) || false); 
          const emailMatch = record.user_id
            ? (record.profile?.email?.toLowerCase().includes(searchLower) || false) 
            : (record.anonymous_signup?.email?.toLowerCase().includes(searchLower) || false); 
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
       if (filtered[session]) { // Add null check for filtered[session]
        filtered[session].sort((a, b) => {
         // --- CORRECTED ACCESS ---
         const nameA = (a.user_id ? a.profile?.full_name : a.anonymous_signup?.name) || ''; 
         const nameB = (b.user_id ? b.profile?.full_name : b.anonymous_signup?.name) || ''; 
         // --- END CORRECTION ---
         return nameA.localeCompare(nameB);
       });
       }
     });

    return filtered;
  }, [signupsBySession, searchTerm, sessionFilter]);

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
      
      project.schedule.sameDayMultiArea.roles.forEach((role) => {
        const [endHours, endMinutes] = role.endTime.split(':').map(Number);
        const endDateTime = new Date(new Date(date).setHours(endHours, endMinutes));
        
        // Use role name directly as the session ID
        const sessionId = role.name;
        
        // Determine status
        let status: 'upcoming' | 'in-progress' | 'completed' | 'editing' = 'upcoming';
        if (isAfter(now, endDateTime)) {
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
          id: sessionId, // Use role name as ID
          name: formatSessionName(project, sessionId),
          endDateTime,
          status,
          alternativeIds: [sessionId] // The role name is the only ID we need
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

  // State for batch time adjustment
  const [showBatchAdjustment, setShowBatchAdjustment] = useState<Record<string, boolean>>({});
  const [batchMinutesAdjustment, setBatchMinutesAdjustment] = useState<number>(30);
  const [applyingBatchAdjustment, setApplyingBatchAdjustment] = useState<Record<string, boolean>>({});

  // Function to handle batch time adjustment
  const handleBatchAdjustment = (sessionId: string, minutes: number) => {
    setApplyingBatchAdjustment(prev => ({
      ...prev,
      [sessionId]: true
    }));
    const allSessions = getAllProjectSessions; // Ensure getAllProjectSessions is in scope
    
    try {
      // Get all signups for this session
      let sessionSignups: ProjectSignup[] = [];
      
      // First try exact match
      if (signupsBySession[sessionId]) {
        sessionSignups = signupsBySession[sessionId];
      } else {
        // Try all alternative IDs
        const session = allSessions.find(s => s.id === sessionId);
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
      
      if (sessionSignups.length === 0) {
        toast.error("No volunteers found for this session.");
        return;
      }
      
      // Apply the adjustment to all signups in the session
      const newEditedTimes = { ...editedTimes };
      let successCount = 0;
      
      sessionSignups.forEach(signup => {
        const currentCheckOut = editedTimes[signup.id]?.check_out_time;
        
        if (currentCheckOut) {
          // Create a date object from the current checkout time
          const checkOutDate = new Date(currentCheckOut);
          
          // Add the specified minutes
          checkOutDate.setMinutes(checkOutDate.getMinutes() + minutes);
          
          // Update the edited times
          newEditedTimes[signup.id] = {
            ...newEditedTimes[signup.id],
            check_out_time: checkOutDate.toISOString()
          };
          
          successCount++;
        }
      });
      
      // Update state with new times
      setEditedTimes(newEditedTimes);
      
      // Show success message
      if (successCount > 0) {
        toast.success(`Successfully adjusted ${successCount} volunteer${successCount !== 1 ? 's' : ''} by ${minutes} minutes.`);
      } else {
        toast.warning("No checkout times were adjusted. Make sure volunteers have check-out times set.");
      }
      
      // Close the batch adjustment UI
      setShowBatchAdjustment(prev => ({
        ...prev,
        [sessionId]: false
      }));
      
    } catch (error) {
      console.error("Error applying batch adjustment:", error);
      toast.error("Failed to apply time adjustment.");
    } finally {
      setApplyingBatchAdjustment(prev => ({
        ...prev,
        [sessionId]: false
      }));
    }
  };

  // Add state to track published status from project
  const [publishedSessions, setPublishedSessions] = useState<Record<string, boolean>>(() => {
    // Initialize from project.published
    if (!project.published) return {};
    return project.published as Record<string, boolean>;
  });

  // Function to check if a session is published
  const isSessionPublished = (sessionId: string): boolean => {
    if (project.event_type === "oneTime") {
      return !!publishedSessions["oneTime"];
    } else if (project.event_type === "multiDay") {
      // For multiDay events, the session ID matches the published state key
      const [_, dayIndex, __, slotIndex] = sessionId.split("-");
      const dateKey = project.schedule.multiDay?.[parseInt(dayIndex)]?.date;
      return dateKey ? !!publishedSessions[`${dateKey}-${slotIndex}`] : false;
    } else if (project.event_type === "sameDayMultiArea") {
      // For multi-area events, use the sessionId directly as it's the role name
      return !!publishedSessions[sessionId];
    }
    return false;
  };

  // Function to get session identifier for publishing
  const getPublishStateKey = (sessionId: string): string => {
    if (project.event_type === "oneTime") {
      return "oneTime";
    } else if (project.event_type === "multiDay") {
      const [_, dayIndex, __, slotIndex] = sessionId.split("-");
      const dateKey = project.schedule.multiDay?.[parseInt(dayIndex)]?.date;
      // Ensure dateKey is valid before constructing the key
      return dateKey ? `${dateKey}-${slotIndex}` : sessionId; // Fallback to sessionId if dateKey is missing
    } else if (project.event_type === "sameDayMultiArea") {
      // For multi-area events, the sessionId is already the role name
      return sessionId;
    }
    return sessionId;
  };

  // --- Filter active sessions for the header display - only show sessions in "editing" status that are unpublished ---
  const activeUnpublishedSessions = useMemo(() => {
    // First get all sessions in editing status from getAllProjectSessions
    const editingSessions = getAllProjectSessions.filter(session => session.status === 'editing');
    
    // Then filter out published sessions and add hoursRemaining calculation
    return editingSessions
      .filter(session => !isSessionPublished(session.id))
      .map(session => {
        // Calculate hours remaining (48 hour editing window)
        const now = new Date();
        const hoursSinceEnd = differenceInMinutes(now, session.endDateTime) / 60;
        const hoursRemaining = Math.max(0, 48 - hoursSinceEnd);
        
        return {
          ...session,
          hoursRemaining: Math.floor(hoursRemaining)
        };
      });
  }, [getAllProjectSessions, publishedSessions]);
  // --- End filter ---

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-4 sm:mb-6">
        <Button variant="ghost" className="gap-2" asChild>
          <Link href={`/projects/${project.id}`}>
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to Project</span>
            <span className="sm:hidden">Back</span>
          </Link>
        </Button>
      </div>

      {/* Publish Success Modal */}
      <Dialog open={showPublishSuccessModal} onOpenChange={setShowPublishSuccessModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Hours Published for {currentPublishedSessionName}</DialogTitle>
            <DialogDescription>
              Volunteer hours have been finalized and certificates generated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 p-3 rounded-md bg-chart-5/10 border border-chart-5/80">
                <CheckCircle className="h-5 w-5 text-chart-5" />
                <div className="text-sm">
                  <p className="font-medium">Certificates Created</p>
                  <p className="text-muted-foreground">Generated certificates for all volunteers</p>
                </div>
              </div>
              
              {emailsSentCount > 0 ? (
                <div className="flex items-center gap-2 p-3 rounded-md bg-chart-3/10 border border-chart-3/80">
                  <Mail className="h-5 w-5 text-chart-3" />
                  <div className="text-sm">
                    <p className="font-medium">Email Notifications Sent</p>
                    <p className="text-muted-foreground">
                      Sent {emailsSentCount} email notification{emailsSentCount !== 1 ? 's' : ''} to volunteers with their certificate links
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-md bg-orange-50 border border-orange-200">
                  <AlertCircle className="h-5 w-5 text-orange-600" />
                  <div className="text-sm">
                    <p className="font-medium text-orange-800">Email Notifications</p>
                    <p className="text-orange-600">
                      {emailErrors.length > 0 
                        ? "Some email notifications failed to send" 
                        : "No email notifications were sent (missing email addresses)"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {emailErrors.length > 0 && (
              <div className="mt-4">
                <details className="text-sm">
                  <summary className="cursor-pointer text-orange-600 font-medium mb-2">
                    View Email Errors ({emailErrors.length})
                  </summary>
                  <div className="bg-orange-50 border border-orange-200 rounded p-2 max-h-32 overflow-y-auto">
                    {emailErrors.map((error, index) => (
                      <p key={index} className="text-xs text-orange-700 mb-1">{error}</p>
                    ))}
                  </div>
                </details>
              </div>
            )}
            
            <Alert variant="default" className="mt-4">
              <Info className="h-4 w-4" />
              <AlertTitle className="font-semibold">What happens next?</AlertTitle>
              <AlertDescription className="text-xs space-y-1">
                <ul className="list-disc pl-5 space-y-0.5 mt-2">
                  <li><strong>Volunteers with accounts:</strong> Can access certificates via their profile or the project page</li>
                  <li><strong>Anonymous volunteers:</strong> Will receive email notifications with direct certificate links</li>
                  <li><strong>All certificates:</strong> Are now permanently available and can be verified at any time</li>
                </ul>
                <p className="mt-2">If volunteers need help accessing their certificates, direct them to contact you or support@lets-assist.com</p>
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add confirmation dialog */}
      <Dialog open={confirmPublishSessionId !== null} onOpenChange={(open) => !open && setConfirmPublishSessionId(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center">
              <AlertCircle className="h-5 w-5 text-chart-4 mr-2" />
              Publish Volunteer Hours
            </DialogTitle>
            <DialogDescription className="pt-2">
              You are about to publish volunteer hours and generate official certificates 
              for <strong>{confirmPublishCount}</strong> volunteer{confirmPublishCount !== 1 ? 's' : ''}.
            </DialogDescription>
          </DialogHeader>
          
          <div className="my-2 p-3 border rounded-md bg-muted/50">
            <p className="text-sm text-chart-4 font-medium">Important:</p>
            <p className="text-sm mt-1">
              This action is final. Once published, these hours cannot be modified. 
              Volunteers will have access to their certificates immediately.
            </p>
          </div>
          
          <p className="text-sm text-muted-foreground">
            For any changes after publishing, you&apos;ll need to contact support at <a href="mailto:support@lets-assist.com" className="text-primary underline">support@lets-assist.com</a>
          </p>
          
          <DialogFooter className="gap-2 mt-4">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button 
              onClick={() => confirmPublishSessionId && handlePublishHours(confirmPublishSessionId)}
              variant="default"
            >
              Confirm & Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Certificates Modal */}
      <Dialog open={showCertificatesModal} onOpenChange={setShowCertificatesModal}>
        <DialogContent className="w-[95vw] max-w-4xl flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="text-lg sm:text-xl flex items-center">
              <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-primary mr-2 flex-shrink-0" />
              <span className="truncate">Certificate Details</span>
            </DialogTitle>
            <DialogDescription className="text-sm">
              {certificatesModalData ? (
                <>
                  <span className="block sm:inline">Session: <strong className="break-words">{certificatesModalData.sessionName}</strong></span>
                  <span className="block sm:inline sm:ml-2">• {certificatesModalData.volunteers.length} volunteer{certificatesModalData.volunteers.length !== 1 ? 's' : ''}</span>
                </>
              ) : (
                "Loading certificate details..."
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {certificatesModalData ? (
              <div className="flex flex-col h-full space-y-4">
                <div className="flex-1 overflow-auto min-h-0">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-[120px] sm:w-[150px]">Name</TableHead>
                        <TableHead className="w-[150px] sm:w-[200px] hidden sm:table-cell">Email</TableHead>
                        <TableHead className="w-[100px] sm:w-[140px]">Check-in</TableHead>
                        <TableHead className="w-[100px] sm:w-[140px]">Check-out</TableHead>
                        <TableHead className="w-[80px] sm:w-[100px]">Hours</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {certificatesModalData.volunteers.length > 0 ? (
                        certificatesModalData.volunteers.map((volunteer, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-medium">
                              <div className="space-y-1">
                                <div className="truncate">{volunteer.name}</div>
                                <div className="sm:hidden text-xs text-muted-foreground truncate">{volunteer.email}</div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">{volunteer.email}</TableCell>
                            <TableCell className="text-xs sm:text-sm">
                              <div className="space-y-1">
                                <div>{format(new Date(volunteer.checkInTime), "MMM d")}</div>
                                <div className="text-muted-foreground">{format(new Date(volunteer.checkInTime), "h:mm a")}</div>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs sm:text-sm">
                              <div className="space-y-1">
                                <div>{format(new Date(volunteer.checkOutTime), "MMM d")}</div>
                                <div className="text-muted-foreground">{format(new Date(volunteer.checkOutTime), "h:mm a")}</div>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">{volunteer.hours}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            No volunteers with valid hours found for this session.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                
                {certificatesModalData.volunteers.length > 0 && (
                  <div className="flex-shrink-0 bg-muted/30 rounded-md p-4">
                    <p className="text-sm font-medium mb-2">Summary:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
                      <div className="text-center sm:text-left">
                        <span className="text-muted-foreground block sm:inline">Total Volunteers:</span>
                        <div className="font-semibold text-lg sm:text-base">{certificatesModalData.volunteers.length}</div>
                      </div>
                      <div className="text-center sm:text-left">
                        <span className="text-muted-foreground block sm:inline">Total Hours:</span>
                        <div className="font-semibold text-lg sm:text-base">
                          {(() => {
                            const totalMinutes = certificatesModalData.volunteers.reduce((sum, v) => {
                              return sum + (typeof v.durationMinutes === 'number' && !isNaN(v.durationMinutes) ? v.durationMinutes : 0);
                            }, 0);
                            const hours = Math.floor(totalMinutes / 60);
                            const minutes = totalMinutes % 60;
                            return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
                          })()}
                        </div>
                      </div>
                      <div className="text-center sm:text-left">
                        <span className="text-muted-foreground block sm:inline">Average Hours:</span>
                        <div className="font-semibold text-lg sm:text-base">
                          {(() => {
                            const totalMinutes = certificatesModalData.volunteers.reduce((sum, v) => {
                              return sum + (typeof v.durationMinutes === 'number' && !isNaN(v.durationMinutes) ? v.durationMinutes : 0);
                            }, 0);
                            const avgMinutes = Math.round(totalMinutes / certificatesModalData.volunteers.length);
                            const hours = Math.floor(avgMinutes / 60);
                            const minutes = avgMinutes % 60;
                            return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span>Loading certificate data...</span>
              </div>
            )}
          </div>
          
          <DialogFooter className="flex-shrink-0 gap-2 flex-col sm:flex-row mt-4">
            <DialogClose asChild>
              <Button variant="outline" className="w-full sm:w-auto">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Card className="min-h-[400px] relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/50">
            <div className="flex flex-col items-center gap-2 mt-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          </div>
        )}
        <CardHeader className="px-3 py-4 sm:p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle className="text-lg sm:text-xl">Manage Volunteer Hours</CardTitle>
              <CardDescription className="text-sm">
                Review and edit volunteer check-in/out times. If no changes are made, the system will automatically publish hours after 48 hours.
              </CardDescription>
            </div>
          </div>
          
          {/* Display active session information - ONLY if there are active UNPUBLISHED sessions */}
          {activeUnpublishedSessions.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-2">
                <Edit className="h-4 w-4 text-chart-4" aria-hidden="true" />
                <span className="text-sm sm:text-base font-semibold text-chart-4">Editing Windows Open</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {/* Map over the filtered list */}
                {activeUnpublishedSessions.map(session => (
                  <div
                    key={session.id}
                    className="flex flex-col gap-1 p-3 sm:p-4 rounded-xl border border-chart-4/30 bg-gradient-to-br from-chart-4/10 to-white/80 dark:to-background shadow-sm transition hover:shadow-lg"
                    aria-label={`Editing window for ${session.name}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-chart-4 line-clamp-1">{session.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Clock
                      className="h-3.5 w-3.5 text-chart-4 animate-spin"
                      style={{ animationDuration: "8s" }}
                      aria-hidden="true"
                    />
                    <span className="text-xs text-muted-foreground">
                      <span className="font-semibold text-chart-4">{session.hoursRemaining}h</span> left to edit
                    </span>
                  </div>
                </div>
                ))}
              </div>
            </div>
          )}
        </CardHeader>
        
        <CardContent className="space-y-4 sm:space-y-6 px-3 sm:px-6">
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
            const currentFilteredSignups = filteredSignupsBySession; // Ensure filteredSignupsBySession is in scope
            
            // Try exact match first
            if (currentFilteredSignups[session.id]) {
              sessionSignups = currentFilteredSignups[session.id];
            } else {
              // Try all alternative IDs
              for (const altId of session.alternativeIds) {
                if (currentFilteredSignups[altId]) {
                  sessionSignups = currentFilteredSignups[altId];
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
            // --- Use the isSessionPublished function ---
            const isPublished = isSessionPublished(session.id);
            // --- End Use the isSessionPublished function ---
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
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap sm:flex-row justify-between gap-3">
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
                        {/* --- Conditionally render Editing Window badge --- */}
                        {session.status === "editing" && !isPublished && (
                          <span className="text-xs px-2 py-1 rounded-full bg-chart-4/10 text-chart-4 font-medium">
                            Editing Window Open
                          </span>
                        )}
                        {/* --- End Conditional render --- */}
                        {session.status === "completed" && !isPublished && ( // Show completed only if not published
                          <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                            Completed
                          </span>
                        )}
                        {/* Add published badge */}
                        {isPublished && (
                          <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                            Published
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Make the batch adjustment and publish buttons appear side by side, aligned horizontally */}
                    <div className="flex flex-row gap-2 items-center">
                        {session.status === "editing" && hasSignups && !isPublished && (
                        <>
                          <Dialog>
                          <DialogTrigger asChild>
                            <Button
                            variant="outline"
                            size="sm"
                            className="whitespace-nowrap"
                            >
                            <Clock className="h-4 w-4 mr-2" />
                            <span className="hidden sm:inline">Adjust All Times</span>
                            <span className="sm:hidden">Batch Edit</span>
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                            <DialogTitle>Batch Adjust Check-out Times</DialogTitle>
                            <DialogDescription>
                              Add time to all volunteer check-out times in this session. 
                              This is useful when volunteers stayed longer than initially recorded.
                            </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                            <div className="flex items-center justify-center gap-4">
                              <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setBatchMinutesAdjustment(prev => Math.max(5, prev - 5))}
                              disabled={applyingBatchAdjustment[session.id]}
                              >
                              -
                              </Button>
                              <div className="flex flex-col items-center gap-1">
                              <span className="text-2xl font-semibold">{batchMinutesAdjustment}</span>
                              <span className="text-sm text-muted-foreground">minutes</span>
                              </div>
                              <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setBatchMinutesAdjustment(prev => Math.min(120, prev + 5))}
                              disabled={applyingBatchAdjustment[session.id]}
                              >
                              +
                              </Button>
                            </div>
                            <div className="text-sm text-muted-foreground text-center">
                              This will extend the check-out time for {sessionSignups.filter(signup => editedTimes[signup.id]?.check_out_time).length} volunteers
                            </div>
                            </div>
                            <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline" className="hidden sm:inline">Cancel</Button>
                            </DialogClose>
                            <Button 
                              onClick={() => handleBatchAdjustment(session.id, batchMinutesAdjustment)}
                              disabled={applyingBatchAdjustment[session.id]}
                            >
                              {applyingBatchAdjustment[session.id] ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Applying...
                              </>
                              ) : (
                              'Apply Adjustment'
                              )}
                            </Button>
                            </DialogFooter>
                          </DialogContent>
                          </Dialog>
                        </>
                        )}

                      {session.status === "editing" && hasSignups && !isPublished && (
                        <Button
                          onClick={() => initiatePublishHours(session.id)}
                          disabled={isPublishing || !hasValidHoursData || hasInvalidTimes}
                          className="whitespace-nowrap"
                          size="sm"
                        >
                          {isPublishing ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Publishing...
                            </>
                          ) : (
                            <>
                              <CheckCircle className="h-4 w-4 mr-1.5" />
                              <span>Publish Hours</span>
                            </>
                          )}
                        </Button>
                      )}
                      
                      {/* Show view certificates button if published */}
                      {isPublished && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="whitespace-nowrap"
                          onClick={() => loadCertificatesData(session.id)}
                          disabled={loadingCertificates}
                        >
                          {loadingCertificates ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                              Loading...
                            </>
                          ) : (
                            <>
                              <FileText className="h-4 w-4 mr-1.5" />
                              <span className="hidden sm:inline">View Certificates</span>
                              <span className="sm:hidden">Certificates</span>
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Batch adjustment description */}
                  {showBatchAdjustment[session.id] && !applyingBatchAdjustment[session.id] && (
                    <div className="text-sm text-muted-foreground bg-muted/40 p-2 rounded border">
                      <p>
                        This will add <span className="font-semibold">{batchMinutesAdjustment} minutes</span> to all volunteer check-out times in this session. Useful for extending hours when volunteers stayed longer than initially recorded.
                      </p>
                    </div>
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
                
                {isPublished && (
                  <div className="border rounded-md p-4 bg-primary/5 flex flex-col items-center justify-center py-6 text-center">
                    <p className="text-primary font-medium">
                      This session&apos;s hours have been published and certificates generated.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Hours can no longer be modified. Contact support for any needed changes.
                    </p>
                  </div>
                )}
                
                {hasSignups && !isPublished ? (
                  <div className="overflow-x-auto -mx-3 sm:mx-0 pb-2">
                    <div className="inline-block min-w-full align-middle">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="whitespace-nowrap min-w-[140px]">Name</TableHead>
                            <TableHead className="whitespace-nowrap">Email</TableHead>
                            <TableHead className="whitespace-nowrap">Check-in</TableHead>
                            <TableHead className="whitespace-nowrap">Check-out</TableHead>
                            <TableHead className="whitespace-nowrap flex items-center gap-1">
                              Duration
                              <span>
                              <div>
                                <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                  <span tabIndex={0} aria-label="Duration info">
                                    <Info className="h-4 w-4 cursor-pointer" aria-hidden="true" />
                                  </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" align="center">
                                  Times may be off by ±1 minute due to rounding seconds to the nearest minute.
                                  </TooltipContent>
                                </Tooltip>
                                </TooltipProvider>
                              </div>
                              </span>
                            </TableHead>
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
                                <TableCell className="font-medium py-2.5 px-3 sm:p-4">
                                  {name || 'N/A'}
                                  {hasBeenEdited && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      <PencilLine className="h-3 w-3 inline-block" /> Edited
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="py-2.5 px-3 sm:p-4">
                                  <span className="truncate max-w-[120px] sm:max-w-none block">{email || 'N/A'}</span>
                                </TableCell>
                                <TableCell className="py-2.5 px-3 sm:p-4">
                                  <div className="max-w-[120px]">
                                  <TimePicker
                                    value={currentEdit.check_in_time 
                                    ? format(new Date(currentEdit.check_in_time), 'HH:mm')
                                    : ''}
                                    onChangeAction={(time) => handleTimeChange(signup.id, 'check_in_time', time)}
                                    disabled={session.status !== 'editing'}
                                  />
                                  </div>
                                </TableCell>
                                <TableCell className="py-2.5 px-3 sm:p-4">
                                  <div className="max-w-[120px]">
                                  <TimePicker
                                    value={currentEdit.check_out_time 
                                    ? format(new Date(currentEdit.check_out_time), 'HH:mm')
                                    : ''}
                                    onChangeAction={(time) => handleTimeChange(signup.id, 'check_out_time', time)}
                                    disabled={session.status !== 'editing'}
                                  />
                                  </div>
                                </TableCell>
                                <TableCell className="py-2.5 px-3 sm:p-4">
                                  <span className={`text-xs font-medium ${!duration.isValid ? 'text-destructive' : ''}`}>
                                  {duration.text}
                                  </span>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ) : (
                  !isPublished && (
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
                  )
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
