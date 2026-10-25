"use client";
import { safeConsole } from "@/lib/safe-console";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { CircleX } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { Project } from "@/types";
import { useState, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CompassIcon } from "@/components/icons/animated";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { AnimatedLinkButton } from "@/components/projects/AnimatedLinkButton";
import { NoticePage } from "@/components/projects/NoticePage";
import {
  cancelSignup,
  getAnonymousWaiverSignatureMeta,
  getWaiverDownloadUrl,
} from "@/app/projects/[id]/actions";
import { linkAnonymousToAuthenticatedAccount } from "./actions";
import type { AnonymousProfileExperienceBehavior } from "@/types";
import { CancelSlotDialog } from "./_components/CancelSlotDialog";
import {
  LinkAccountSection,
  type LinkStatus,
} from "./_components/LinkAccountSection";
import { SlotRow } from "./_components/SlotRow";
import {
  getAutoDeletionDate,
  type SlotData,
} from "./_components/signup-schedule";

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
  anonymousPluginCards: ReactNode[];
  anonymousPluginBehavior: AnonymousProfileExperienceBehavior | null;
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
  anonymousPluginCards: _anonymousPluginCards,
  anonymousPluginBehavior: _anonymousPluginBehavior,
}: AnonymousSignupClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isConfirmed = !!confirmed_at;
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancellingSlotId, setCancellingSlotId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [removedSlots, setRemovedSlots] = useState<Set<string>>(new Set());
  const [, setIsLinking] = useState(false);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>(
    linkedUserId
      ? linkedAccountVerified
        ? "linked"
        : "verification-pending"
      : "unlinked",
  );
  const [verificationPendingEmail, setVerificationPendingEmail] = useState<
    string | null
  >(
    linkedUserId && !linkedAccountVerified
      ? (linkedAccountEmail ?? email)
      : null,
  );
  const [autoLinkAttempted, setAutoLinkAttempted] = useState(false);
  const [autoLinkError, setAutoLinkError] = useState<string | null>(null);
  const [waiverSignatures, setWaiverSignatures] = useState<
    Record<string, { signature_type: string; signed_at?: string | null } | null>
  >({});

  // Computed values
  const createdDate = new Date(created_at);
  const confirmedDate = confirmed_at ? new Date(confirmed_at) : null;
  const autoDeletionDate = getAutoDeletionDate(project);
  const activeSlots = slots.filter(
    (s) => !removedSlots.has(s.project_signup_id),
  );

  // Load waiver signatures for all slots
  useEffect(() => {
    if (!project.waiver_required) return;

    const loadWaivers = async () => {
      const results: Record<
        string,
        { signature_type: string; signed_at?: string | null } | null
      > = {};
      for (const slot of slots) {
        try {
          const result = await getAnonymousWaiverSignatureMeta(
            slot.project_signup_id,
            id,
            accessToken,
          );
          if ("error" in result) {
            results[slot.project_signup_id] = null;
          } else if (result.signatureId) {
            results[slot.project_signup_id] = {
              signature_type: result.signature_type || "upload",
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
      setVerificationPendingEmail(
        linkedAccountVerified ? null : (linkedAccountEmail ?? email),
      );
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
        const result = await linkAnonymousToAuthenticatedAccount(
          id,
          accessToken,
        );

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
        toast.success(
          "Account linked successfully! Your event signups have been transferred and are now pending approval from project coordinators.",
        );
        router.replace("/dashboard");
        router.refresh();
      } catch (error) {
        safeConsole.error("Error auto-linking account:", error);
        setAutoLinkError(
          "Failed to link account automatically. You can still finish linking below.",
        );
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

      const remainingSlots = activeSlots.filter(
        (s) => s.project_signup_id !== cancellingSlotId,
      );
      if (remainingSlots.length === 0) {
        toast.success("All signups cancelled successfully");
        setTimeout(() => router.push("/projects"), 2000);
      } else {
        toast.success("Slot signup cancelled successfully");
      }

      setRemovedSlots((prev) => new Set(prev).add(cancellingSlotId));
      setCancelDialogOpen(false);
    } catch (error) {
      safeConsole.error("Error cancelling signup:", error);
      toast.error("Failed to cancel signup. Please try again.");
    } finally {
      setIsCancelling(false);
      setCancellingSlotId(null);
    }
  };

  const handleViewWaiver = async (projectSignupId: string) => {
    try {
      const result = await getWaiverDownloadUrl(
        projectSignupId,
        id,
        accessToken,
      );

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
        toast.success(
          `Typed signature on file: ${result.signature.signature_text}`,
        );
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
      <NoticePage
        icon={<CircleX aria-hidden="true" />}
        title="All signups cancelled"
        description={
          <>
            All your signups for &quot;{project.title}&quot; have been
            cancelled.
          </>
        }
        actions={
          <AnimatedLinkButton href="/projects" icon={CompassIcon}>
            Browse projects
          </AnimatedLinkButton>
        }
      />
    );
  }

  const slotCount = activeSlots.length;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="Volunteer profile"
        description={
          <>
            Your anonymous signup profile for{" "}
            <Link
              href={`/projects/${project.id}`}
              className="text-foreground font-medium underline-offset-4 hover:underline"
            >
              {project.title}
            </Link>
          </>
        }
        meta={
          slotCount > 1 ? <span>{slotCount} slots registered</span> : undefined
        }
      />

      {/* Where the signup stands right now */}
      <div className="grid gap-3">
        {isProjectCancelled && (
          <Alert variant="destructive">
            <AlertTitle>Project has been cancelled</AlertTitle>
            <AlertDescription>
              This project is no longer active.
            </AlertDescription>
          </Alert>
        )}
        {!isConfirmed && (
          <Alert variant="warning">
            <AlertTitle>Email confirmation pending</AlertTitle>
            <AlertDescription>
              Please check your email and confirm your registration. All{" "}
              {slotCount} slot signup
              {slotCount > 1 ? "s" : ""} will be approved once confirmed.
            </AlertDescription>
          </Alert>
        )}
        {isConfirmed && !isProjectCancelled && (
          <Alert variant="success">
            <AlertTitle>You&apos;re registered!</AlertTitle>
            <AlertDescription>
              Your email has been confirmed and you&apos;re signed up for{" "}
              {slotCount} slot
              {slotCount > 1 ? "s" : ""}.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* The receipt: each slot and its status */}
      <section className="grid gap-3">
        <SectionHeader title={`Your slot${slotCount > 1 ? "s" : ""}`} />
        <Card className="py-0">
          <ul className="divide-y">
            {activeSlots.map((slot) => (
              <SlotRow
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
          </ul>
        </Card>
      </section>

      <section className="grid gap-3">
        <SectionHeader title="Your information" />
        <Card>
          <dl className="grid gap-4 px-4 text-sm sm:grid-cols-2">
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium wrap-break-word">{name}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium wrap-break-word">{email}</dd>
            </div>
            {phone_number && (
              <div className="grid gap-0.5">
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-medium tabular-nums">{phone_number}</dd>
              </div>
            )}
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">Profile created</dt>
              <dd className="font-medium">
                {format(createdDate, "MMMM d, yyyy 'at' h:mm a")}
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">
                Email {confirmedDate ? "confirmed" : "confirmation pending"}
              </dt>
              <dd className="font-medium">
                {confirmedDate
                  ? format(confirmedDate, "MMMM d, yyyy 'at' h:mm a")
                  : "Waiting for email confirmation"}
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      <LinkAccountSection
        id={id}
        accessToken={accessToken}
        name={name}
        email={email}
        linkStatus={linkStatus}
        isLinked={isLinked}
        autoLinkError={autoLinkError}
        verificationPendingEmail={verificationPendingEmail}
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

      {/* Auto-deletion notice */}
      {autoDeletionDate && (
        <Alert>
          <AlertTitle>Data retention</AlertTitle>
          <AlertDescription>
            This anonymous profile will be automatically deleted on{" "}
            <span className="text-foreground font-medium">
              {format(autoDeletionDate, "MMMM d, yyyy")}
            </span>
            . Your hours and certificate links will remain available. We
            recommend saving important details before this date.
          </AlertDescription>
        </Alert>
      )}

      <CancelSlotDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        isOnlySlot={slotCount === 1}
        isCancelling={isCancelling}
        onConfirm={handleCancelSlot}
      />
    </div>
  );
}
