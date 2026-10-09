"use client";

import { certificateHours } from "@/lib/projects/certificate-duration";

import React, { useState } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Award,
  Calendar,
  Clock,
  FileCheck,
  Loader2,
  TicketCheck,
  Trash2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { TimezoneBadge } from "@/components/shared/TimezoneBadge";
import { formatHoursDuration } from "@/lib/format/hours";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Certificate {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  type?: "platform" | "self-reported"; // Optional for backward compatibility
  event_start: string;
  event_end: string;
  credited_minutes?: number | null;
  volunteer_email: string | null;
  organization_name: string | null;
  project_id: string | null;
  schedule_id: string | null;
  issued_at: string;
  signup_id: string | null;
  volunteer_name: string | null;
  project_location: string | null;
  projects?: {
    project_timezone?: string;
  };
}

interface AllHoursSectionProps {
  certificates: Certificate[];
}

// Client-side utility functions
function calculateDecimalHours(
  startTimeISO: string,
  endTimeISO: string,
): number {
  const start = new Date(startTimeISO);
  const end = new Date(endTimeISO);
  const diffMs = end.getTime() - start.getTime();
  return diffMs / (1000 * 60 * 60); // Convert milliseconds to hours
}

export function AllHoursSection({ certificates }: AllHoursSectionProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingTitle, setDeletingTitle] = useState<string | null>(null);

  // Separate platform and self-reported certificates (default to platform for backward compatibility)
  const verifiedCertificates = certificates.filter(
    (cert) => (cert.type || "platform") === "platform",
  );
  const [selfReportedCertificates, setSelfReportedCertificates] = useState(
    certificates.filter((cert) => cert.type === "self-reported"),
  );

  const totalVerified = verifiedCertificates.length;
  const totalSelfReported = selfReportedCertificates.length;

  const handleDeleteSelfReported = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/self-reported-hours/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete hours");
      }

      // Remove from local state
      setSelfReportedCertificates((prev) =>
        prev.filter((cert) => cert.id !== id),
      );

      toast.success("Self-reported hours deleted", {
        description: `${deletingTitle} has been removed.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Please try again";
      toast.error("Failed to delete hours", {
        description: message,
      });
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
      setDeletingTitle(null);
    }
  };

  const CertificateItem = ({
    cert,
    isSelfReported = false,
  }: {
    cert: Certificate;
    isSelfReported?: boolean;
  }) => {
    const durationHours = certificateHours(cert, () =>
      calculateDecimalHours(cert.event_start, cert.event_end),
    );
    const formattedDuration = formatHoursDuration(durationHours);

    return (
      <>
        <div className="flex flex-col items-start justify-between gap-3 py-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 font-medium">{cert.project_title}</span>
              <Badge variant={isSelfReported ? "outline" : "secondary"}>
                {isSelfReported ? "Self-reported" : "Platform"}
              </Badge>
              {!isSelfReported && cert.is_certified && (
                <Badge>
                  <Award aria-hidden="true" /> Official org
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground truncate text-sm">
              {cert.organization_name ||
                cert.creator_name ||
                "Unknown organizer"}
            </p>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1">
                  <Calendar className="size-3" aria-hidden="true" />
                  {format(parseISO(cert.event_start), "MMM d, yyyy")}
                </span>
                <TimezoneBadge
                  timezone={
                    cert.projects?.project_timezone || "America/Los_Angeles"
                  }
                  date={cert.event_start}
                />
              </div>
              {formattedDuration !== "0h" && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" aria-hidden="true" />{" "}
                  {formattedDuration}
                </span>
              )}
            </div>
          </div>
          <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            <Button
              asChild
              variant="outline"
              className="flex-1 sm:flex-initial"
            >
              <Link
                href={`/certificates/${cert.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <TicketCheck data-icon="inline-start" aria-hidden="true" />
                <span className="hidden sm:inline">View</span>
                <span className="sm:hidden">Certificate</span>
              </Link>
            </Button>
            {isSelfReported && (
              <Button
                variant="destructive-ghost"
                size="icon"
                aria-label={`Delete ${cert.project_title}`}
                onClick={() => {
                  setConfirmDeleteId(cert.id);
                  setDeletingTitle(cert.project_title);
                }}
                disabled={deletingId === cert.id}
              >
                {deletingId === cert.id ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 aria-hidden="true" />
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        {confirmDeleteId === cert.id && isSelfReported && (
          <AlertDialog
            open={confirmDeleteId === cert.id}
            onOpenChange={(open) => !open && setConfirmDeleteId(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete self-reported hours?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &quot;{cert.project_title}&quot;
                  and its associated certificate. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => handleDeleteSelfReported(cert.id)}
                  disabled={deletingId === cert.id}
                >
                  {deletingId === cert.id ? (
                    <>
                      <Loader2
                        data-icon="inline-start"
                        className="animate-spin"
                        aria-hidden="true"
                      />
                      Deleting...
                    </>
                  ) : (
                    "Delete"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Let&apos;s Assist platform hours</CardTitle>
          <CardDescription>
            Hours from Let&apos;s Assist platform projects and organizations
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{totalVerified}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {verifiedCertificates.length > 0 ? (
            verifiedCertificates.length <= 3 ? (
              <div className="divide-y *:first:pt-0 *:last:pb-0">
                {verifiedCertificates.map((cert) => (
                  <CertificateItem key={cert.id} cert={cert} />
                ))}
              </div>
            ) : (
              <ScrollArea className="h-96 pr-4">
                <div className="divide-y *:first:pt-0 *:last:pb-0">
                  {verifiedCertificates.map((cert) => (
                    <CertificateItem key={cert.id} cert={cert} />
                  ))}
                </div>
              </ScrollArea>
            )
          ) : (
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileCheck aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No verified hours yet</EmptyTitle>
                <EmptyDescription>
                  Complete Let&apos;s Assist volunteer opportunities to earn
                  verified certificates.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Self-reported hours</CardTitle>
          <CardDescription>
            Volunteer hours you&apos;ve added from activities outside Let&apos;s
            Assist
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{totalSelfReported}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {selfReportedCertificates.length > 0 ? (
            selfReportedCertificates.length <= 3 ? (
              <div className="divide-y *:first:pt-0 *:last:pb-0">
                {selfReportedCertificates.map((cert) => (
                  <CertificateItem key={cert.id} cert={cert} isSelfReported />
                ))}
              </div>
            ) : (
              <ScrollArea className="h-96 pr-4">
                <div className="divide-y *:first:pt-0 *:last:pb-0">
                  {selfReportedCertificates.map((cert) => (
                    <CertificateItem key={cert.id} cert={cert} isSelfReported />
                  ))}
                </div>
              </ScrollArea>
            )
          ) : (
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Clock aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No self-reported hours yet</EmptyTitle>
                <EmptyDescription>
                  Add volunteer hours from activities outside Let&apos;s Assist.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
