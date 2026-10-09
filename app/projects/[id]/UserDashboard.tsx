"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState, useEffect, useMemo } from "react";
import { Project, Signup } from "@/types";
import { AuthUser } from "@/lib/supabase/types";
import {
  matchVolunteerCertificate,
  type VolunteerCertificate,
} from "@/lib/projects/volunteer-attendance-duration";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getProjectStartDateTime,
  getProjectEndDateTime,
} from "@/utils/project";
import { differenceInHours, isBefore, isAfter } from "date-fns";
import { CheckCircle, Clock, Download, Eye, Info } from "lucide-react";
import { QRCodeScannerModal } from "@/app/projects/_components/QRCodeScannerModal";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { downloadSignedWaiver } from "@/lib/waiver/download-signed-waiver";
import { getMyProjectFeedback, getMyWaiverSignatures } from "./actions";
import { ProjectFeedbackDialog } from "@/components/projects/ProjectFeedbackDialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { getSignupStatuses } from "./user-dashboard-status";
import {
  UserSignupStatusCard,
  signupStatusHasCard,
} from "./UserSignupStatusCard";

interface Props {
  project: Project;
  user: AuthUser;
  signups: Signup[]; // Array of user's approved signups for this project
}

export default function UserDashboard({
  project,
  user: _user,
  signups,
}: Props) {
  const [now, setNow] = useState(new Date());
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [selectedScheduleForScan, setSelectedScheduleForScan] = useState<
    string | null
  >(null);
  const [isMounted, setIsMounted] = useState(false);

  // Certificate snapshots are keyed by their exact signup.
  const [certMap, setCertMap] = useState<Record<string, VolunteerCertificate>>(
    {},
  );
  const [certificateReadComplete, setCertificateReadComplete] = useState(false);
  const [waiverSignatures, setWaiverSignatures] = useState<
    Array<{ id: string; signed_at: string | null; created_at: string }>
  >([]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch waivers (server-authorized; resilient to RLS)
  useEffect(() => {
    const fetchWaivers = async () => {
      const result = await getMyWaiverSignatures(project.id);
      if ("error" in result) {
        // Fail soft: leave list empty
        safeConsole.error(
          "Application diagnostic from app/projects/[id]/UserDashboard",
          result.error,
        );
        return;
      }
      setWaiverSignatures(result.signatures);
    };
    void fetchWaivers();
  }, [project.id]);

  const downloadWaiver = async (signatureId: string) => {
    try {
      // The route names the file, so a photo upload keeps its real extension.
      await downloadSignedWaiver(signatureId);
      toast.success("Waiver downloaded successfully!");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to download waiver. Please try again.",
      );
    }
  };

  const viewWaiver = (signatureId: string) => {
    window.open(
      `/api/waivers/${signatureId}/preview`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  // Update 'now' state every minute for countdowns
  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(new Date());
    }, 60000); // Update every 60 seconds
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let current = true;
    setCertMap({});
    setCertificateReadComplete(false);
    const supabase = createClient();
    supabase
      .from("certificates")
      .select(
        "id, signup_id, project_id, schedule_id, type, credited_minutes, event_start, event_end",
      )
      .eq("project_id", project.id)
      .or("type.eq.verified,type.is.null")
      .order("created_at", { ascending: false })
      .in(
        "signup_id",
        signups.map((s) => s.id),
      )
      .then(({ data, error }) => {
        if (!current) return;
        setCertificateReadComplete(true);
        if (error) {
          safeConsole.error("Could not load volunteer certificates.");
        } else {
          const map: Record<string, VolunteerCertificate> = {};
          for (const cert of (data ?? []) as VolunteerCertificate[]) {
            const signup = signups.find((item) => item.id === cert.signup_id);
            if (
              signup &&
              !map[signup.id] &&
              matchVolunteerCertificate(project, signup, cert)
            ) {
              map[signup.id] = cert;
            }
          }
          setCertMap(map);
        }
      });
    return () => {
      current = false;
    };
  }, [signups, project]);

  // --- ADDED: Calculate overall project phase for signup-only alerts ---
  const projectStartDateTime = useMemo(
    () => getProjectStartDateTime(project),
    [project],
  );
  const projectEndDateTime = useMemo(
    () => getProjectEndDateTime(project),
    [project],
  );
  const isSignupOnly = project.verification_method === "signup-only";
  const isProjectStartingSoon = useMemo(() => {
    const hoursUntilStart = differenceInHours(projectStartDateTime, now);
    return hoursUntilStart <= 24 && isBefore(now, projectStartDateTime);
  }, [projectStartDateTime, now]);
  const isProjectProgressing = useMemo(() => {
    return (
      isAfter(now, projectStartDateTime) && isBefore(now, projectEndDateTime)
    );
  }, [projectStartDateTime, projectEndDateTime, now]);
  const isProjectCompleted = useMemo(
    () => isAfter(now, projectEndDateTime),
    [projectEndDateTime, now],
  );
  // --- END ADDED ---

  // --- Private post-project feedback ---
  const attendedFeedbackSignupId = useMemo(
    () => signups.find((signup) => signup.status === "attended")?.id ?? null,
    [signups],
  );
  const [myFeedback, setMyFeedback] = useState<{
    rating: number;
    comment: string | null;
  } | null>(null);
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);
  useEffect(() => {
    if (!isProjectCompleted || !attendedFeedbackSignupId) return;
    let cancelled = false;
    getMyProjectFeedback(project.id)
      .then((result) => {
        if (cancelled) return;
        setMyFeedback(result.feedback);
        setFeedbackLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setFeedbackLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isProjectCompleted, attendedFeedbackSignupId, project.id]);
  // --- END feedback ---

  const signupStatuses = useMemo(
    () => getSignupStatuses(signups, project, now, certMap),
    [signups, project, now, certMap],
  );

  const hideReminder = isSignupOnly && isProjectStartingSoon;
  const visibleStatuses = signupStatuses.flatMap((status) =>
    status && signupStatusHasCard(status, project, hideReminder)
      ? [status]
      : [],
  );
  const openScanner = (scheduleId: string) => {
    setSelectedScheduleForScan(scheduleId);
    setIsCameraModalOpen(true);
  };

  // One notice about the whole event, shown only for sign-up only projects.
  const renderGeneralSignupOnlyAlert = () => {
    if (!isSignupOnly || project.status === "cancelled") return null;

    if (isProjectStartingSoon) {
      return (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Event starting soon!</AlertTitle>
          <AlertDescription>
            The signup-only event &quot;{project.title}&quot; is scheduled to
            start within 24 hours.
          </AlertDescription>
        </Alert>
      );
    }
    if (isProjectProgressing) {
      return (
        <Alert variant="warning">
          <Clock aria-hidden="true" />
          <AlertTitle>Event in progress</AlertTitle>
          <AlertDescription>
            The signup-only event &quot;{project.title}&quot; is currently in
            progress.
          </AlertDescription>
        </Alert>
      );
    }
    if (isProjectCompleted) {
      return (
        <Alert variant="success">
          <CheckCircle aria-hidden="true" />
          <AlertTitle>Event completed</AlertTitle>
          <AlertDescription>
            The signup-only event &quot;{project.title}&quot; has finished based
            on its schedule.
          </AlertDescription>
        </Alert>
      );
    }

    return null;
  };

  if (!isMounted) {
    return null;
  }

  /**
   * Private post-project feedback, deliberately independent of eventCards.
   * A signup can drop out of the carousel entirely (past the 48h hours
   * window, 'none' render state, missing slot details) while the volunteer
   * is still an attendee who should be able to rate the project — and the
   * follow-up email links them here 24-96h after the event, which is
   * exactly when the carousel tends to be empty.
   */
  const feedbackPrompt =
    isProjectCompleted && attendedFeedbackSignupId && feedbackLoaded ? (
      <ProjectFeedbackDialog
        projectId={project.id}
        signupId={attendedFeedbackSignupId}
        initial={myFeedback}
        onSubmitted={setMyFeedback}
      />
    ) : null;

  if (visibleStatuses.length === 0) {
    // Render general alerts and feedback even if no specific signup cards show
    if (!feedbackPrompt && !renderGeneralSignupOnlyAlert()) {
      return null;
    }
    return (
      <div className="mb-6 grid gap-4">
        {renderGeneralSignupOnlyAlert()}
        {feedbackPrompt}
      </div>
    );
  }

  const cards = visibleStatuses.map((status) => (
    <UserSignupStatusCard
      key={status.signup.id}
      status={status}
      project={project}
      certificate={certMap[status.signup.id]}
      certificateReadComplete={certificateReadComplete}
      hideReminder={hideReminder}
      onScan={openScanner}
    />
  ));

  return (
    <section className="mb-6 grid gap-4" aria-label="Your signup">
      {renderGeneralSignupOnlyAlert()}

      {feedbackPrompt}

      {cards.length === 1 ? (
        cards[0]
      ) : (
        <Carousel className="w-full" opts={{ align: "start", loop: false }}>
          <CarouselContent className="-ml-2 md:-ml-4">
            {cards.map((card) => (
              <CarouselItem key={card.key} className="pl-2 md:pl-4">
                {card}
              </CarouselItem>
            ))}
          </CarouselContent>
          {/* On phones, swipe instead of buttons that would cover the card. */}
          <CarouselPrevious className="-left-3 hidden md:flex" />
          <CarouselNext className="-right-3 hidden md:flex" />
        </Carousel>
      )}

      {project.verification_method === "qr-code" && (
        <QRCodeScannerModal
          isOpen={isCameraModalOpen}
          onClose={() => {
            setIsCameraModalOpen(false);
            setSelectedScheduleForScan(null);
          }}
          projectId={project.id}
          expectedScheduleId={selectedScheduleForScan}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>My signed waivers</CardTitle>
          <CardDescription>
            Download copies of waivers you&apos;ve signed
          </CardDescription>
        </CardHeader>
        <CardContent>
          {waiverSignatures.length > 0 ? (
            <ul className="divide-y">
              {waiverSignatures.map((sig) => (
                <li
                  key={sig.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="grid min-w-0 gap-0.5">
                    <p className="text-sm font-medium wrap-break-word">
                      {project.title}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Signed{" "}
                      {new Date(
                        sig.signed_at || sig.created_at,
                      ).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => viewWaiver(sig.id)}
                    >
                      <Eye data-icon="inline-start" aria-hidden="true" />
                      View
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => downloadWaiver(sig.id)}
                    >
                      <Download data-icon="inline-start" aria-hidden="true" />
                      Download
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              No signed waivers found.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
