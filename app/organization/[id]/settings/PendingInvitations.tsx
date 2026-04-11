"use client";

import { useState, useEffect, useTransition } from "react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
} from "lucide-react";
import {
  getOrganizationInvitations,
  cancelInvitation,
  resendInvitation,
} from "@/app/organization/[id]/admin/actions";
import type { OrganizationInvitationWithDetails } from "@/types/invitation";

interface PendingInvitationsProps {
  organizationId: string;
  refreshKey?: number;
}

type StatusFilter = "pending" | "accepted" | "expired" | "cancelled" | "all";

export default function PendingInvitations({
  organizationId,
  refreshKey = 0,
}: PendingInvitationsProps) {
  const [invitations, setInvitations] = useState<OrganizationInvitationWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadInvitations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getOrganizationInvitations(organizationId, statusFilter);
      setInvitations(data);
    } catch (err) {
      setError("Failed to load invitations");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInvitations();
  }, [organizationId, statusFilter, refreshKey]);

  const handleCancel = async (invitationId: string) => {
    setActionPending(invitationId);
    setError(null);
    setSuccessMessage(null);

    const result = await cancelInvitation(invitationId);

    if (result.success) {
      setSuccessMessage("Invitation cancelled");
      loadInvitations();
    } else {
      setError(result.error || "Failed to cancel invitation");
    }

    setActionPending(null);
  };

  const handleResend = async (invitationId: string) => {
    setActionPending(invitationId);
    setError(null);
    setSuccessMessage(null);

    const result = await resendInvitation(invitationId);

    if (result.success) {
      setSuccessMessage("Invitation email resent");
      loadInvitations();
    } else {
      setError(result.error || "Failed to resend invitation");
    }

    setActionPending(null);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  const getStatusBadge = (invitation: OrganizationInvitationWithDetails) => {
    const expired = isExpired(invitation.expires_at);

    if (invitation.status === "accepted") {
      return (
        <Badge variant="default" className="bg-green-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Accepted
        </Badge>
      );
    }

    if (invitation.status === "cancelled") {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <XCircle className="h-3 w-3 mr-1" />
          Cancelled
        </Badge>
      );
    }

    if (invitation.status === "expired" || expired) {
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

  return (
    <div className="space-y-4">
      {/* Filters and Actions */}
      <div className="flex items-center justify-between">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="ghost" size="sm" onClick={loadInvitations} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

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
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => {
                const isPending = invitation.status === "pending" && !isExpired(invitation.expires_at);

                return (
                  <TableRow key={invitation.id}>
                    <TableCell className="font-mono text-sm">
                      {invitation.email}
                    </TableCell>
                    <TableCell>{getRoleBadge(invitation.role)}</TableCell>
                    <TableCell>{getStatusBadge(invitation)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(invitation.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(invitation.expires_at)}
                    </TableCell>
                    <TableCell>
                      {isPending && (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={actionPending === invitation.id}
                            >
                              {actionPending === invitation.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="h-4 w-4" />
                              )}
                            </Button>
                          } />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleResend(invitation.id)}>
                              <Send className="h-4 w-4 mr-2" />
                              Resend
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleCancel(invitation.id)}
                              className="text-destructive"
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              Cancel
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
