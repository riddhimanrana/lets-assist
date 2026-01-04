"use client";

import { useState, useEffect, useMemo } from "react";
import { Project, Signup, Profile } from "@/types";
import { User } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { getSlotDetails } from "@/utils/project";
import { getProjectStartDateTime, getProjectEndDateTime } from "@/utils/project";
import { formatTimeTo12Hour } from "@/lib/utils";
import {
  differenceInHours,
  differenceInMinutes,
  isBefore,
  isAfter,
  parseISO,
  format,
  formatDistanceToNowStrict,
  parse,
} from "date-fns";
import { Clock, CheckCircle, AlertTriangle, Camera, Hourglass, CalendarCheck, Info, ExternalLink,TicketCheck, FileText, Award } from "lucide-react";
import { Medal } from "lucide-react"; // Use Medal icon instead of Certificate
import Link from "next/link";
import { useRouter } from "next/navigation"; // Import useRouter
import { QRCodeScannerModal } from "@/app/projects/_components/QRCodeScannerModal"; // Import the new component
import { createClient } from "@/utils/supabase/client";          // 🆕 add supabase client
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"; // Import shadcn carousel

// Helper function to format remaining time (copied from AttendanceClient)
function formatRemainingTime(minutes: number): string {
  if (minutes <= 0) return "Session ended";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60) + 1;
  let result = "";
  if (hours > 0) {
    result += `${hours}h `;
  }
  if (remainingMinutes > 0 || hours === 0) {
      result += `${remainingMinutes}m`;
  }
  return result.trim() || "0m"; // Ensure "0m" if exactly 0
}

// Helper function to get combined DateTime from date and time strings
function getCombinedDateTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  try {
    // Use date-fns parse which is more robust
    const dateTime = parseISO(`${dateStr}T${timeStr}`);
    return isNaN(dateTime.getTime()) ? null : dateTime;
  } catch (e) {
    console.error("Error parsing date/time:", e);
    return null;
  }
}

// Helper function to calculate and format duration between check-in and check-out
function calculateVolunteerDuration(checkIn: string | null, checkOut: string | null): {
  text: string;
  isValid: boolean;
  totalMinutes: number;
} {
  if (!checkIn || !checkOut) {
    return { text: 'Incomplete', isValid: false, totalMinutes: 0 };
  }
  
  try {
    const checkInDate = parseISO(checkIn);
    const checkOutDate = parseISO(checkOut);
    
    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
      return { text: 'Invalid times', isValid: false, totalMinutes: 0 };
    }
    
    const diffMinutes = differenceInMinutes(checkOutDate, checkInDate);
    
    if (diffMinutes < 0) {
      return { text: 'Invalid duration', isValid: false, totalMinutes: 0 };
    }
    
    if (diffMinutes > 24 * 60) {
      return { text: 'Over 24h', isValid: false, totalMinutes: diffMinutes };
    }
    
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    
    if (hours > 0 && minutes > 0) {
      return { text: `${hours}h ${minutes}m`, isValid: true, totalMinutes: diffMinutes };
    } else if (hours > 0) {
      return { text: `${hours}h`, isValid: true, totalMinutes: diffMinutes };
    } else {
      return { text: `${minutes}m`, isValid: true, totalMinutes: diffMinutes };
    }
  } catch (error) {
    return { text: 'Error calculating', isValid: false, totalMinutes: 0 };
  }
}


interface Props {
  project: Project;
  user: User;
  signups: Signup[]; // Array of user's approved signups for this project
}

export default function UserDashboard({ project, user, signups }: Props) {
  const router = useRouter();
  const [now, setNow] = useState(new Date());
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [selectedScheduleForScan, setSelectedScheduleForScan] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  // 🆕 store map of signup_id → certificate.id
  const [certMap, setCertMap] = useState<Record<string,string>>({});

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Update 'now' state every minute for countdowns
  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(new Date());
    }, 60000); // Update every 60 seconds
    return () => clearInterval(intervalId);
  }, []);

  // 🆕 fetch certificates for all signups once
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("certificates")
      .select("id, signup_id")
      .in("signup_id", signups.map((s) => s.id))
      .then(({ data, error }) => {
        if (error) {
          console.error("Error fetching certificates:", error);
        } else {
          const map: Record<string,string> = {};
          data?.forEach((cert) => {
            map[cert.signup_id] = cert.id;
          });
          setCertMap(map);
        }
      });
  }, [signups]);

  // --- ADDED: Calculate overall project phase for signup-only alerts ---
  const projectStartDateTime = useMemo(() => getProjectStartDateTime(project), [project]);
  const projectEndDateTime = useMemo(() => getProjectEndDateTime(project), [project]);
  const isSignupOnly = project.verification_method === 'signup-only';
  const isProjectStartingSoon = useMemo(() => {
    const hoursUntilStart = differenceInHours(projectStartDateTime, now);
    return hoursUntilStart <= 24 && isBefore(now, projectStartDateTime);
  }, [projectStartDateTime, now]);
  const isProjectProgressing = useMemo(() => {
    return isAfter(now, projectStartDateTime) && isBefore(now, projectEndDateTime);
  }, [projectStartDateTime, projectEndDateTime, now]);
  const isProjectCompleted = useMemo(() => isAfter(now, projectEndDateTime), [projectEndDateTime, now]);
  // --- END ADDED ---

  // --- Process Each Signup ---
  const signupStatuses = useMemo(() => {
    return signups
      .map((signup) => {
        // First check if signup status is valid for processing
        // Using type-safe approach with Array.includes
        const validStatuses = ['approved', 'attended'] as const;
        if (!validStatuses.includes(signup.status as any)) {
          return null; // Skip signups that are not approved or already attended
        }

        const details = getSlotDetails(project, signup.schedule_id);
        if (!details) return null; // Skip if slot details not found

        // Find the date for the slot
        let slotDate: string | undefined;
        if (project.schedule?.multiDay) {
          for (const day of project.schedule.multiDay) {
            if (day.slots.some(slot => slot === details)) {
              slotDate = day.date;
              break;
            }
          }
        } else if (project.schedule?.oneTime) {
          slotDate = project.schedule.oneTime.date;
        } else if (project.schedule?.sameDayMultiArea) {
          slotDate = project.schedule.sameDayMultiArea.date;
        }

        if (!slotDate || !details.startTime || !details.endTime) {
          return null; // Skip if essential time info is missing
        }

        const startTime = getCombinedDateTime(slotDate, details.startTime);
        const endTime = getCombinedDateTime(slotDate, details.endTime);

        // Use type-safe comparison for status
        const isAttended = signup.status === 'attended' as any;
        const isApproved = signup.status === 'approved' as any;
        const checkIn = signup.check_in_time ? new Date(signup.check_in_time) : null;
        const checkOut = signup.check_out_time ? new Date(signup.check_out_time) : null;

        if (!startTime || !endTime) {
          return null; // Skip if dates are invalid
        }

        const diffHours = differenceInHours(startTime, now);
        const diffMinutes = differenceInMinutes(startTime, now);
        const sessionOver = isAfter(now, endTime);
        const sessionInProgress = isAfter(now, startTime) && isBefore(now, endTime);

        // Check if we're in the post-event window (first 48 hours after event)
        const hoursSinceEnd = differenceInHours(now, endTime);
        const isInPostEventWindow = sessionOver && hoursSinceEnd >= 0 && hoursSinceEnd < 48;

        // Check if we're past the post-event window
        const isPastPostEventWindow = sessionOver && hoursSinceEnd >= 48;

        // --- ADDED: Check if hours are published for this specific schedule_id ---
        const areHoursPublished = project.published && project.published[signup.schedule_id] === true;
        
        // --- Check for corresponding certificate based on signup_id ---
        const certificateId = certMap[signup.id] ?? null;
        // --- END ADDED ---

        // --- For approved users who didn't attend, show no-show message after event ---
        // --- MODIFIED: Only show missedEvent if hours are NOT published ---
        if (isApproved && !isAttended && sessionOver && !areHoursPublished) {
          return {
            signup,
            slotDetails: details,
            sessionStartTime: startTime,
            sessionEndTime: endTime,
            isSessionOver: sessionOver,
            renderState: 'missedEvent',
            sessionDisplayName: getSessionDisplayName(project, startTime, details),
            certificateId,
          };
        }

        // --- For attended users, show hours editing message during editing window ---
        // --- MODIFIED: Only show postEventHours if hours are NOT published ---
        if (isAttended && isInPostEventWindow && !areHoursPublished) {
          return {
            signup,
            slotDetails: details,
            sessionStartTime: startTime,
            sessionEndTime: endTime,
            hoursSinceEnd,
            checkInTime: checkIn,
            renderState: 'postEventHours',
            sessionDisplayName: getSessionDisplayName(project, startTime, details)
          };
        }

        // Skip rendering if the session is over and the user never attended (and hours aren't published)
        if (sessionOver && !isAttended && !areHoursPublished) {
            return null;
        }

        // Skip rendering if the session is more than 24 hours away (unless already attended or hours published)
        if (diffHours > 24 && !isAttended && !areHoursPublished) {
            return null;
        }

        let progress = 0;
        let remainingFormatted = "";
        // Calculate progress based on check-in time if available, even if attended
        if (checkIn) {
          const checkInTimeForCalc = isAttended && !checkIn ? startTime : checkIn; // Use start time if attended but no check-in logged (fallback)
          const totalDurationMinutes = differenceInMinutes(endTime, checkInTimeForCalc);
          const elapsedSinceCheckInMinutes = differenceInMinutes(now, checkInTimeForCalc);
          if (totalDurationMinutes > 0) {
            progress = Math.max(0, Math.min(100, (elapsedSinceCheckInMinutes / totalDurationMinutes) * 100));
          } else {
            progress = now >= endTime ? 100 : 0;
          }
          const remainingMinutes = differenceInMinutes(endTime, now);
          remainingFormatted = formatRemainingTime(remainingMinutes);
        } else if (isAttended && now >= endTime) {
            // If attended but no check-in time, show 100% progress after session ends
            progress = 100;
            remainingFormatted = "Session ended";
        }


        let untilStartFormatted = "";
        if (diffMinutes > 0) {
          untilStartFormatted = formatDistanceToNowStrict(startTime, { unit: diffHours >= 1 ? 'hour' : 'minute' });
        }

        // --- MODIFIED: Determine state for rendering with type-safe comparisons and published hours check ---
        let renderState: 'checkedIn' | 'checkInOpen' | 'reminder' | 'none' | 'postEventHours' | 'missedEvent' | 'hoursPublished' = 'none';

        if (areHoursPublished) {
            renderState = 'hoursPublished'; // Highest priority if hours are published
        } else if (isAttended && isInPostEventWindow) {
            renderState = 'postEventHours'; // Show processing message during the 48hr window
        } else if (isAttended) {
            renderState = 'checkedIn'; // Show checked-in status (during event or after 48hrs if not published)
        } else if (isApproved) { // Only apply time logic if status is 'approved' and hours not published
            if (sessionOver) {
                renderState = 'missedEvent'; // Show missed event if approved, session over, not attended, not published
            } else {
                const totalDurationMinutes = differenceInMinutes(endTime, startTime);
                // Check-in available: <= 2 hours before start AND before the session ends
                if (diffMinutes <= 120 && diffMinutes > -totalDurationMinutes) {
                    renderState = 'checkInOpen';
                }
                // Reminder state: > 2 hours before start AND <= 24 hours before start
                else if (diffMinutes > 120 && diffHours <= 24) {
                    renderState = 'reminder';
                }
            }
        }


        // Return all necessary data for rendering this specific signup
        return {
          signup,
          slotDetails: details,
          sessionStartTime: startTime,
          sessionEndTime: endTime,
          hoursUntilStart: diffHours,
          minutesUntilStart: diffMinutes,
          isCheckedIn: isAttended,
          checkInTime: checkIn,
          checkOutTime: checkOut,
          isSessionOver: sessionOver,
          isSessionInProgress: sessionInProgress,
          progressPercentage: progress,
          remainingTimeFormatted: remainingFormatted,
          timeUntilStartFormatted: untilStartFormatted,
          hoursSinceEnd,
          isInPostEventWindow,
          isPastPostEventWindow,
          sessionDisplayName: getSessionDisplayName(project, startTime, details),
          renderState,
          certificateId,           // 🆕 include here
          areHoursPublished,
        };
      })
      .filter(status => status !== null && status.renderState !== 'none'); // Filter out nulls and 'none' state
  }, [signups, project, now, certMap]);

  // Create card elements array for the carousel
  const eventCards = useMemo(() => {
    if (!signupStatuses || signupStatuses.length === 0) {
      return [];
    }
    
    return signupStatuses.map((status) => {
      if (!status) return null; // Should not happen due to filter, but good practice

      switch (status.renderState) {
        // --- ADDED: New case for published hours ---
        case 'hoursPublished':
          return (
            <Card key={status.signup.id} className="border-chart-5/30 bg-chart-5/5 overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="bg-chart-5/10 p-2 rounded-full">
                    <Award className="h-5 w-5 text-chart-5" /> {/* Using Award icon */}
                  </div>
                  <div>
                    <CardTitle className="text-lg">Volunteer Hours Published!</CardTitle>
                    <CardDescription>Your hours for {project.title} have been finalized.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                {/* Session info */}
                <div className="flex flex-col space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-muted-foreground">Session:</span>
                    <span>{status.sessionDisplayName}</span>
                  </div>
                  {status.checkInTime && (
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">Check-in:</span>
                      <span>{format(status.checkInTime, "MMM d, h:mm a")}</span>
                    </div>
                  )}
                  {status.checkOutTime && (
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">Check-out:</span>
                      <span>{format(status.checkOutTime, "MMM d, h:mm a")}</span>
                    </div>
                  )}
                  {status.checkInTime && status.checkOutTime && (() => {
                    const duration = calculateVolunteerDuration(
                      status.checkInTime.toISOString(),
                      status.checkOutTime.toISOString()
                    );
                    return (
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-muted-foreground">Total Hours:</span>
                        <span className={`font-semibold ${duration.isValid ? 'text-chart-5' : 'text-destructive'}`}>
                          {duration.text}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* Info Section */}
                <div className="relative pl-6 border-chart-5/30 mt-3 space-y-3">
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0 w-5 h-5 rounded-full bg-chart-5/20 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-chart-5"></div>
                    </div>
                    <p className="text-sm font-medium">View Your Record</p>
                    <p className="text-xs text-muted-foreground">
                      Your participation details and hours are now available in your volunteer dashboard
                    </p>
                  </div>
                </div>

                {/* Link to Profile */}
                <div className="mt-3 flex justify-end">
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/certificates/${status.certificateId}`}>
                      <TicketCheck className="h-4 w-4 mr-1.5" />
                      View Certificate
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        // --- END ADDED ---

        // Add new case for post-event hours state
        case 'postEventHours':
          return (
            <Card key={status.signup.id} className="border-chart-4/30 bg-chart-4/5 overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="bg-chart-4/10 p-2 rounded-full">
                    <FileText className="h-5 w-5 text-chart-4" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Hours Being Processed</CardTitle>
                    <CardDescription>Thank you for your participation in {project.title}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                {/* Session info */}
                <div className="flex flex-col space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-muted-foreground">Session:</span>
                    <span>{status.sessionDisplayName}</span>
                  </div>
                  {status.checkInTime && (
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">Check-in:</span>
                      <span>{format(status.checkInTime, "MMM d, h:mm a")}</span>
                    </div>
                  )}
                  {status.checkOutTime && (
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">Check-out:</span>
                      <span>{format(status.checkOutTime, "MMM d, h:mm a")}</span>
                    </div>
                  )}
                  {status.checkInTime && status.checkOutTime && (() => {
                    const duration = calculateVolunteerDuration(
                      status.checkInTime.toISOString(),
                      status.checkOutTime.toISOString()
                    );
                    return (
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-muted-foreground">Total Hours:</span>
                        <span className={`font-semibold ${duration.isValid ? 'text-chart-4' : 'text-destructive'}`}>
                          {duration.text}
                        </span>
                      </div>
                    );
                  })()}
                </div>
                
                {/* Processing information with visual timeline */}
                <div className="relative pl-6 border-chart-4/30 mt-3 space-y-3">
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0 w-5 h-5 rounded-full bg-chart-4/20 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-chart-4"></div>
                    </div>
                    <p className="text-sm font-medium">Processing Period</p>
                    <p className="text-xs text-muted-foreground">
                      The project owner is reviewing hours and all records will be finalized within 48 hours after the event.
                    </p>
                  </div>
                  
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0 w-5 h-5 rounded-full bg-chart-4/20 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-chart-4"></div>
                    </div>
                    <p className="text-sm font-medium">Need Adjustments?</p>
                    <p className="text-xs text-muted-foreground">
                      If your recorded hours need correction, please contact the project owner directly.
                    </p>
                  </div>
                </div>
                
                {/* Approx time remaining */}
                <div className="bg-chart-4/10 rounded-md p-3 flex items-center justify-between mt-2">
                  <span className="text-xs font-medium text-chart-4">Processing time remaining:</span>
                  <span className="text-xs font-medium text-chart-4">
                    {48 - (status.hoursSinceEnd || 0)} hours
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        
        // Add new case for missed event state
        case 'missedEvent':
          return (
            <Card key={status.signup.id} className="border-chart-7/30 bg-chart-7/5 overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
              <div className="bg-chart-7/10 p-2 rounded-full">
                <AlertTriangle className="h-5 w-5 text-chart-7" />
              </div>
              <div>
                <CardTitle className="text-lg">Event Not Attended</CardTitle>
                <CardDescription>
                You were signed up for {project.title} but no attendance was recorded.
                </CardDescription>
              </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              {/* Session info */}
              <div className="flex flex-col space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="font-medium text-muted-foreground">Session:</span>
                <span>{status.sessionDisplayName}</span>
              </div>
              </div>
              {/* Timeline style info */}
              <div className="relative pl-6 border-chart-7/30 mt-3 space-y-3">
              <div className="relative">
                <div className="absolute -left-[27px] top-0 w-5 h-5 rounded-full bg-chart-7/20 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-chart-7"></div>
                </div>
                <p className="text-sm font-medium">Think This Is a Mistake?</p>
                <p className="text-xs text-muted-foreground">
                If you believe this is an error, please contact the project organizer directly. Your signup status might be updated if there was a check-in issue.
                </p>
              </div>
              </div>
            </CardContent>
            </Card>
          );

        // 1. Checked-in State (Triggered by signup.status === 'attended')
        case 'checkedIn':
          // Use checkInTime if available, otherwise indicate attendance without specific time
          const checkInDisplayTime = status.checkInTime ? format(status.checkInTime, "h:mm a") : "Confirmed";
          const checkOutDisplayTime = status.checkOutTime ? format(status.checkOutTime, "h:mm a") : null;
          
          // --- MODIFIED: Don't show progress if session is over (and hours not published yet) OR checked out ---
          const showProgress = !status.isSessionOver && !status.checkOutTime;
          return (
            <Card key={status.signup.id} className="border-primary/30 bg-primary/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-2 rounded-full">
                    <CheckCircle className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">
                      {status.checkOutTime ? "Attendance Completed" : "Attendance Confirmed"}
                    </CardTitle> {/* Updated Title */}
                    <CardDescription>Your attendance for {project.title} is confirmed.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-muted-foreground">Session:</span>
                  <>{status.sessionDisplayName}</>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-muted-foreground">Status:</span>
                  {/* Display check-in time if available */}
                  <span>{checkInDisplayTime === "Confirmed" ? "Attended" : `Checked in at ${checkInDisplayTime}`}</span>
                </div>
                {checkOutDisplayTime && (
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-muted-foreground">Check-out:</span>
                    <span>Checked out at {checkOutDisplayTime}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="font-medium text-muted-foreground">Session Time:</span>
                  <span>
                    {formatTimeTo12Hour(status.slotDetails.startTime)} - {formatTimeTo12Hour(status.slotDetails.endTime)}
                  </span>
                </div>
                {/* Progress Bar - Conditionally render based on session progress */}
                {showProgress && (
                   <div className="space-y-1 pt-2">
                     <div className="flex justify-between items-center mb-1">
                       <span className="font-medium text-muted-foreground">Session Progress:</span>
                       <span>{status.remainingTimeFormatted} remaining</span>
                     </div>
                     <Progress value={status.progressPercentage ?? 0} aria-label={`Session progress: ${Math.round(status.progressPercentage ?? 0)}%`} />
                   </div>
                )}
                 {/* Show message when session ended (and hours not published) */}
                 {!showProgress && !status.areHoursPublished && (
                     <p className="text-xs text-muted-foreground text-center pt-2">Session concluded. Awaiting final hours processing.</p>
                 )}
              </CardContent>
            </Card>
          );

        // 2. Check-in Available State (Triggered by approved status + time window)
        case 'checkInOpen':
          // Don't show check-in info for cancelled projects or sign-up only projects
          if (project.status === 'cancelled' || project.verification_method === 'signup-only') {
            return null;
          }
          
          // Get check-in information text based on verification method
          let checkInInfoText;
          let buttonContent = null;
          let alertTitle = 'Check-in is open!';
          
          switch(project.verification_method) {
            case 'qr-code':
              alertTitle = 'Check-in is open!';
              checkInInfoText = `Check-in for your session ${status.sessionDisplayName} starting at ${formatTimeTo12Hour(status.slotDetails.startTime)} is now available. Scan the QR code provided by the organizer to check in.`;
              buttonContent = (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Open camera to scan QR code for session ${status.sessionDisplayName}`}
                  onClick={() => {
                    setSelectedScheduleForScan(status.signup.schedule_id);
                    setIsCameraModalOpen(true);
                  }}
                >
                  <Camera className="h-4 w-4 mr-1.5" />
                  Scan QR Code
                </Button>
              );
              break;
            
            case 'manual':
              alertTitle = 'Check-in Required';
              checkInInfoText = `Check-in for your session ${status.sessionDisplayName} starting at ${formatTimeTo12Hour(status.slotDetails.startTime)} needs to be done in person. Please find the project organizer when you arrive at the venue.`;
              break;
            
            case 'auto':
              alertTitle = 'Upcoming Session';
              checkInInfoText = `Check-in for your session ${status.sessionDisplayName} starting at ${formatTimeTo12Hour(status.slotDetails.startTime)} will happen automatically at the start time. No action is required from you.`;
              break;
            
            default:
              checkInInfoText = `Check-in for your session ${status.sessionDisplayName} starting at ${formatTimeTo12Hour(status.slotDetails.startTime)} is now available.`;
          }
          
          return (
            <Card key={status.signup.id} className="border-primary/30 bg-primary/5 overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-2 rounded-full">
                    <Hourglass className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{alertTitle}</CardTitle>
                    <CardDescription>Check-in available for {project.title}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <div className="flex flex-col space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-muted-foreground">Session:</span>
                    <span>{status.sessionDisplayName}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-muted-foreground">Starts At:</span>
                    <span>{formatTimeTo12Hour(status.slotDetails.startTime)}</span>
                  </div>
                </div>
                
                <p className="text-sm text-muted-foreground">{checkInInfoText}</p>
                
                {buttonContent && (
                  <div className="mt-2">
                    {buttonContent}
                  </div>
                )}
              </CardContent>
            </Card>
          );

        // 3. Reminder State (Triggered by approved status + time window)
        case 'reminder':
          // --- ADDED: Skip reminder card if general 'starting soon' alert is shown for signup-only ---
          if (isSignupOnly && isProjectStartingSoon) {
            return null;
          }
          // --- END ADDED ---
          return (
            <Card key={status.signup.id} className="border-chart-3/30 bg-chart-3/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <CalendarCheck className="h-6 w-6 text-chart-3 flex-shrink-0" />
                  <div>
                    <CardTitle className="text-lg">Upcoming Session</CardTitle>
                    <CardDescription>Your scheduled session for {project.title} is approaching.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-muted-foreground">Session:</span>
                  <>{status.sessionDisplayName}</>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-muted-foreground">Starts In:</span>
                  <span className="font-semibold text-chart-3">{status.timeUntilStartFormatted}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-muted-foreground">Session Time:</span>
                  <span>
                    {formatTimeTo12Hour(status.slotDetails.startTime)} - {formatTimeTo12Hour(status.slotDetails.endTime)}
                  </span>
                </div>
                <div className="pt-2">
                  {/* --- MODIFIED: Add conditional text for auto check-in --- */}
                  {project.verification_method === 'auto' ? (
                    <p className="text-xs text-muted-foreground text-center">
                      Check-in will happen automatically at the start time. No action needed.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center">
                      Check-in will be available 2 hours before start time.
                    </p>
                  )}
                  {/* --- END MODIFIED --- */}
                </div>
              </CardContent>
            </Card>
          );

        default:
          return null;
      }
    }).filter(Boolean); // Remove null values
  }, [signupStatuses, project, setSelectedScheduleForScan, setIsCameraModalOpen, isSignupOnly, isProjectStartingSoon]);

  // Helper function to get a consistent session display name
  function getSessionDisplayName(project: Project, startTime: Date | null, details: any): string {
    // If multiRole event with named roles, keep using the role name
    if ('name' in details && details.name) {
        return details.name;
    }
    // For oneTime events, show "Main Event"
    else if (project.schedule?.oneTime) {
        return "Main Event";
    }
    // For multiDay events, format the date nicely with time
    else if (project.schedule?.multiDay && startTime) {
        // Format the date from the session start time and include time info
        const formattedDate = format(startTime, "MMMM d, yyyy");
        const formattedStartTime = formatTimeTo12Hour(details.startTime);
        const formattedEndTime = formatTimeTo12Hour(details.endTime);
        return `${formattedDate} (${formattedStartTime} - ${formattedEndTime})`;
    }
    // Default fallback
    else {
        return details.schedule_id || "Session";
    }
  }

  // --- Render Logic ---

  // Don't show any signup statuses if the project is cancelled
  // if (project.status === 'cancelled') {
  //   return null;
  // }
  // NOTE: 'cancelled' is not a valid status. Remove or update this check if you add 'cancelled' to the Project type.

  // --- MODIFIED: Render general signup-only alerts first ---
  const renderGeneralSignupOnlyAlert = () => {
    if (!isSignupOnly || project.status === 'cancelled') return null;

    if (isProjectStartingSoon) {
      return (
        <Card className="mb-6 border-chart-3/30 bg-chart-3/5 overflow-hidden">
          <CardHeader className="p-6">
            <div className="flex items-center gap-3">
              <div className="bg-chart-3/10 p-2 rounded-full">
                <Info className="h-5 w-5 text-chart-3" />
              </div>
              <div>
                <CardTitle className="text-lg">Event Starting Soon!</CardTitle>
                <CardDescription>
                  The signup-only event &quot;{project.title}&quot; is scheduled to start within 24 hours.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      );
    }
    if (isProjectProgressing) {
      return (
        <Card className="mb-6 border-chart-4/30 bg-chart-4/5 overflow-hidden">
          <CardHeader className="p-6">
            <div className="flex items-center gap-3">
              <div className="bg-chart-4/10 p-2 rounded-full">
                <Clock className="h-5 w-5 text-chart-4" />
              </div>
              <div>
                <CardTitle className="text-lg">Event in Progress</CardTitle>
                <CardDescription>
                  The signup-only event &quot;{project.title}&quot; is currently in progress.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      );
    }
    if (isProjectCompleted) {
      return (
        <Card className="mb-6 border-chart-5/30 bg-chart-5/5 overflow-hidden">
          <CardHeader className="p-6">
            <div className="flex items-center gap-3">
              <div className="bg-chart-5/10 p-2 rounded-full">
                <CheckCircle className="h-5 w-5 text-chart-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Event Completed</CardTitle>
                <CardDescription>
                  The signup-only event &quot;{project.title}&quot; has finished based on its schedule.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      );
    }

    return null;
  };
  // --- END MODIFIED ---

  // Don't show any signup statuses if the project is cancelled
  // if (project.status === 'cancelled') {
  //   return null;
  // }

  // Handle case where there are no event cards
  if (!isMounted) {
    return null;
  }

  if (!eventCards || eventCards.length === 0) {
    // Render general alerts even if no specific signup cards are shown
    return <div className="space-y-4">{renderGeneralSignupOnlyAlert()}</div>;
  }

  return (
    <div className="space-y-4 mb-6">
      {/* --- ADDED: Render general signup-only alert --- */}
      {renderGeneralSignupOnlyAlert()}
      {/* --- END ADDED --- */}

      {/* Event Cards Carousel */}
      <Carousel
        className="w-full"
        opts={{
          align: "start",
          loop: false,
        }}
      >
        <CarouselContent className="-ml-2 md:-ml-4">
          {eventCards.map((card, index) => (
            <CarouselItem key={index} className="pl-2 md:pl-4">
              {card}
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-0 h-8 w-8" />
        <CarouselNext className="right-0 h-8 w-8" />
      </Carousel>

      {/* Replace placeholder Dialog with the actual QRCodeScannerModal - only render for QR code verification method */}
      {project.verification_method === 'qr-code' && (
        <QRCodeScannerModal
          isOpen={isCameraModalOpen}
          onClose={() => {
              setIsCameraModalOpen(false);
              setSelectedScheduleForScan(null); // Clear selected schedule on close
          }}
          projectId={project.id}
          expectedScheduleId={selectedScheduleForScan}
        />
      )}
    </div>
  );
}
