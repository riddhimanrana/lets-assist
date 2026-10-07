"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Project } from "@/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { UserCheckIcon, useAnimatedIcon } from "@/components/icons/animated";
import { NoticePage } from "@/components/projects/NoticePage";
import {
  checkInUser,
  lookupEmailStatus,
  checkInAnonymous,
  checkOutUser,
} from "./actions";
import {
  parseAnonymousProfileLink,
  type AuthUser,
  type ExistingCheckIn,
  type LookupResult,
} from "./_components/attendance-session";
import { AttendanceShell } from "./_components/AttendanceShell";
import { CheckedInView } from "./_components/CheckedInView";
import { LeaveEventConfirmationDialog } from "./_components/LeaveEventConfirmationDialog";
import { SessionEndedCard } from "./_components/SessionEndedCard";
import { SignedOutCheckIn } from "./_components/SignedOutCheckIn";
import { useSessionProgress } from "./_components/use-session-progress";

interface AttendanceClientProps {
  project: Project;
  scheduleId: string;
  user: AuthUser | null; // Can be null if not logged in
  existingCheckIn: ExistingCheckIn | null; // Can be null if no signup or not checked in yet for the *logged-in user*
  scanInfo: {
    valid: boolean;
    isMobileDevice: boolean;
    scanId: string;
    timestamp: string;
  };
  projectAllowsAnonymous: boolean; // <-- new prop
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
  const [isCheckedIn, setIsCheckedIn] = useState(
    !!existingCheckIn?.check_in_time,
  );
  const [checkInTime, setCheckInTime] = useState<Date | null>(
    existingCheckIn?.check_in_time
      ? new Date(existingCheckIn.check_in_time)
      : null,
  );
  const [checkedInAnonymously, setCheckedInAnonymously] = useState(false);
  const [displayEmail, setDisplayEmail] = useState(user?.email || ""); // Email to show on success screen
  const [anonSignupId, setAnonSignupId] = useState<string>(""); // State for anonymous signup ID
  const [anonAccessToken, setAnonAccessToken] = useState<string>("");

  // Session ended state
  const [sessionHasEnded, setSessionHasEnded] = useState(false);
  const [existingSignupId, setExistingSignupId] = useState<string | null>(
    existingCheckIn?.id || null,
  );

  // Leave Event dialog state
  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // Refs for tracking elapsed time
  const elapsedTimeRef = useRef<number>(0);
  const { sessionDetails, progressPercentage, remainingTimeFormatted } =
    useSessionProgress({
      project,
      scheduleId,
      checkInTime,
      sessionHasEnded,
      setSessionHasEnded,
      elapsedTimeRef,
    });

  // The last failed check-in, kept on screen until the next attempt
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const confirmIcon = useAnimatedIcon();

  // Anonymous Check-in state
  const [showAnonInputSection, setShowAnonInputSection] = useState(false);
  const [anonCheckinEmail, setAnonCheckinEmail] = useState("");
  const [anonProfileLink, setAnonProfileLink] = useState("");
  const [isAnonSubmitting, setIsAnonSubmitting] = useState(false);

  // Email Lookup state
  const [lookupEmail, setLookupEmail] = useState(""); // Separate email state for lookup
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  // Handle check-in for LOGGED-IN users or from LOOKUP results
  const handleCheckin = async (
    signupIdToCheckIn?: string,
    isAnonymous: boolean = false,
    emailForDisplay?: string,
  ) => {
    const targetSignupId = signupIdToCheckIn || existingCheckIn?.id;

    if (!targetSignupId || isSubmitting) {
      safeConsole.warn(
        "Check-in prevented: No targetSignupId or already submitting.",
        { targetSignupId, isSubmitting },
      );
      if (!targetSignupId)
        setCheckInError("Could not identify the signup record to check in.");
      return;
    }

    setIsSubmitting(true);
    setLookupResult(null); // Clear lookup result if check-in initiated from there
    setCheckInError(null);

    try {
      const result = await checkInUser(targetSignupId);

      if (result.success && result.checkInTime) {
        setIsCheckedIn(true);
        setCheckInTime(new Date(result.checkInTime));
        setExistingSignupId(targetSignupId);
        setCheckedInAnonymously(isAnonymous);
        // Set display email: use provided email (from lookup), or user's email, or fallback
        setDisplayEmail(emailForDisplay || user?.email || "Checked in");
        toast.success("Check-in successful!");
      } else {
        throw new Error(result.error || "Check-in failed.");
      }
    } catch (error) {
      safeConsole.error("Check-in error:", error);
      const message =
        error instanceof Error ? error.message : "Check-in failed.";
      setCheckInError(`Failed to check in: ${message}`);
      // Reset state if check-in fails but component doesn't unmount
      setIsCheckedIn(false);
      setCheckInTime(null);
      setCheckedInAnonymously(false);
      setDisplayEmail("");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle leave event
  const handleLeaveEvent = async () => {
    if (!existingSignupId || isCheckingOut) return;

    setIsCheckingOut(true);
    setShowLeaveConfirmation(false);

    try {
      const result = await checkOutUser(
        existingSignupId,
        checkedInAnonymously ? project.id : undefined,
      );

      if (result.success) {
        setSessionHasEnded(true);
        toast.success("You've left the event. Great work!");
      } else {
        throw new Error(result.error || "Failed to leave event.");
      }
    } catch (error) {
      safeConsole.error("Leave event error:", error);
      const message =
        error instanceof Error ? error.message : "Failed to leave event.";
      toast.error(`Failed to leave event: ${message}`);
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Handle check-in for ANONYMOUS users via dedicated button/input
  const handleAnonCheckin = async () => {
    if (!anonCheckinEmail || !anonProfileLink || isAnonSubmitting) return;

    const anonymousAccess = parseAnonymousProfileLink(anonProfileLink);
    if (!anonymousAccess) {
      setCheckInError(
        "Paste the private anonymous profile link from your confirmation email.",
      );
      return;
    }

    setIsAnonSubmitting(true);
    setCheckInError(null);
    try {
      const result = await checkInAnonymous(project.id, scheduleId, {
        ...anonymousAccess,
        email: anonCheckinEmail,
      });
      if (result.success && result.checkInTime) {
        setIsCheckedIn(true);
        setCheckInTime(new Date(result.checkInTime));
        setExistingSignupId(result.signupId || null);
        setCheckedInAnonymously(true); // Mark as anonymous
        setDisplayEmail(anonCheckinEmail); // Set display email to the one used
        setAnonSignupId(result.anonSignupId || ""); // Save anonymous signup ID
        setAnonAccessToken(anonymousAccess.token);
        toast.success("Successfully checked in!");
        setShowAnonInputSection(false); // Hide the input section on success
      } else {
        setCheckInError(
          result.error ||
            "Anonymous check-in failed. Please ensure you are signed up and approved.",
        );
      }
    } catch (err) {
      safeConsole.error("Anonymous check-in error:", err);
      const message =
        err instanceof Error
          ? err.message
          : "Anonymous check-in encountered an error.";
      setCheckInError(message);
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
      const result = await lookupEmailStatus(
        project.id,
        scheduleId,
        lookupEmail,
      );
      setLookupResult(result);

      // Display toasts based on the result
      if (!result.success) {
        toast.error(result.error || result.message || "Email lookup failed.");
      } else if (!result.found) {
        toast.info(
          result.message ||
            "No signup found for this email for this specific session.",
        );
      } else {
        // Signup found (either registered or anonymous)
        // Use different toast types based on the message content for better feedback
        if (
          result.message.includes("approved") ||
          result.message.includes("Account found. Signup status")
        ) {
          toast.success(result.message);
        } else if (
          result.message.includes("pending") ||
          result.message.includes("different session")
        ) {
          toast.warning(result.message);
        } else {
          toast.info(result.message); // Default info for other cases like "not signed up"
        }
      }
    } catch (error) {
      safeConsole.error("Client-side error during email lookup call:", error);
      toast.error("Failed to communicate with server for email lookup.");
      setLookupResult({
        success: false,
        found: false,
        isRegistered: false,
        message: "An unexpected error occurred during lookup.",
      });
    } finally {
      setIsLookingUp(false);
    }
  };

  // Redirect to auth pages
  const redirectToAuth = (type: "login" | "signup") => {
    // Use window.location.href to capture the full URL including query params
    const redirectUrl = window.location.href;
    router.push(`/${type}?redirect=${encodeURIComponent(redirectUrl)}`);
  };

  const sessionName = sessionDetails?.name || scheduleId;

  // BLOCK if user is logged in but has no signup record for THIS schedule
  if (user && !existingCheckIn) {
    return (
      <NoticePage
        icon={<CircleAlert aria-hidden="true" />}
        tone="destructive"
        title="Signup not found"
        description={
          <>
            You are logged in as{" "}
            <strong className="text-foreground font-medium">
              {user.email}
            </strong>
            , but we couldn&apos;t find your signup record for this specific
            project session ({sessionName}).
          </>
        }
        actions={
          <Link
            href={`/projects/${project.id}`}
            className={buttonVariants({ variant: "outline" })}
          >
            View project details
          </Link>
        }
      >
        <p className="text-muted-foreground text-sm">
          Please ensure you signed up for the correct session.
        </p>
      </NoticePage>
    );
  }

  // Show session ended screen
  if (sessionHasEnded) {
    const hours = Math.floor(elapsedTimeRef.current / 3600000);
    const minutes = Math.floor((elapsedTimeRef.current % 3600000) / 60000);
    const elapsedDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    return (
      <SessionEndedCard
        projectId={project.id}
        projectTitle={project.title}
        sessionName={sessionName}
        elapsedTime={elapsedDisplay}
      />
    );
  }

  // Show the confirmation if already checked in (either logged in or anonymous)
  if (isCheckedIn) {
    return (
      <>
        <LeaveEventConfirmationDialog
          open={showLeaveConfirmation}
          onOpenChange={setShowLeaveConfirmation}
          onConfirm={handleLeaveEvent}
          isLoading={isCheckingOut}
        />
        <CheckedInView
          projectId={project.id}
          projectTitle={project.title}
          sessionName={sessionName}
          sessionDetails={sessionDetails}
          checkInTime={checkInTime}
          checkedInAnonymously={checkedInAnonymously}
          displayEmail={displayEmail}
          progressPercentage={progressPercentage}
          remainingTimeFormatted={remainingTimeFormatted}
          isCheckingOut={isCheckingOut}
          onLeave={() => setShowLeaveConfirmation(true)}
          anonymousProfileHref={
            checkedInAnonymously
              ? `/anonymous/${anonSignupId}?token=${encodeURIComponent(anonAccessToken)}`
              : null
          }
        />
      </>
    );
  }

  // Show the check-in step
  return (
    <AttendanceShell
      projectTitle={project.title}
      sessionName={sessionName}
      sessionDetails={sessionDetails}
    >
      {!scanInfo.isMobileDevice && (
        <Alert variant="warning">
          <AlertDescription>
            This page is intended for QR code scans on mobile devices.
            Functionality may be limited.
          </AlertDescription>
        </Alert>
      )}

      {checkInError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{checkInError}</AlertTitle>
          <AlertDescription>
            Try again, or ask the organizer to check you in.{" "}
            <Link href={`/projects/${project.id}`}>View project details</Link>
          </AlertDescription>
        </Alert>
      )}

      {/* === Logged-in user check-in === */}
      {user && existingCheckIn && (
        <div className="grid gap-4">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight wrap-break-word">
              Welcome,{" "}
              {user?.user_metadata?.full_name || user?.email || "Volunteer"}
            </h2>
            <p className="text-muted-foreground text-sm">
              You are signed up for this session. Click below to confirm your
              attendance.
            </p>
          </div>
          <Button
            size="lg"
            className="h-12 w-full text-base"
            onClick={() => handleCheckin(undefined, false)} // Logged-in user, not anonymous
            disabled={isSubmitting}
            {...confirmIcon.triggerProps}
          >
            {isSubmitting ? (
              <>
                <Spinner data-icon="inline-start" aria-hidden="true" />
                Checking in...
              </>
            ) : (
              <>
                <UserCheckIcon
                  ref={confirmIcon.ref}
                  size={16}
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                Confirm attendance
              </>
            )}
          </Button>
        </div>
      )}

      {/* === Not logged in: sign in, attend anonymously, or look up === */}
      {!user && (
        <SignedOutCheckIn
          projectAllowsAnonymous={projectAllowsAnonymous}
          onSignIn={() => redirectToAuth("login")}
          showAnonInputSection={showAnonInputSection}
          onShowAnonInputSection={() => setShowAnonInputSection(true)}
          anonCheckinEmail={anonCheckinEmail}
          onAnonCheckinEmailChange={setAnonCheckinEmail}
          anonProfileLink={anonProfileLink}
          onAnonProfileLinkChange={setAnonProfileLink}
          isAnonSubmitting={isAnonSubmitting}
          onAnonCheckin={handleAnonCheckin}
          lookupEmail={lookupEmail}
          onLookupEmailChange={setLookupEmail}
          isLookingUp={isLookingUp}
          onLookupEmail={handleLookupEmail}
          lookupResult={lookupResult}
        />
      )}

      <Link
        href={`/projects/${project.id}`}
        className={buttonVariants({
          variant: "link",
          className: "justify-self-start px-0",
        })}
      >
        View project details
      </Link>
    </AttendanceShell>
  );
}
