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
import { Clock, CheckCircle, AlertTriangle, Camera, Hourglass, CalendarCheck, Info, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation"; // Import useRouter
import { QRCodeScannerModal } from "@/components/QRCodeScannerModal"; // Import the new component

// Helper function to format remaining time (copied from AttendanceClient)
function formatRemainingTime(minutes: number): string {
  if (minutes <= 0) return "Session ended";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  let result = "";
  if (hours > 0) {
    result += `${hours}h `;
  }
  if (remainingMinutes > 0 || hours === 0) {
      result += `${remainingMinutes}m`;
  }
  return result.trim() || "0m"; // Ensure "0m" if exactly 0
}

// Helper to get combined DateTime from date and time strings
function getCombinedDateTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  try {
    // Use date-fns parse which is more robust
    const dateTime = parse(`${dateStr} ${timeStr}`, 'yyyy-MM-dd HH:mm', new Date());
    return isNaN(dateTime.getTime()) ? null : dateTime;
  } catch (e) {
    console.error("Error parsing date/time:", e);
    return null;
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


  // Update 'now' state every minute for countdowns
  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(new Date());
    }, 60000); // Update every 60 seconds
    return () => clearInterval(intervalId);
  }, []);

  // --- Process Each Signup ---
  const signupStatuses = useMemo(() => {
    return signups
      .map(signup => {
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
        const checkIn = signup.check_in_time ? new Date(signup.check_in_time) : null;

        if (!startTime || !endTime) {
          return null; // Skip if dates are invalid
        }

        const diffHours = differenceInHours(startTime, now);
        const diffMinutes = differenceInMinutes(startTime, now);
        const sessionOver = isAfter(now, endTime);
        const sessionInProgress = isAfter(now, startTime) && isBefore(now, endTime);
        // --- MODIFIED: isCheckedIn is now equivalent to isAttended for state logic ---
        // const isCheckedIn = !!checkIn; // We'll use isAttended for state determination

        // Skip rendering if the session is over and the user never attended
        if (sessionOver && !isAttended) {
            return null;
        }

        // Skip rendering if the session is more than 24 hours away (unless already attended)
        if (diffHours > 24 && !isAttended) {
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

        // --- MODIFIED: Determine state for rendering with type-safe comparisons ---
        let renderState: 'checkedIn' | 'checkInOpen' | 'reminder' | 'none' = 'none';
        if (signup.status === 'attended' as any) {
            renderState = 'checkedIn'; // Priority 1: If status is 'attended', show checkedIn card
        } else if (signup.status === 'approved' as any) { // Only apply time logic if status is 'approved'
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


        // Return all necessary data for rendering this specific signup
        return {
          signup,
          slotDetails: details,
          sessionStartTime: startTime,
          sessionEndTime: endTime,
          hoursUntilStart: diffHours,
          minutesUntilStart: diffMinutes,
          // --- MODIFIED: Use isAttended for the primary state check ---
          isCheckedIn: isAttended, // Keep this name for consistency in card rendering logic? Or rename? Let's keep for now.
          checkInTime: checkIn, // Keep original check-in time if available
          isSessionOver: sessionOver,
          isSessionInProgress: sessionInProgress,
          progressPercentage: progress,
          remainingTimeFormatted: remainingFormatted,
          timeUntilStartFormatted: untilStartFormatted,
          renderState,
        };
      })
      .filter(status => status !== null && status.renderState !== 'none'); // Filter out nulls and 'none' state
  }, [signups, project, now]);


  // --- Render Logic ---

  if (!signupStatuses || signupStatuses.length === 0) {
    // Optional: Show a message if no relevant signups found
    // return <Alert variant="default" className="mb-6"><Info className="h-4 w-4" /><AlertDescription>No current or upcoming approved/attended sessions found.</AlertDescription></Alert>;
    return null; // Render nothing if no relevant signups
  }

  return (
    <div className="space-y-4 mb-6">
      {signupStatuses.map((status) => {
        if (!status) return null; // Should not happen due to filter, but good practice

        // Determine the display name for the session
        let sessionDisplayName;
        // If multiRole event with named roles, keep using the role name
        if ('name' in status.slotDetails && status.slotDetails.name) {
            sessionDisplayName = status.slotDetails.name;
        }
        // For oneTime events, show "Main Event"
        else if (project.schedule?.oneTime) {
            sessionDisplayName = "Main Event";
        }
        // For multiDay events, format the date nicely
        else if (project.schedule?.multiDay && status.sessionStartTime) {
            // Format the date from the session start time
            sessionDisplayName = format(status.sessionStartTime, "MMMM d, yyyy");
        }
        // Default fallback
        else {
            sessionDisplayName = status.signup.schedule_id;
        }

        switch (status.renderState) {
          // 1. Checked-in State (Triggered by signup.status === 'attended')
          case 'checkedIn':
            // Use checkInTime if available, otherwise indicate attendance without specific time
            const checkInDisplayTime = status.checkInTime ? format(status.checkInTime, "h:mm a") : "Confirmed";
            return (
              <Card key={status.signup.id} className="mb-6 border-primary/30 bg-primary/5">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-6 w-6 text-primary flex-shrink-0" />
                    <div>
                      <CardTitle className="text-lg">Attendance Confirmed</CardTitle> {/* Updated Title */}
                      <CardDescription>Your attendance for {project.title} is confirmed.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-muted-foreground">Session:</span>
                    <>{sessionDisplayName}</>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-muted-foreground">Status:</span>
                    {/* Display check-in time if available */}
                    <span>{checkInDisplayTime === "Confirmed" ? "Attended" : `Checked in at ${checkInDisplayTime}`}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-muted-foreground">Session Time:</span>
                    <span>
                      {formatTimeTo12Hour(status.slotDetails.startTime)} - {formatTimeTo12Hour(status.slotDetails.endTime)}
                    </span>
                  </div>
                  {/* Progress Bar - Conditionally render based on remaining time */}
                  {status.remainingTimeFormatted !== "Session ended" && (
                     <div className="space-y-1 pt-2">
                       <div className="flex justify-between items-center mb-1">
                         <span className="font-medium text-muted-foreground">Session Progress:</span>
                         <span className="text-muted-foreground">{status.remainingTimeFormatted} remaining</span>
                       </div>
                       <Progress value={status.progressPercentage} aria-label={`Session progress: ${Math.round(status.progressPercentage)}%`} />
                     </div>
                  )}
                   {/* Show message when session ended */}
                   {status.remainingTimeFormatted === "Session ended" && (
                       <p className="text-xs text-muted-foreground text-center pt-2">Session has concluded.</p>
                   )}
                </CardContent>
              </Card>
            );

          // 2. Check-in Available State (Triggered by approved status + time window)
          case 'checkInOpen':
            // Remove the checkInUrl constant, it's no longer directly used by the button
            // const checkInUrl = `/attend/${project.id}?scheduleId=${status.signup.schedule_id}`;
            return (
              <Alert key={status.signup.id} variant="default" className="mb-6 border-primary/40 bg-primary/5">
                <div className="flex items-center gap-2">
                        <Hourglass className="h-5 w-5 text-primary flex-shrink-0" />
                        <CardTitle className="font-semibold text-lg">Check-in is open!</CardTitle>
                    </div>
                <AlertDescription className="text-muted-foreground mt-2">
                  <>
                    Check-in for your session <span className="font-medium"><>{sessionDisplayName}</></span> starting at <span className="font-medium">{formatTimeTo12Hour(status.slotDetails.startTime)}</span> is now available. Scan the QR code provided by the organizer to check in.
                    <div className="mt-3 flex gap-2">
                      {/* Modified Button: Removed asChild and Link, added onClick */}
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Open camera to scan QR code for session ${sessionDisplayName}`}
                        onClick={() => {
                          setSelectedScheduleForScan(status.signup.schedule_id); // Store which schedule we're scanning for
                          setIsCameraModalOpen(true); // Open the modal
                        }}
                      >
                        <Camera className="h-4 w-4 mr-1.5" />
                        Scan QR Code {/* Updated Button Text */}
                      </Button>
                    </div>
                  </>
                </AlertDescription>
              </Alert>
            );

          // 3. Reminder State (Triggered by approved status + time window)
          case 'reminder':
            return (
              <Card key={status.signup.id} className="mb-6 border-chart-3/30 bg-chart-3/5">
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
                    <>{sessionDisplayName}</>
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
                    <p className="text-xs text-muted-foreground text-center">
                      Check-in will be available 2 hours before start time.
                    </p>
                  </div>
                </CardContent>
              </Card>
            );

          default:
            return null;
        }
      })}

      {/* Replace placeholder Dialog with the actual QRCodeScannerModal */}
      <QRCodeScannerModal
        isOpen={isCameraModalOpen}
        onClose={() => {
            setIsCameraModalOpen(false);
            setSelectedScheduleForScan(null); // Clear selected schedule on close
        }}
        projectId={project.id}
        expectedScheduleId={selectedScheduleForScan}
      />
    </div>
  );
}
