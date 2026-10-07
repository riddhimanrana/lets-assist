"use client";
import { certificateHours } from "@/lib/projects/certificate-duration";

import { useState } from "react";
import { Award, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { CompassIcon } from "@/components/icons/animated";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { AnimatedLinkButton } from "@/components/projects/AnimatedLinkButton";
import {
  calculateDecimalHours,
  calculateHours,
  formatTotalDuration,
  isWithinDateFilter,
  type CertificatesListProps,
  type DateFilter,
  type SortKey,
} from "./_components/certificate-hours";
import { CertificateRow } from "./_components/CertificateRow";
import { CertificatesToolbar } from "./_components/CertificatesToolbar";
import { printCertificates } from "./_components/print-certificates";

export function CertificatesList({
  certificates,
  user,
}: CertificatesListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  // Date filter state: all, last 6 months, last year, or custom range
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingTitle, setDeletingTitle] = useState<string | null>(null);
  const [displayCertificates, setDisplayCertificates] = useState(certificates);

  // Handle delete of self-reported hours
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

      // Remove from display
      setDisplayCertificates((prev) => prev.filter((cert) => cert.id !== id));

      toast.success("Self-reported hours deleted", {
        description: `${deletingTitle || "Certificate"} has been removed.`,
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

  // Add hours property to certificates
  const certificatesWithHours = displayCertificates.map((cert) => ({
    ...cert,
    hours: certificateHours(cert, () =>
      calculateHours(cert.event_start, cert.event_end),
    ),
  }));

  // Apply search and date range filters
  const filteredCertificates = certificatesWithHours.filter((cert) => {
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      if (
        !cert.project_title.toLowerCase().includes(searchLower) &&
        !cert.organization_name?.toLowerCase().includes(searchLower) &&
        !cert.project_location?.toLowerCase().includes(searchLower)
      ) {
        return false;
      }
    }
    return isWithinDateFilter(cert.issued_at, dateFilter, startDate, endDate);
  });

  // Apply sorting
  const sortedCertificates = [...filteredCertificates].sort((a, b) => {
    let comparison = 0;

    if (sortBy === "date") {
      comparison =
        new Date(a.issued_at).getTime() - new Date(b.issued_at).getTime();
    } else if (sortBy === "hours") {
      comparison = a.hours - b.hours;
    } else if (sortBy === "name") {
      comparison = a.project_title.localeCompare(b.project_title);
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });

  // Toggle sort direction when clicking the same sort option
  const handleSortChange = (newSortBy: SortKey) => {
    if (newSortBy === sortBy) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(newSortBy);
      setSortDirection("desc"); // Default to descending for new sort option
    }
  };

  const header = (
    <PageHeader
      title="Certificates"
      description="View and manage your earned volunteer certificates below."
      actions={
        certificates.length > 0 ? (
          <Button
            variant="outline"
            onClick={() =>
              printCertificates({
                certificatesWithHours,
                filteredCertificates,
                dateFilter,
                startDate,
                endDate,
                user,
              })
            }
            aria-label="Print all certificates"
          >
            <Printer data-icon="inline-start" aria-hidden="true" />
            Print
          </Button>
        ) : undefined
      }
    />
  );

  if (certificates.length === 0) {
    return (
      <div className="grid gap-6">
        {header}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Award aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No certificates yet</EmptyTitle>
            <EmptyDescription>
              Your certificates will appear here once you&apos;ve completed
              volunteer events and organizers have finalized your hours.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <AnimatedLinkButton href="/home" icon={CompassIcon}>
              Find opportunities
            </AnimatedLinkButton>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const totalDecimalHours = filteredCertificates.reduce(
    (sum, cert) =>
      sum +
      certificateHours(cert, () =>
        calculateDecimalHours(cert.event_start, cert.event_end),
      ),
    0,
  );
  const hasSelfReported = sortedCertificates.some(
    (cert) => cert.type === "self-reported",
  );
  const isFiltered = searchTerm !== "" || dateFilter !== "all";
  const confirmingCertificate = confirmDeleteId
    ? displayCertificates.find((cert) => cert.id === confirmDeleteId)
    : undefined;

  return (
    <div className="grid gap-6">
      {header}

      <StatStrip
        items={[
          {
            label: "Total hours",
            value: formatTotalDuration(totalDecimalHours),
          },
          { label: "Certificates", value: filteredCertificates.length },
        ]}
      />

      <div className="grid gap-3">
        <CertificatesToolbar
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          dateFilter={dateFilter}
          onDateFilterChange={setDateFilter}
          startDate={startDate}
          onStartDateChange={setStartDate}
          endDate={endDate}
          onEndDateChange={setEndDate}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortChange={handleSortChange}
        />

        {sortedCertificates.length > 0 ? (
          <>
            <Card className="py-0">
              <ul className="divide-y">
                {sortedCertificates.map((cert) => (
                  <CertificateRow
                    key={cert.id}
                    cert={cert}
                    reserveActionSlot={hasSelfReported}
                    isDeleting={deletingId === cert.id}
                    onDelete={() => {
                      setConfirmDeleteId(cert.id);
                      setDeletingTitle(cert.project_title);
                    }}
                  />
                ))}
              </ul>
            </Card>
            <p className="text-muted-foreground text-sm">
              Certified means this certificate comes from a verified
              organization checked by the Let&apos;s Assist team.
            </p>
          </>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No certificates match your search.</EmptyTitle>
            </EmptyHeader>
            {isFiltered ? (
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchTerm("");
                    setDateFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </div>

      {/* Delete confirmation for self-reported hours */}
      <AlertDialog
        open={Boolean(confirmingCertificate)}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete self-reported hours?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;
              {confirmingCertificate?.project_title}&quot; and its associated
              certificate. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmingCertificate) {
                  void handleDeleteSelfReported(confirmingCertificate.id);
                }
              }}
              disabled={deletingId !== null}
            >
              {deletingId !== null ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
