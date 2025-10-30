"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Project } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress"; // Import Progress component
import { format, parseISO, formatDistance, differenceInMinutes, parse } from "date-fns"; // Add differenceInMinutes, parse
import { formatTimeTo12Hour } from "@/lib/utils";
import { getSlotDetails } from "@/utils/project";
import { toast } from "sonner";
import {
  CheckCircle,
  Timer,
  LogIn,
  // UserPlus, // No longer needed
  Loader2,
  Calendar,
  Clock,
  Users,
  AlertTriangle,
  ExternalLink,
  // Mail, // No longer needed
  Search,
  User
} from "lucide-react";
import Link from "next/link";
// Import checkInAnonymous as well
import { checkInUser, lookupEmailStatus, checkInAnonymous } from "./actions";

interface AttendanceClientProps {
  project: Project;
  scheduleId: string;
  user: any; // Can be null if not logged in
  existingCheckIn: any; // Can be null if no signup or not checked in yet for the *logged-in user*
  scanInfo: {
    valid: boolean;
    isMobileDevice: boolean;
    scanId: string;
    timestamp: string;
  };
  projectAllowsAnonymous: boolean; // <-- new prop
}

// Define LookupResult type based on the server action's return structure
type LookupResult = {
  success: boolean;
  found: boolean; // Indicates if any signup (anon or registered) was found for the email
  isRegistered: boolean; // Indicates if the found signup is linked to a registered user account
  signupId?: string; // ID of the signup record (could be anon or registered)
  message: string;
  error?: string;
};

// Helper function to format remaining time
function formatRemainingTime(minutes: number): string {
  if (minutes <= 0) return "Session ended";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60); // Round minutes
  let result = "";
  if (hours > 0) {
    result += `${hours}h `;
  }
  // Ensure minutes are always shown, even if 0 when hours > 0
  if (remainingMinutes > 0 || hours === 0) {
      result += `${remainingMinutes}m`;
  }
  return result.trim(); // Trim potential trailing space if only hours exist (though unlikely with rounding)
}


export default function AttendanceClient({
  project,
  scheduleId,
  user,
  existingCheckIn,
  scanInfo,
  projectAllowsAnonymous,
}: AttendanceClientProps) {
  const router = useRouter();
  // Check-in state
  const [isSubmitting, setIsSubmitting] = useState(false); // For logged-in check-in or lookup-based check-in
  const [isCheckedIn, setIsCheckedIn] = useState(!!existingCheckIn?.check_in_time);
  const [checkInTime, setCheckInTime] = useState<Date | null>(
    existingCheckIn?.check_in_time ? new Date(existingCheckIn.check_in_time) : null
  );
  const [checkedInAnonymously, setCheckedInAnonymously] = useState(false);
  const [displayEmail, setDisplayEmail] = useState(user?.email || ""); // Email to show on success screen
  const [anonSignupId, setAnonSignupId] = useState<string>(""); // State for anonymous signup ID

  // Add state for progress and remaining time
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [remainingTimeFormatted, setRemainingTimeFormatted] = useState("");

  // Session details state
  const [sessionDetails, setSessionDetails] = useState<any>(null);

  // Anonymous Check-in state
  const [showAnonInputSection, setShowAnonInputSection] = useState(false);
  const [anonCheckinEmail, setAnonCheckinEmail] = useState("");
  const [isAnonSubmitting, setIsAnonSubmitting] = useState(false);

  // Email Lookup state
  const [lookupEmail, setLookupEmail] = useState(""); // Separate email state for lookup
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  // Get session details
  useEffect(() => {
    if (project && scheduleId) {
      const details = getSlotDetails(project, scheduleId);
      
      let formattedDetails = null;
      if (details) {
        // Format depending on event type
        if (project.event_type === "oneTime") {
          formattedDetails = {
            ...details,
            name: "Main Event",
            date: project.schedule.oneTime?.date || ""
          };
        } else if (project.event_type === "multiDay") {
          // Parse the multiDay scheduleId (format: date-slotIndex)
          const [date, slotIndexStr] = scheduleId.split("-");
          const slotIndex = parseInt(slotIndexStr, 10);
          
          const day = project.schedule.multiDay?.find(d => d.date === date);
          if (day) {
            const dayIndex = project.schedule.multiDay?.indexOf(day) || 0;
            formattedDetails = {
              ...details,
              name: `Day ${dayIndex + 1}, Slot ${slotIndex + 1}`,
              date: date
            };
          }
        } else if (project.event_type === "sameDayMultiArea") {
          formattedDetails = {
            ...details,
            name: scheduleId,
            date: project.schedule.sameDayMultiArea?.date || ""
          };
        }
      }
      
      setSessionDetails(formattedDetails);
    }
  }, [project, scheduleId]);

  // Update progress and remaining time every second if checked in
  useEffect(() => {
    // Ensure checkInTime is valid *before* proceeding
    if (!checkInTime || !sessionDetails?.date || !sessionDetails?.startTime || !sessionDetails?.endTime) {
        // Clear progress if necessary data is missing
        setProgressPercentage(0);
        setRemainingTimeFormatted("");
        // No need to clear elapsedTime anymore
        return;
    }

    const updateTimers = () => {
      const now = new Date();

      // Remove Elapsed Time Calculation
      // setElapsedTime(formatDistance(checkInTime, now, { includeSeconds: true }));

      // Calculate Session Progress (based on check-in time) and Remaining Time (based on session end)
      try {
        // Combine date and time strings and parse them
        const sessionEndDateTime = parse(`${sessionDetails.date} ${sessionDetails.endTime}`, 'yyyy-MM-dd HH:mm', new Date());

        // Check if sessionEndDateTime is valid
        if (isNaN(sessionEndDateTime.getTime())) {
            console.error("Invalid end date/time for progress calculation", sessionDetails);
            setProgressPercentage(0);
            setRemainingTimeFormatted("Error: Invalid time");
            return;
        }

        // Calculate remaining time until session end (for display text)
        const remainingMinutes = differenceInMinutes(sessionEndDateTime, now);
        setRemainingTimeFormatted(formatRemainingTime(remainingMinutes));

        // Calculate progress based on time since check-in relative to session end
        const totalDurationMinutes = differenceInMinutes(sessionEndDateTime, checkInTime);
        const elapsedSinceCheckInMinutes = differenceInMinutes(now, checkInTime);

        if (totalDurationMinutes <= 0) {
            // If session ended before or exactly when user checked in, or if check-in is after session end
            setProgressPercentage(now >= sessionEndDateTime ? 100 : 0);
        } else {
            // Calculate progress percentage from check-in time to session end time
            const progress = Math.max(0, Math.min(100, (elapsedSinceCheckInMinutes / totalDurationMinutes) * 100));
            setProgressPercentage(progress);
        }

      } catch (error) {
          console.error("Error calculating progress:", error);
          setProgressPercentage(0);
          setRemainingTimeFormatted("Error calculating");
      }
    };

    updateTimers(); // Initial call
    const intervalId = setInterval(updateTimers, 10000); // Update every 10 seconds

    return () => clearInterval(intervalId);
    // Depend on checkInTime and session end details
  }, [checkInTime, sessionDetails?.date, sessionDetails?.endTime]); // Removed startTime dependency as it's not needed for this calculation


  // Handle check-in for LOGGED-IN users or from LOOKUP results
  const handleCheckin = async (signupIdToCheckIn?: string, isAnonymous: boolean = false, emailForDisplay?: string) => {
    const targetSignupId = signupIdToCheckIn || existingCheckIn?.id;

    if (!targetSignupId || isSubmitting) {
      console.warn("Check-in prevented: No targetSignupId or already submitting.", { targetSignupId, isSubmitting });
      if (!targetSignupId) toast.error("Could not identify the signup record to check in.");
      return;
    }

    setIsSubmitting(true);
    setLookupResult(null); // Clear lookup result if check-in initiated from there

    try {
      const result = await checkInUser(targetSignupId, user?.id); // Pass user?.id

      if (result.success && result.checkInTime) {
        setIsCheckedIn(true);
        setCheckInTime(new Date(result.checkInTime));
        setCheckedInAnonymously(isAnonymous);
        // Set display email: use provided email (from lookup), or user's email, or fallback
        setDisplayEmail(emailForDisplay || user?.email || "Checked in");
        toast.success("Check-in successful!");
      } else {
        throw new Error(result.error || "Check-in failed.");
      }
    } catch (error: any) {
      console.error("Check-in error:", error);
      toast.error(`Failed to check in: ${error.message}`);
      // Reset state if check-in fails but component doesn't unmount
      setIsCheckedIn(false);
      setCheckInTime(null);
      setCheckedInAnonymously(false);
      setDisplayEmail("");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle check-in for ANONYMOUS users via dedicated button/input
  const handleAnonCheckin = async () => {
    if (!anonCheckinEmail || isAnonSubmitting) return;

    setIsAnonSubmitting(true);
    try {
      // Use the dedicated anonymous check-in action
      const result = await checkInAnonymous(project.id, scheduleId, anonCheckinEmail);
      if (result.success && result.checkInTime) {
        setIsCheckedIn(true);
        setCheckInTime(new Date(result.checkInTime));
        setCheckedInAnonymously(true); // Mark as anonymous
        setDisplayEmail(anonCheckinEmail); // Set display email to the one used
        setAnonSignupId(result.anonSignupId || ""); // Save anonymous signup ID
        toast.success("Successfully checked in!");
        setShowAnonInputSection(false); // Hide the input section on success
      } else {
        toast.error(result.error || "Anonymous check-in failed. Please ensure you are signed up and approved.");
      }
    } catch (err: any) {
      console.error("Anonymous check-in error:", err);
      toast.error(err.message || "Anonymous check-in encountered an error.");
    } finally {
      setIsAnonSubmitting(false);
    }
  };

  // Look up email status (uses lookupEmail state)
  const handleLookupEmail = async () => {
    if (!lookupEmail || isLookingUp) return; // Use lookupEmail state

    setIsLookingUp(true);
    setLookupResult(null);

    try {
      // Pass lookupEmail to the action
      const result = await lookupEmailStatus(project.id, scheduleId, lookupEmail);
      setLookupResult(result);

      // Display toasts based on the result
      if (!result.success) {
        toast.error(result.error || result.message || "Email lookup failed.");
      } else if (!result.found) {
         toast.info(result.message || "No signup found for this email for this specific session.");
      } else {
         // Signup found (either registered or anonymous)
         // Use different toast types based on the message content for better feedback
         if (result.message.includes("approved") || result.message.includes("Account found. Signup status")) {
             toast.success(result.message);
         } else if (result.message.includes("pending") || result.message.includes("different session")) {
             toast.warning(result.message);
         } else {
             toast.info(result.message); // Default info for other cases like "not signed up"
         }
      }

    } catch (error) {
      console.error("Client-side error during email lookup call:", error);
      toast.error("Failed to communicate with server for email lookup.");
      setLookupResult({ success: false, found: false, isRegistered: false, message: "An unexpected error occurred during lookup." });
    } finally {
      setIsLookingUp(false);
    }
  };

  // Redirect to auth pages
  const redirectToAuth = (type: 'login' | 'signup') => {
    // Use window.location.href to capture the full URL including query params
    const redirectUrl = window.location.href;
    router.push(`/${type}?redirect=${encodeURIComponent(redirectUrl)}`);
  };

  // BLOCK if user is logged in but has no signup record for THIS schedule
  if (user && !existingCheckIn) {
    return (
      <div className="container mx-auto py-12 px-4 md:px-6">
        <Card className="mx-auto max-w-md mb-12">
          <CardHeader>
            <CardTitle className="text-destructive">Signup Not Found</CardTitle> {/* Changed title */}
          </CardHeader>
          <CardContent>
            <p className="text-sm mb-4">
              You are logged in as <strong>{user.email}</strong>, but we couldn&apos;t find your signup record for this specific project session ({sessionDetails?.name || scheduleId}).
            </p>
            <p className="text-sm text-muted-foreground mb-4">
                Please ensure you signed up for the correct session.
            </p>
            <Button
              variant="outline"
              onClick={() => router.push(`/projects/${project.id}`)}
            >
              View Project Details
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show success screen if already checked in (either logged in or anonymous)
  if (isCheckedIn) {
    return (
      <div className="container mx-auto py-12 px-4 md:px-6">
        <div className="max-w-md mx-auto">
          <Card>
            <CardHeader className="pb-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <CheckCircle className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-xl text-center">Check-in Successful</CardTitle>
              {/* Modify description based on anonymous status */}
              <CardDescription className="text-center">
                {checkedInAnonymously
                  ? "Your attendance has been recorded anonymously."
                  : "You're checked in to the event."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-sm font-medium">Project</span>
                  <span className="text-sm">{project.title}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-sm font-medium">Session</span>
                  <span className="text-sm">{sessionDetails?.name || scheduleId}</span>
                </div>
                {sessionDetails?.date && (
                  <div className="flex justify-between items-center py-3 border-b">
                    <span className="text-sm font-medium">Date</span>
                    <span className="text-sm">
                      {format(parseISO(sessionDetails.date), "EEEE, MMMM d, yyyy")}
                    </span>
                  </div>
                )}
                {sessionDetails?.startTime && sessionDetails?.endTime && (
                  <div className="flex justify-between items-center py-3 border-b">
                    <span className="text-sm font-medium">Time</span>
                    <span className="text-sm">
                      {formatTimeTo12Hour(sessionDetails.startTime)} - {formatTimeTo12Hour(sessionDetails.endTime)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-sm font-medium">Check-in time</span>
                  <span className="text-sm">
                    {checkInTime ? format(checkInTime, "h:mm a") : "N/A"}
                  </span>
                </div>
                {/* Conditionally show email used for check-in */}
                {displayEmail && (
                   <div className="flex justify-between items-center py-3 border-b">
                     <span className="text-sm font-medium">Email</span>
                     <span className="text-sm">{displayEmail}</span>
                   </div>
                )}
                {/* REMOVED Duration since *check-in* section */}
                {/* <div className="flex justify-between items-center py-3 border-b"> ... </div> */}

                {/* Session Progress Section (Progress starts from check-in time) */}
                {sessionDetails?.endTime && checkInTime && ( // Only show if we have end time and check-in time
                    <div className="space-y-2 pt-3">
                        <div className="flex justify-between items-center text-sm mb-1">
                            {/* Changed label slightly */}
                            <span className="font-medium">Session Duration</span>
                            <span className="text-muted-foreground">{remainingTimeFormatted} remaining</span>
                        </div>
                        <Progress value={progressPercentage} aria-label={`Your progress: ${Math.round(progressPercentage)}%`} />
                    </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button className="w-full">
                <Link href={`/projects/${project.id}`} className="flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                View Project Details
                </Link>
              </Button>
              {checkedInAnonymously && (
                <Button variant="outline" className="w-full">
                  <Link href={`/anonymous/${anonSignupId}`} className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Your Anonymous Profile
                  </Link>
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  // Show main check-in / auth options card
  return (
    <div className="container mx-auto py-12 px-4 md:px-6">
      <div className="max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>{project.title}</CardTitle>
            <CardDescription>
              Confirm your attendance for the session: {sessionDetails?.name || scheduleId}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Session Details */}
            {sessionDetails && (
              <div className="bg-muted/50 p-4 rounded-lg space-y-3 mb-4"> {/* Added mb-4 */}
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {sessionDetails.date ? format(parseISO(sessionDetails.date), "EEEE, MMMM d, yyyy") : "N/A"}
                  </span>
                </div>
                {sessionDetails.startTime && sessionDetails.endTime && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {formatTimeTo12Hour(sessionDetails.startTime)} - {formatTimeTo12Hour(sessionDetails.endTime)}
                    </span>
                  </div>
                )}
                {sessionDetails.name && (
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{sessionDetails.name}</span>
                  </div>
                )}
              </div>
            )}

            {/* Warning if not mobile */}
            {!scanInfo.isMobileDevice && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 p-3 bg-amber-500/10 mb-4"> {/* Added mb-4 */}
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p>This page is intended for QR code scans on mobile devices. Functionality may be limited.</p> {/* Updated text */}
                </div>
              </div>
            )}

            {/* === Logged-in User Check-in UI === */}
            {user && existingCheckIn && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Welcome, {user?.name}</h3>
                <p className="text-sm text-muted-foreground">
                  You are signed up for this session. Click below to confirm your attendance.
                </p>
                <Button
                  onClick={() => handleCheckin(undefined, false)} // Logged-in user, not anonymous
                  disabled={isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Checking in...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Confirm Attendance
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* === Anonymous User / Not Logged In UI === */}
            {!user && (
              <>
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Confirm Your Attendance</h3>
                  {/* Description is less important now as buttons guide the user */}
                </div>

                <div className="grid gap-3">
                  {/* Sign In Button (Always shown if not logged in) */}
                  <Button onClick={() => redirectToAuth('login')} className="w-full">
                    <LogIn className="h-4 w-4 mr-2" />
                    Sign in with Let&apos;s Assist Account
                  </Button>

                  {/* Anonymous Check-in Button (Conditional) */}
                  {projectAllowsAnonymous && (
                    <Button
                      onClick={() => setShowAnonInputSection(true)}
                      variant="outline"
                      className="w-full"
                      disabled={showAnonInputSection} // Disable if input is already shown
                    >
                      <User className="h-4 w-4 mr-2" />
                      Attend Anonymously
                    </Button>
                  )}

                  {/* Anonymous Check-in Input Section (Conditional) */}
                  {projectAllowsAnonymous && showAnonInputSection && (
                    <div className="space-y-3 border p-4 rounded-md bg-muted/30">
                      <Label htmlFor="anon-email">Email address</Label>
                      <Input
                        id="anon-email"
                        type="email"
                        value={anonCheckinEmail} // Use anonCheckinEmail state
                        onChange={e => setAnonCheckinEmail(e.target.value)}
                        placeholder="Enter your signup email"
                        aria-label="Email address for anonymous check-in"
                      />
                      <Button
                        onClick={handleAnonCheckin}
                        disabled={isAnonSubmitting || !anonCheckinEmail}
                        className="w-full"
                      >
                        {isAnonSubmitting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Checking in...
                          </>
                        ) : (
                          'Check in Anonymously'
                        )}
                      </Button>
                    </div>
                  )}

                  {/* Divider */}
                  <div className="flex items-center my-2 text-sm text-muted-foreground">
                    <span className="flex-grow border-t"></span>
                    {/* Updated divider text */}
                    <span className="px-2">Not sure?</span>
                    <span className="flex-grow border-t"></span>
                  </div>

                  {/* Email Lookup Section */}
                  <div className="space-y-2">
                    <Label htmlFor="email-lookup">Check your signup status</Label>
                    <div className="flex gap-2">
                      <Input
                        id="email-lookup"
                        type="email"
                        placeholder="Enter your email"
                        value={lookupEmail} // Use lookupEmail state
                        onChange={(e) => setLookupEmail(e.target.value)}
                        aria-label="Email address for signup status lookup"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleLookupEmail} // Use handleLookupEmail
                        disabled={isLookingUp || !lookupEmail} // Use isLookingUp and lookupEmail
                        aria-label="Lookup email status"
                      >
                        {isLookingUp ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Display Lookup Result (Remains the same, potentially triggers handleCheckin) */}
                  {lookupResult && lookupResult.success && (
                    <div className={`p-3 rounded-md text-sm border ${
                      lookupResult.found
                        ? lookupResult.isRegistered
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : lookupResult.message.includes("approved")
                            ? "bg-green-600/10 border-green-600/30 text-green-600"
                            : lookupResult.message.includes("pending")
                              ? "bg-amber-500/10 border-amber-500/30 text-amber-500"
                              : "bg-muted border-muted-foreground/30"
                        : "bg-muted border-muted-foreground/30"
                    }`}>
                      <p className="mb-2 font-medium break-words">{lookupResult.message}</p>

                      {/* Prompt to log in if registered user found */}
                      {lookupResult.isRegistered && (
                        <Button
                          size="sm"
                          variant="link" // Use link style
                          onClick={() => redirectToAuth('login')}
                          className="mt-1 p-0 h-auto text-primary hover:text-primary/80"
                        >
                          Log in now to check in
                          <LogIn className="h-3 w-3 ml-1.5" />
                        </Button>
                      )}

                      {/* Anonymous Check-in Button from LOOKUP (if found, not registered, approved) */}
                      {!lookupResult.isRegistered && lookupResult.found && lookupResult.signupId && lookupResult.message.includes("approved") && (
                         <Button
                          size="sm"
                          // Call handleCheckin, passing signupId, true for anonymous, and the lookupEmail
                          onClick={() => handleCheckin(lookupResult.signupId, true, lookupEmail)}
                          disabled={isSubmitting} // Use isSubmitting here
                          className="mt-2 w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                        >
                          {isSubmitting ? ( // Check isSubmitting
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Checking in...
                            </>
                          ) : (
                            <>
                              <CheckCircle className="h-4 w-4 mr-2" />
                              {/* Use lookupEmail here */}
                              Check In Now (as {lookupEmail})
                            </>
                          )}
                        </Button>
                      )}

                       {/* Message for pending anonymous signup */}
                       {!lookupResult.isRegistered && lookupResult.found && lookupResult.message.includes("pending") && (
                          <p className="mt-2 text-xs">
                              Your signup requires organizer approval before you can check in.
                          </p>
                       )}
                    </div>
                  )}
                  {lookupResult && !lookupResult.success && (
                    <div className="p-3 rounded-md text-sm bg-destructive/10 border border-destructive/30 text-destructive">
                      <p>{lookupResult.error || lookupResult.message || "An error occurred during lookup."}</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
          <CardFooter className="flex justify-center border-t pt-4"> {/* Added border-t and pt-4 */}
            <Link href={`/projects/${project.id}`} className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1">
              <ExternalLink className="h-3 w-3" /> View project details
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
