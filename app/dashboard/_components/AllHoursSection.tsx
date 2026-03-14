"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Calendar,
  Clock,
  Award,
  TicketCheck,
  FileCheck,
  AlertTriangle,
  CircleCheck,
  UserCheck,
  Trash2,
  Loader2
} from "lucide-react";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { TimezoneBadge } from "@/components/shared/TimezoneBadge";
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
function calculateDecimalHours(startTimeISO: string, endTimeISO: string): number {
  const start = new Date(startTimeISO);
  const end = new Date(endTimeISO);
  const diffMs = end.getTime() - start.getTime();
  return diffMs / (1000 * 60 * 60); // Convert milliseconds to hours
}

function formatTotalDuration(totalHours: number): string {
  const hours = Math.floor(totalHours);
  const minutes = Math.round((totalHours - hours) * 60);

  if (hours === 0 && minutes === 0) return "0m";
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function AllHoursSection({ certificates }: AllHoursSectionProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingTitle, setDeletingTitle] = useState<string | null>(null);

  // Separate platform and self-reported certificates (default to platform for backward compatibility)
  const verifiedCertificates = certificates.filter(cert => (cert.type || "platform") === "platform");
  const [selfReportedCertificates, setSelfReportedCertificates] = useState(
    certificates.filter(cert => cert.type === "self-reported")
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
      setSelfReportedCertificates(prev => prev.filter(cert => cert.id !== id));
      
      toast.success("Self-reported hours deleted", {
        description: `${deletingTitle} has been removed.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again";
      toast.error("Failed to delete hours", {
        description: message,
      });
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
      setDeletingTitle(null);
    }
  };

  const CertificateItem = ({ cert, isSelfReported = false }: { cert: Certificate; isSelfReported?: boolean }) => {
    const durationHours = calculateDecimalHours(cert.event_start, cert.event_end);
    const formattedDuration = formatTotalDuration(durationHours);

    return (
      <>
        <div className="border rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
          <div className="flex-1 space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              {isSelfReported ? (
                <Badge variant="secondary" className="text-xs bg-warning/10 text-warning dark:bg-warning/10 dark:text-warning">
                  Self-Reported
                </Badge>
              ) : (
                <Badge variant="default" className="text-xs">Platform</Badge>
              )}
              {!isSelfReported && cert.is_certified && (
                <Badge variant="default" className="text-xs bg-chart-2">
                  <Award className="h-3 w-3 mr-1" /> Official Org
                </Badge>
              )}
            </div>
            <div className="font-medium text-sm sm:text-base">{cert.project_title}</div>
            <p className="text-xs sm:text-sm text-muted-foreground truncate">
              {cert.organization_name || cert.creator_name || "Unknown Organizer"}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {format(parseISO(cert.event_start), "MMM d, yyyy")}
                </span>
                <TimezoneBadge timezone={cert.projects?.project_timezone || 'America/Los_Angeles'} />
              </div>
              {formattedDuration !== "0m" && (
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formattedDuration}</span>
              )}
            </div>
          </div>
          <div className="shrink-0 w-full sm:w-auto flex gap-2">
            <Link href={`/certificates/${cert.id}`} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1 sm:flex-initial")}>
              <TicketCheck className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">View</span>
              <span className="sm:hidden">Certificate</span>
            </Link>
            {isSelfReported && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setConfirmDeleteId(cert.id);
                  setDeletingTitle(cert.project_title);
                }}
                disabled={deletingId === cert.id}
              >
                {deletingId === cert.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        {confirmDeleteId === cert.id && isSelfReported && (
          <AlertDialog open={confirmDeleteId === cert.id} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Self-Reported Hours?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &quot;{cert.project_title}&quot; and its associated certificate. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleDeleteSelfReported(cert.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deletingId === cert.id}
                >
                  {deletingId === cert.id ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
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
    <div className="space-y-6">
      {/* Verified Hours Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CircleCheck className="h-5 w-5 text-primary shrink-0" />
            <CardTitle>Let&apos;s Assist Platform Hours</CardTitle>
            <Badge variant="secondary">{totalVerified}</Badge>
          </div>
          <CardDescription>Hours from Let&apos;s Assist platform projects and organizations</CardDescription>
        </CardHeader>
        <CardContent>
          {verifiedCertificates.length > 0 ? (
            verifiedCertificates.length <= 3 ? (
              <div className="space-y-3 sm:space-y-4">
                {verifiedCertificates.map((cert) => (
                  <CertificateItem key={cert.id} cert={cert} />
                ))}
              </div>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3 sm:space-y-4">
                  {verifiedCertificates.map((cert) => (
                    <CertificateItem key={cert.id} cert={cert} />
                  ))}
                </div>
              </ScrollArea>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-8 sm:py-10 text-center">
              <FileCheck className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground/30 mb-3" />
              <h3 className="font-medium text-sm sm:text-base">No Verified Hours Yet</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-xs">
                Complete Let&apos;s Assist volunteer opportunities to earn verified certificates.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Self-Reported Hours Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-warning dark:text-warning" />
            <CardTitle>Self-Reported Hours</CardTitle>
            <Badge variant="secondary">{totalSelfReported}</Badge>
          </div>
          <CardDescription>Volunteer hours you&apos;ve added from activities outside Let&apos;s Assist</CardDescription>
        </CardHeader>
        <CardContent>
          {selfReportedCertificates.length > 0 ? (
            selfReportedCertificates.length <= 3 ? (
              <div className="space-y-3 sm:space-y-4">
                {selfReportedCertificates.map((cert) => (
                  <CertificateItem key={cert.id} cert={cert} isSelfReported />
                ))}
              </div>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3 sm:space-y-4">
                  {selfReportedCertificates.map((cert) => (
                    <CertificateItem key={cert.id} cert={cert} isSelfReported />
                  ))}
                </div>
              </ScrollArea>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-8 sm:py-10 text-center">
              <AlertTriangle className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground/30 mb-3" />
              <h3 className="font-medium text-sm sm:text-base">No Self-Reported Hours Yet</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-xs">
                Add volunteer hours from activities outside Let&apos;s Assist.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
