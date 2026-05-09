"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  MoreHorizontal,
  Send,
  XCircle,
  Loader2,
  RefreshCw,
  Mail,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from "lucide-react";
import {
  deleteInvitations,
  getOrganizationInvitations,
  cancelInvitation,
  resendInvitation,
} from "@/app/organization/[id]/admin/actions";
import type { OrganizationInvitationWithDetails } from "@/types/invitation";
import type { InvitationDuration } from "@/lib/organization/invitation-utils";

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
  const [invitations, setInvitations] = useState<OrganizationInvitationWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalInvitations, setTotalInvitations] = useState(0);
  const [selectedInvitationIds, setSelectedInvitationIds] = useState<string[]>([]);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadInvitations = useCallback(async (targetPage: number) => {
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
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void loadInvitations(page);
  }, [loadInvitations, page, refreshKey]);

  const getEffectiveStatus = (invitation: OrganizationInvitationWithDetails) => {
    const expired = new Date(invitation.expires_at) < new Date();

    if (invitation.status === "pending" && expired) {
      return "expired";
    }

    return invitation.status;
  };

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

  const handleDeleteInvitations = async (invitationIds: string[], isBulk = false) => {
    if (invitationIds.length === 0) {
      return;
    }

    const confirmMessage =
      invitationIds.length === 1
        ? "Delete this invitation permanently?"
        : `Delete ${invitationIds.length} invitations permanently?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getStatusBadge = (invitation: OrganizationInvitationWithDetails) => {
    const effectiveStatus = getEffectiveStatus(invitation);

    if (effectiveStatus === "accepted") {
      return (
        <Badge variant="default" className="bg-green-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Accepted
        </Badge>
      );
    }

    if (effectiveStatus === "cancelled") {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <XCircle className="h-3 w-3 mr-1" />
          Cancelled
        </Badge>
      );
    }

    if (effectiveStatus === "expired") {
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-300">
          <Clock className="h-3 w-3 mr-1" />
          Expired
        </Badge>
      );
    }

    return (
      <Badge variant="secondary">
        <Mail className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  };

  const getDeliveryBadge = (invitation: OrganizationInvitationWithDetails) => {
    const deliveryStatus = invitation.email_delivery_status || "pending";

    if (deliveryStatus === "sent") {
      return <Badge variant="default" className="bg-green-600">Sent</Badge>;
    }

    if (deliveryStatus === "failed") {
      return <Badge variant="destructive">Failed</Badge>;
    }

    if (deliveryStatus === "skipped") {
      return <Badge variant="outline">Skipped</Badge>;
    }

    return <Badge variant="secondary">Pending</Badge>;
  };

  const getRoleBadge = (role: string) => {
    return (
      <Badge variant={role === "staff" ? "default" : "outline"} className="capitalize">
        {role}
      </Badge>
    );
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
  const allCurrentPageSelected =
    invitations.length > 0 &&
    invitations.every((invitation) => selectedInvitationIds.includes(invitation.id));

  const pagedSummary = useMemo(() => {
    if (totalInvitations === 0) {
      return "0 invitations";
    }

    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, totalInvitations);
    return `${from}-${to} of ${totalInvitations}`;
  }, [page, totalInvitations]);

  return (
    <div className="space-y-4">
      {/* Filters and Actions */}
      <div className="flex items-center justify-between">
        <Select
          items={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onValueChange={(v) => handleFilterChange(v as StatusFilter)}
        >
          <SelectTrigger className="w-37.5">
            <SelectValue placeholder="Pending" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadInvitations(page)}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-sm text-muted-foreground">
            {selectedCount} selected on this page
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleDeleteInvitations(selectedInvitationIds, true)}
            disabled={isBulkDeleting}
          >
            {isBulkDeleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete selected
          </Button>
        </div>
      )}

      {/* Messages */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert className="bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            {successMessage}
          </AlertDescription>
        </Alert>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : invitations.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No {statusFilter !== "all" ? statusFilter : ""} invitations found.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allCurrentPageSelected}
                    onCheckedChange={(checked) => {
                      if (checked === true) {
                        setSelectedInvitationIds(invitations.map((invitation) => invitation.id));
                        return;
                      }

                      setSelectedInvitationIds([]);
                    }}
                    aria-label="Select all invitations on page"
                  />
                </TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Email status</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-12.5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => {
                const effectiveStatus = getEffectiveStatus(invitation);
                const canCancel = effectiveStatus === "pending";
                const canResend = effectiveStatus === "pending" || effectiveStatus === "expired";
                const isRowBusy = actionPending === invitation.id;

                return (
                  <TableRow key={invitation.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedInvitationIds.includes(invitation.id)}
                        onCheckedChange={(checked) => {
                          setSelectedInvitationIds((previous) => {
                            if (checked === true) {
                              return previous.includes(invitation.id)
                                ? previous
                                : [...previous, invitation.id];
                            }

                            return previous.filter((id) => id !== invitation.id);
                          });
                        }}
                        aria-label={`Select ${invitation.email}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      <div className="space-y-1">
                        <p>{invitation.email}</p>
                        {invitation.invited_full_name ? (
                          <p className="text-xs text-muted-foreground">
                            {invitation.invited_full_name}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{getRoleBadge(invitation.role)}</TableCell>
                    <TableCell>{getStatusBadge(invitation)}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {getDeliveryBadge(invitation)}
                        {invitation.email_delivery_error ? (
                          <p className="max-w-56 truncate text-xs text-destructive">
                            {invitation.email_delivery_error}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(
                        invitation.last_email_sent_at ||
                          invitation.last_email_attempt_at ||
                          invitation.created_at,
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(invitation.expires_at)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isRowBusy}
                            >
                              {isRowBusy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="h-4 w-4" />
                              )}
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          {canResend ? (
                            <>
                              <DropdownMenuItem onClick={() => void handleResend(invitation.id, "1_week")}>
                                <Send className="h-4 w-4 mr-2" />
                                Resend (1 week)
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void handleResend(invitation.id, "1_month")}>
                                <Send className="h-4 w-4 mr-2" />
                                Resend (1 month)
                              </DropdownMenuItem>
                            </>
                          ) : null}

                          {canCancel ? (
                            <DropdownMenuItem
                              onClick={() => void handleCancel(invitation.id)}
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              Cancel invitation
                            </DropdownMenuItem>
                          ) : null}

                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => void handleDeleteInvitations([invitation.id])}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete invitation
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">Showing {pagedSummary}</p>
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
                className={page <= 1 || isLoading ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-3 text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  if (page < totalPages && !isLoading) {
                    setPage((previous) => Math.min(totalPages, previous + 1));
                  }
                }}
                aria-disabled={page >= totalPages || isLoading}
                className={page >= totalPages || isLoading ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
