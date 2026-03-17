"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, Clock, User, Mail, Phone, Calendar, Loader2, XCircle, AlertTriangle, Award, Medal, FileText } from "lucide-react";
import Link from "next/link";
import { format, addDays, parseISO, differenceInSeconds, differenceInHours, isAfter } from "date-fns";
import { formatTimeTo12Hour, cn } from "@/lib/utils";
import { TimezoneBadge } from "@/components/shared/TimezoneBadge";
import { Project } from "@/types";
import { getMultiDaySlotByScheduleId, getMultiDaySlotDisplayName } from "@/utils/project";
import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { cancelSignup, getAnonymousWaiverSignatureMeta, getWaiverDownloadUrl } from "@/app/projects/[id]/actions";
import { linkAnonymousToAuthenticatedAccount } from "./actions";
import { AnonymousLinkingDialog } from "./AnonymousLinkingDialog";

// Slot data from the server
interface SlotData {
  project_signup_id: string;
  status: string;
  schedule_id: string;
  check_in_time: string | null;
  check_out_time: string | null;
}

// Helper function to format schedule slot
const formatScheduleSlot = (project: Project, slotId: string) => {
  if (!project) return slotId;

  const buildTimeDisplay = (time: { date: string; startTime?: string; endTime?: string | null }, roleLabel?: string) => {
    const { date, startTime, endTime } = time;
    if (!date) return roleLabel ? roleLabel : "Schedule TBD";

    const parsedDate = parseISO(date);
    const dateLabel = format(parsedDate, "MMMM d, yyyy");

    if (startTime && endTime) {
      const startLabel = formatTimeTo12Hour(startTime);
      const endLabel = formatTimeTo12Hour(endTime);
      const range = `${startLabel} - ${endLabel}`;
      return roleLabel ? `${dateLabel} - ${roleLabel} (${range})` : `${dateLabel} from ${range}`;
    }

    if (startTime) {
      const startLabel = formatTimeTo12Hour(startTime);
      return roleLabel
        ? `${dateLabel} - ${roleLabel} (${startLabel})`
        : `${dateLabel} starting ${startLabel}`;
    }

    if (endTime) {
      const endLabel = formatTimeTo12Hour(endTime);
      return roleLabel
        ? `${dateLabel} - ${roleLabel} (${endLabel})`
        : `${dateLabel} ending ${endLabel}`;
    }

    return roleLabel ? `${dateLabel} - ${roleLabel}` : dateLabel;
  };

  if (project.event_type === "oneTime" && slotId === "oneTime" && project.schedule.oneTime) {
    return buildTimeDisplay(project.schedule.oneTime);
  }

  if (project.event_type === "multiDay") {
    const slotData = getMultiDaySlotByScheduleId(project, slotId);
    if (slotData) {
      const { day, slot, slotIndex } = slotData;
      return buildTimeDisplay(
        { date: day.date, startTime: slot.startTime, endTime: slot.endTime },
        getMultiDaySlotDisplayName(slot, slotIndex),
      );
    }
  }

  if (project.event_type === "sameDayMultiArea") {
    const role = project.schedule.sameDayMultiArea?.roles.find((r) => r.name === slotId);
    if (role) {
      const eventDate = project.schedule.sameDayMultiArea?.date;
      return buildTimeDisplay({ date: eventDate || new Date().toISOString().split("T")[0], startTime: role.startTime, endTime: role.endTime }, role.name);
    }
  }

  return slotId;
};

// Calculate project end date
const getProjectEndDate = (project: Project): Date | null => {
  try {
    if (project.event_type === "oneTime" && project.schedule.oneTime) {
      const dateStr = project.schedule.oneTime.date;
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day);
    } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
      const dates = project.schedule.multiDay.map(day => {
        const [year, month, dayNum] = day.date.split('-').map(Number);
        return new Date(year, month - 1, dayNum);
      });
      return dates.length > 0 ? new Date(Math.max(...dates.map(date => date.getTime()))) : null;
    } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
      const dateStr = project.schedule.sameDayMultiArea.date;
      if (dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
      }
    }
    return null;
  } catch {
    return null;
  }
};

const getAutoDeletionDate = (project: Project): Date | null => {
  const projectEndDate = getProjectEndDate(project);
  return projectEndDate ? addDays(projectEndDate, 30) : null;
};

// Get slot timing info
const getSlotTiming = (project: Project, scheduleId: string) => {
  let sessionDate = "";
  let endTime = "";

  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    sessionDate = project.schedule.oneTime.date;
    endTime = project.schedule.oneTime.endTime;
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    const lastDashIdx = scheduleId.lastIndexOf("-");
    const date = scheduleId.substring(0, lastDashIdx);
    const idx = scheduleId.substring(lastDashIdx + 1);
    const day = project.schedule.multiDay.find(d => d.date === date);
    const slotIndex = parseInt(idx, 10);
    const slot = day && !isNaN(slotIndex) ? day.slots[slotIndex] : undefined;
    if (day && slot) {
      sessionDate = day.date;
      endTime = slot.endTime;
    }
  } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    const role = project.schedule.sameDayMultiArea.roles.find(r => r.name === scheduleId);
    if (role) {
      sessionDate = project.schedule.sameDayMultiArea.date;
      endTime = role.endTime;
    }
  }

  return { sessionDate, endTime };
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'approved':
      return <Badge variant="default" className="capitalize">Approved</Badge>;
    case 'attended':
      return <Badge variant="default" className="capitalize bg-success text-success-foreground">Attended</Badge>;
    case 'pending':
      return <Badge variant="secondary" className="capitalize">Pending</Badge>;
    case 'rejected':
      return <Badge variant="destructive" className="capitalize">Rejected</Badge>;
    default:
      return <Badge variant="secondary" className="capitalize">{status}</Badge>;
  }
};

interface AnonymousSignupClientProps {
  id: string;
  accessToken: string;
  name: string;
  email: string;
  phone_number: string | null;
  confirmed_at: string | null;
  created_at: string;
  project: Project;
  isProjectCancelled: boolean;
  slots: SlotData[];
  linkedUserId: string | null;
  linkedAccountEmail: string | null;
  linkedAccountVerified: boolean;
  certificateIds: Record<string, string>;
}

export default function AnonymousSignupClient({
  id,
  accessToken,
  name,
  email,
  phone_number,
  confirmed_at,
  created_at,
  project,
  isProjectCancelled,
  slots,
  linkedUserId,
  linkedAccountEmail,
  linkedAccountVerified,
  certificateIds,
}: AnonymousSignupClientProps) {
  type LinkStatus = "unlinked" | "linked" | "verification-pending";

  const router = useRouter();
  const searchParams = useSearchParams();
  const isConfirmed = !!confirmed_at;
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancellingSlotId, setCancellingSlotId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [removedSlots, setRemovedSlots] = useState<Set<string>>(new Set());
  const [, setIsLinking] = useState(false);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>(
    linkedUserId ? (linkedAccountVerified ? "linked" : "verification-pending") : "unlinked",
  );
  const [verificationPendingEmail, setVerificationPendingEmail] = useState<string | null>(
    linkedUserId && !linkedAccountVerified ? (linkedAccountEmail ?? email) : null,
  );
  const [autoLinkAttempted, setAutoLinkAttempted] = useState(false);
  const [autoLinkError, setAutoLinkError] = useState<string | null>(null);
  const [waiverSignatures, setWaiverSignatures] = useState<Record<string, { signature_type: string; signed_at?: string | null } | null>>({});

  // Computed values
  const createdDate = new Date(created_at);
  const confirmedDate = confirmed_at ? new Date(confirmed_at) : null;
  const autoDeletionDate = getAutoDeletionDate(project);
  const activeSlots = slots.filter(s => !removedSlots.has(s.project_signup_id));

  // Load waiver signatures for all slots
  useEffect(() => {
    if (!project.waiver_required) return;

    const loadWaivers = async () => {
      const results: Record<string, { signature_type: string; signed_at?: string | null } | null> = {};
      for (const slot of slots) {
        try {
          const result = await getAnonymousWaiverSignatureMeta(
            slot.project_signup_id,
            id,
            accessToken,
          );
          if ('error' in result) {
            results[slot.project_signup_id] = null;
          } else if (result.signatureId) {
            results[slot.project_signup_id] = {
              signature_type: result.signature_type || 'upload',
              signed_at: result.signed_at,
            };
          } else {
            results[slot.project_signup_id] = null;
          }
        } catch {
          results[slot.project_signup_id] = null;
        }
      }
      setWaiverSignatures(results);
    };
    void loadWaivers();
  }, [slots, id, accessToken, project.waiver_required]);

  useEffect(() => {
    if (linkedUserId) {
      setLinkStatus(linkedAccountVerified ? "linked" : "verification-pending");
      setVerificationPendingEmail(linkedAccountVerified ? null : (linkedAccountEmail ?? email));
    }
  }, [email, linkedAccountEmail, linkedAccountVerified, linkedUserId]);

  const shouldAutoLink = searchParams.get("link") === "1";
  const isLinked = linkStatus !== "unlinked";

  useEffect(() => {
    if (!shouldAutoLink || autoLinkAttempted || isLinked) {
      return;
    }

    let isMounted = true;
    setAutoLinkAttempted(true);

    const autoLink = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          return;
        }

        setIsLinking(true);
        const result = await linkAnonymousToAuthenticatedAccount(id, accessToken);

        if (result.error) {
          setAutoLinkError(result.error);
          toast.error(result.error);
          return;
        }

        if (!isMounted) {
          return;
        }

        setLinkStatus("linked");
        setAutoLinkError(null);
        toast.success("Account linked successfully! Your event signups have been transferred and are now pending approval from project coordinators.");
        router.replace("/dashboard");
        router.refresh();
      } catch (error) {
        console.error("Error auto-linking account:", error);
        setAutoLinkError("Failed to link account automatically. You can still finish linking below.");
        toast.error("Failed to link account. Please try again.");
      } finally {
        if (isMounted) {
          setIsLinking(false);
        }
      }
    };

    void autoLink();

    return () => {
      isMounted = false;
    };
  }, [shouldAutoLink, autoLinkAttempted, isLinked, id, accessToken, router]);

  const handleCancelSlot = async () => {
    if (!cancellingSlotId) return;

    try {
      setIsCancelling(true);
      const result = await cancelSignup(cancellingSlotId, id, accessToken);

      if (result.error) {
        toast.error(result.error);
        setCancelDialogOpen(false);
        return;
      }

      const remainingSlots = activeSlots.filter(s => s.project_signup_id !== cancellingSlotId);
      if (remainingSlots.length === 0) {
        toast.success("All signups cancelled successfully");
        setTimeout(() => router.push("/projects"), 2000);
      } else {
        toast.success("Slot signup cancelled successfully");
      }

      setRemovedSlots(prev => new Set(prev).add(cancellingSlotId));
      setCancelDialogOpen(false);
    } catch (error) {
      console.error("Error cancelling signup:", error);
      toast.error("Failed to cancel signup. Please try again.");
    } finally {
      setIsCancelling(false);
      setCancellingSlotId(null);
    }
  };

  const handleViewWaiver = async (projectSignupId: string) => {
    try {
      const result = await getWaiverDownloadUrl(projectSignupId, id, accessToken);

      if (result?.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
        return;
      }
      if (result?.signatureId) {
        const previewUrl = `/api/waivers/${result.signatureId}/preview?anonymousSignupId=${id}&token=${encodeURIComponent(accessToken)}`;
        window.open(previewUrl, "_blank", "noopener,noreferrer");
        return;
      }
      if (result?.signature?.signature_text) {
        toast.success(`Typed signature on file: ${result.signature.signature_text}`);
        return;
      }
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.error("Unable to load waiver at this time.");
    } catch {
      toast.error("Unable to load waiver at this time.");
    }
  };

  // All slots removed
  if (activeSlots.length === 0) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-4 rounded-full bg-destructive/10 p-3">
                <XCircle className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">All Signups Cancelled</h2>
              <p className="text-muted-foreground mb-6">
                All your signups for &quot;{project.title}&quot; have been cancelled.
              </p>
              <Link href="/projects" className={cn(buttonVariants())}>
                Browse Projects
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10 space-y-6">
      {/* Header Card */}
      <Card className="overflow-hidden">
        {isProjectCancelled && (
          <div className="bg-destructive/10 border-b border-destructive/30 p-3">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Project Has Been Cancelled</p>
                <p className="text-sm">This project is no longer active.</p>
              </div>
            </div>
          </div>
        )}

        <CardHeader className={isProjectCancelled ? "pt-4" : ""}>
          <CardTitle className="leading-tight">Volunteer Profile</CardTitle>
          <CardDescription>
            Your anonymous signup profile for{" "}
            <Link href={`/projects/${project.id}`} className="text-primary hover:underline font-medium">
              {project.title}
            </Link>
            {activeSlots.length > 1 && (
              <span className="ml-1 text-foreground">
                {" "}&mdash; {activeSlots.length} slots registered
              </span>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Status Banner */}
          {!isConfirmed && (
            <Card className="w-full border-warning/30 bg-warning/5 overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="bg-warning/10 p-2 rounded-full shrink-0">
                    <Clock className="h-5 w-5 text-warning" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Email Confirmation Pending</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Please check your email and confirm your registration. All {activeSlots.length} slot signup{activeSlots.length > 1 ? 's' : ''} will be approved once confirmed.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {isConfirmed && !isProjectCancelled && (
            <Card className="w-full border-success/30 bg-success/5 overflow-hidden">
              <CardContent className="">
                <div className="flex items-start gap-3">
                  <div className="bg-success/10 p-2 rounded-full shrink-0">
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">You&apos;re Registered!</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your email has been confirmed and you&apos;re signed up for {activeSlots.length} slot{activeSlots.length > 1 ? 's' : ''}.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Your Information */}
          <div className="space-y-3 text-sm">
            <h3 className="font-medium text-base mb-2">Your Information</h3>
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" /> Name: <span className="text-foreground font-medium">{name}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" /> Email: <span className="text-foreground font-medium">{email}</span>
            </div>
            {phone_number && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" /> Phone: <span className="text-foreground font-medium">{phone_number}</span>
              </div>
            )}
          </div>

          <Separator />

          {/* Timeline */}
          <div>
            <h3 className="text-base font-semibold mb-3">Timeline</h3>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                    <span className="text-xs font-medium text-primary-foreground">1</span>
                  </div>
                  <div className="w-0.5 h-full bg-border mt-1"></div>
                </div>
                <div>
                  <p className="font-medium">Profile Created</p>
                  <p className="text-muted-foreground text-xs">{format(createdDate, "MMMM d, yyyy 'at' h:mm a")}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-6 h-6 rounded-full ${confirmedDate ? 'bg-primary' : 'bg-muted'} flex items-center justify-center`}>
                    {confirmedDate ? <CheckCircle2 className="h-3.5 w-3.5 text-popover" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                </div>
                <div>
                  <p className="font-medium">Email {confirmedDate ? 'Confirmed' : 'Confirmation Pending'}</p>
                  {confirmedDate ? (
                    <p className="text-muted-foreground text-xs">{format(confirmedDate, "MMMM d, yyyy 'at' h:mm a")}</p>
                  ) : (
                    <p className="text-muted-foreground text-xs">Waiting for email confirmation</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Slot Cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Your Slot{activeSlots.length > 1 ? 's' : ''}</h3>

        {activeSlots.map((slot) => (
          <SlotCard
            key={slot.project_signup_id}
            slot={slot}
            project={project}
            isProjectCancelled={isProjectCancelled}
            isConfirmed={isConfirmed}
            waiverSignature={waiverSignatures[slot.project_signup_id]}
            certificateId={certificateIds[slot.project_signup_id]}
            onCancel={() => {
              setCancellingSlotId(slot.project_signup_id);
              setCancelDialogOpen(true);
            }}
            onViewWaiver={() => handleViewWaiver(slot.project_signup_id)}
          />
        ))}
      </div>

      {/* Auto-Deletion Notice */}
      {autoDeletionDate && (
        <Alert className="bg-muted/50 border-muted">
          <Clock className="h-4 w-4" />
          <AlertTitle className="font-medium">Data Retention</AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            This anonymous profile will be automatically deleted on <span className="font-semibold">{format(autoDeletionDate, "MMMM d, yyyy")}</span>. Your hours and certificate links will remain available. We recommend saving important details before this date.
          </AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <Card>
        <CardContent className="space-y-4">
          <h3 className="font-medium text-base">Manage Your Profile</h3>

          <Separator />

          <div className="space-y-3">
            <div className="bg-info/20 border border-info/50 rounded-lg p-3">
              <p className="text-sm text-info">
                <span className="font-semibold">About linking:</span> When you link this anonymous profile to a Let&apos;s Assist account, all your event signups will be transferred to your account. Your signups are currently <span className="font-semibold">pending approval</span> from the project coordinator. Once approved, you can check in during events and track your volunteer hours—all in one place.
              </p>
            </div>

            {autoLinkError && !isLinked && (
              <Alert className="border-warning/30 bg-warning/5">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Linking needs one more step</AlertTitle>
                <AlertDescription>{autoLinkError}</AlertDescription>
              </Alert>
            )}

            {linkStatus === "linked" ? (
              <div className="flex items-center gap-2 text-sm text-success bg-success/5 p-3 rounded-lg">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="font-medium">Account linked successfully! Your signups have been transferred.</span>
              </div>
            ) : linkStatus === "verification-pending" ? (
              <Alert className="border-primary/30 bg-primary/5">
                <Mail className="h-4 w-4" />
                <AlertTitle>Verify your new account</AlertTitle>
                <AlertDescription className="space-y-1 text-sm">
                  <p>
                    Your volunteer profile is linked. We sent a verification email to <span className="font-medium text-foreground">{verificationPendingEmail ?? email}</span>.
                  </p>
                  <p>
                    After verifying, sign in to access your volunteer dashboard, approvals, hours, and certificates.
                  </p>
                  <div className="pt-2">
                    <Link href={`/signup/success?email=${encodeURIComponent(verificationPendingEmail ?? email)}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      Manage verification email
                    </Link>
                  </div>
                </AlertDescription>
              </Alert>
            ) : (
              <AnonymousLinkingDialog
                anonymousId={id}
                anonymousToken={accessToken}
                defaultName={name}
                defaultEmail={email}
                isLinked={isLinked}
                onLinked={() => {
                  setLinkStatus("linked");
                  setAutoLinkError(null);
                }}
                onLinkedPendingVerification={(pendingEmail) => {
                  setLinkStatus("verification-pending");
                  setVerificationPendingEmail(pendingEmail);
                  setAutoLinkError(null);
                }}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cancel Slot Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-106.25">
          <DialogHeader>
            <DialogTitle>Cancel Slot Signup</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this slot signup? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2 pb-4">
            <Alert variant="destructive" className="border-destructive/70 bg-destructive/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-destructive">Important</AlertTitle>
              <AlertDescription className="text-destructive">
                {activeSlots.length === 1
                  ? "This is your only slot signup. Cancelling it will also remove your anonymous profile."
                  : "This will cancel your signup for this specific slot. Your other slot signups will remain active."
                }
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={isCancelling}>
              Keep My Signup
            </Button>
            <Button variant="destructive" onClick={handleCancelSlot} disabled={isCancelling} className="flex items-center gap-2">
              {isCancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              {isCancelling ? 'Cancelling...' : 'Yes, Cancel Slot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

// Individual slot card component
function SlotCard({
  slot,
  project,
  isProjectCancelled,
  isConfirmed,
  waiverSignature,
  certificateId,
  onCancel,
  onViewWaiver,
}: {
  slot: SlotData;
  project: Project;
  isProjectCancelled: boolean;
  isConfirmed: boolean;
  waiverSignature: { signature_type: string; signed_at?: string | null } | null | undefined;
  certificateId?: string;
  onCancel: () => void;
  onViewWaiver: () => void;
}) {
  const [waiverLoading, setWaiverLoading] = useState(false);
  const { sessionDate, endTime } = getSlotTiming(project, slot.schedule_id);

  const areHoursPublished = useMemo(() => {
    return project.published && project.published[slot.schedule_id] === true;
  }, [project.published, slot.schedule_id]);

  const isProjectOver = useMemo(() => {
    if (!sessionDate || !endTime) return false;
    try {
      const endDt = parseISO(`${sessionDate}T${endTime}`);
      return !isNaN(endDt.getTime()) && isAfter(new Date(), endDt);
    } catch {
      return false;
    }
  }, [sessionDate, endTime]);

  const isInPostEventWindow = useMemo(() => {
    if (!endTime || !sessionDate) return false;
    try {
      const endDt = parseISO(`${sessionDate}T${endTime}`);
      if (isNaN(endDt.getTime())) return false;
      const hoursSinceEnd = differenceInHours(new Date(), endDt);
      return isAfter(new Date(), endDt) && hoursSinceEnd >= 0 && hoursSinceEnd < 48;
    } catch {
      return false;
    }
  }, [sessionDate, endTime]);

  const isMissedEvent = slot.status === 'approved' && !slot.check_in_time && isProjectOver && !areHoursPublished;

  // Progress calculation for attended slots
  let percent = 0;
  let checkInTimeFormatted = "";
  if (slot.status === 'attended' && slot.check_in_time) {
    try {
      const checkIn = new Date(slot.check_in_time);
      checkInTimeFormatted = format(checkIn, "h:mm a");
      const endDt = parseISO(`${sessionDate}T${endTime}`);
      if (!isNaN(endDt.getTime()) && !isNaN(checkIn.getTime())) {
        const totalSec = Math.max(1, differenceInSeconds(endDt, checkIn));
        const elapsedSec = Math.min(totalSec, differenceInSeconds(new Date(), checkIn));
        percent = Math.round((elapsedSec / totalSec) * 100);
      }
    } catch { /* ignore */ }
  }

  const canCancel = (isConfirmed || slot.status === 'pending') && slot.status !== 'rejected' && !isProjectCancelled && !isProjectOver;

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3">
        {/* Slot header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium truncate">{formatScheduleSlot(project, slot.schedule_id)}</span>
            {project.project_timezone && (
              <TimezoneBadge timezone={project.project_timezone} />
            )}
          </div>
          {getStatusBadge(slot.status)}
        </div>

        {/* Hours Published */}
        {areHoursPublished && (
          <div className="flex items-center gap-2 text-sm text-success">
            <Award className="h-4 w-4" />
            <span className="font-medium">Hours Published</span>
            {certificateId && (
              <Link
                href={`/certificates/${certificateId}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto h-7 text-xs")}
              >
                <Medal className="h-3.5 w-3.5 mr-1" />
                Certificate
              </Link>
            )}
          </div>
        )}

        {/* Processing indicator */}
        {slot.status === 'attended' && isInPostEventWindow && !areHoursPublished && (
          <div className="flex items-center gap-2 text-sm text-warning">
            <Clock className="h-4 w-4" />
            <span>Hours being processed ({48 - differenceInHours(new Date(), parseISO(`${sessionDate}T${endTime}`))} hours remaining)</span>
          </div>
        )}

        {/* Missed event */}
        {isMissedEvent && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>No attendance recorded. Contact the organizer if this is an error.</span>
          </div>
        )}

        {/* Check-in progress */}
        {slot.status === 'attended' && slot.check_in_time && !areHoursPublished && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Checked in at {checkInTimeFormatted}</span>
              <span>{percent}%</span>
            </div>
            <Progress value={percent} className="h-2" />
          </div>
        )}

        {/* Waiver info */}
        {project.waiver_required && waiverSignature && (
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>Waiver signed {waiverSignature.signed_at ? format(new Date(waiverSignature.signed_at), "MMM d, yyyy") : ""}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={async () => {
                setWaiverLoading(true);
                await onViewWaiver();
                setWaiverLoading(false);
              }}
              disabled={waiverLoading}
            >
              {waiverLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "View"}
            </Button>
          </div>
        )}

        {/* Cancel button */}
        {canCancel && (
          <div className="flex justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs"
              onClick={onCancel}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Cancel This Slot
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
