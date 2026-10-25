"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Mail,
  RefreshCw,
  Trash2,
} from "lucide-react";

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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deleteInvitations,
  getOrganizationInvitations,
  cancelInvitation,
  resendInvitation,
} from "@/app/organization/[id]/admin/actions";
import type { OrganizationInvitationWithDetails } from "@/types/invitation";
import { type InvitationDuration } from "@/lib/organization/invitation-utils";

import PendingInvitationsTable from "./PendingInvitationsTable";

interface PendingInvitationsProps {
  organizationId: string;
  refreshKey?: number;
}

type StatusFilter = "pending" | "accepted" | "expired" | "cancelled" | "all";

const STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
] as const;

const PAGE_SIZE = 10;

export default function PendingInvitations({
  organizationId,
  refreshKey = 0,
}: PendingInvitationsProps) {
  const [invitations, setInvitations] = useState<
    OrganizationInvitationWithDetails[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalInvitations, setTotalInvitations] = useState(0);
  const [selectedInvitationIds, setSelectedInvitationIds] = useState<string[]>(
    [],
  );
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    invitationIds: string[];
    isBulk: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadInvitations = useCallback(
    async (targetPage: number) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await getOrganizationInvitations(
          organizationId,
          statusFilter,
          targetPage,
          PAGE_SIZE,
        );

        setInvitations(result.invitations);
        setPage(result.page);
        setTotalPages(result.totalPages);
        setTotalInvitations(result.total);
        setSelectedInvitationIds([]);
      } catch {
        setError("Failed to load invitations");
      } finally {
        setIsLoading(false);
      }
    },
    [organizationId, statusFilter],
  );

  useEffect(() => {
    void loadInvitations(page);
  }, [loadInvitations, page, refreshKey]);

  const handleFilterChange = (value: StatusFilter) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleCancel = async (invitationId: string) => {
    setActionPending(invitationId);
    setError(null);
    setSuccessMessage(null);

    const result = await cancelInvitation(invitationId);

    if (result.success) {
      setSuccessMessage("Invitation cancelled");
      await loadInvitations(page);
    } else {
      setError(result.error || "Failed to cancel invitation");
    }

    setActionPending(null);
  };

  const handleResend = async (
    invitationId: string,
    invitationDuration: InvitationDuration,
  ) => {
    setActionPending(invitationId);
    setError(null);
    setSuccessMessage(null);

    const result = await resendInvitation(invitationId, invitationDuration);

    if (result.success) {
      setSuccessMessage("Invitation email resent");
      await loadInvitations(page);
    } else {
      setError(result.error || "Failed to resend invitation");
    }

    setActionPending(null);
  };

  // Deleting is permanent, so it always goes through the confirm dialog.
  const requestDeleteInvitations = (
    invitationIds: string[],
    isBulk = false,
  ) => {
    if (invitationIds.length === 0) {
      return;
    }

    setPendingDelete({ invitationIds, isBulk });
  };

  const handleDeleteInvitations = async (
    invitationIds: string[],
    isBulk = false,
  ) => {
    if (invitationIds.length === 0) {
      return;
    }

    setPendingDelete(null);
    setError(null);
    setSuccessMessage(null);

    if (isBulk) {
      setIsBulkDeleting(true);
    } else {
      setActionPending(invitationIds[0]);
    }

    const result = await deleteInvitations({
      organizationId,
      invitationIds,
    });

    if (result.success) {
      setSuccessMessage(
        result.deleted && result.deleted > 1
          ? `${result.deleted} invitations deleted`
          : "Invitation deleted",
      );
      await loadInvitations(page);
    } else {
      setError(result.error || "Failed to delete invitation(s)");
    }

    if (isBulk) {
      setIsBulkDeleting(false);
    } else {
      setActionPending(null);
    }
  };

  // Clear messages after 5 seconds
  useEffect(() => {
    if (successMessage || error) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
        setError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage, error]);

  const selectedCount = selectedInvitationIds.length;
  const pagedSummary = useMemo(() => {
    if (totalInvitations === 0) {
      return "0 invitations";
    }

    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, totalInvitations);
    return `${from}-${to} of ${totalInvitations}`;
  }, [page, totalInvitations]);

  const filterLabel =
    STATUS_FILTER_OPTIONS.find((option) => option.value === statusFilter)
      ?.label ?? "All";
  const deleteCount = pendingDelete?.invitationIds.length ?? 0;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          items={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onValueChange={(v) => handleFilterChange(v as StatusFilter)}
        >
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue placeholder="Pending" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {STATUS_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="flex flex-wrap items-center gap-2">
          {selectedCount > 0 ? (
            <>
              <span className="text-muted-foreground text-sm">
                {selectedCount} selected
              </span>
              <Button
                variant="destructive-ghost"
                onClick={() =>
                  requestDeleteInvitations(selectedInvitationIds, true)
                }
                disabled={isBulkDeleting}
              >
                <Trash2 />
                {isBulkDeleting ? "Deleting..." : "Delete selected"}
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => void loadInvitations(page)}
            disabled={isLoading}
          >
            <RefreshCw className={isLoading ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="grid gap-2" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading invitations</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : invitations.length === 0 ? (
        <Empty className="border p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Mail />
            </EmptyMedia>
            <EmptyTitle>
              {statusFilter === "all"
                ? "No invitations yet"
                : `No ${filterLabel.toLowerCase()} invitations`}
            </EmptyTitle>
            <EmptyDescription>
              {statusFilter === "all"
                ? "Invitations you send with bulk import show up here."
                : "Try another status, or send invitations with bulk import."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <PendingInvitationsTable
          invitations={invitations}
          selectedIds={selectedInvitationIds}
          busyInvitationId={actionPending}
          onSelectedIdsChange={setSelectedInvitationIds}
          onResend={(id, duration) => void handleResend(id, duration)}
          onCancel={(id) => void handleCancel(id)}
          onDelete={(id) => requestDeleteInvitations([id])}
        />
      )}

      {totalInvitations > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm">
            Showing {pagedSummary}
          </p>
          {totalPages > 1 ? (
            <Pagination className="mx-0 w-auto justify-start sm:justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (page > 1 && !isLoading) {
                        setPage((previous) => Math.max(1, previous - 1));
                      }
                    }}
                    aria-disabled={page <= 1 || isLoading}
                    className={
                      page <= 1 || isLoading
                        ? "pointer-events-none opacity-50"
                        : ""
                    }
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="text-muted-foreground px-3 text-sm">
                    Page {page} of {totalPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (page < totalPages && !isLoading) {
                        setPage((previous) =>
                          Math.min(totalPages, previous + 1),
                        );
                      }
                    }}
                    aria-disabled={page >= totalPages || isLoading}
                    className={
                      page >= totalPages || isLoading
                        ? "pointer-events-none opacity-50"
                        : ""
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </div>
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteCount === 1
                ? "Delete this invitation?"
                : `Delete ${deleteCount} invitations?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              {deleteCount === 1 ? "the invitation" : "these invitations"} from
              the history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) {
                  void handleDeleteInvitations(
                    pendingDelete.invitationIds,
                    pendingDelete.isBulk,
                  );
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
