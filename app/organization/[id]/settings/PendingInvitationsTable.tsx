"use client";

import { Loader2, MoreHorizontal, Send, Trash2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InvitationDuration } from "@/lib/organization/invitation-utils";
import type { OrganizationInvitationWithDetails } from "@/types/invitation";

type EffectiveStatus = "pending" | "accepted" | "expired" | "cancelled";

export function getEffectiveInvitationStatus(
  invitation: OrganizationInvitationWithDetails,
) {
  const expired = new Date(invitation.expires_at) < new Date();

  if (invitation.status === "pending" && expired) {
    return "expired";
  }

  return invitation.status;
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function InvitationStatusBadge({ status }: { status: EffectiveStatus }) {
  if (status === "accepted") {
    return <Badge variant="success">Accepted</Badge>;
  }
  if (status === "cancelled") {
    return <Badge variant="outline">Cancelled</Badge>;
  }
  if (status === "expired") {
    return <Badge variant="warning">Expired</Badge>;
  }
  return <Badge variant="secondary">Pending</Badge>;
}

function DeliveryBadge({ status }: { status: string }) {
  if (status === "sent") {
    return <Badge variant="outline">Sent</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  if (status === "skipped") {
    return <Badge variant="outline">Skipped</Badge>;
  }
  return <Badge variant="secondary">Pending</Badge>;
}

type PendingInvitationsTableProps = {
  invitations: OrganizationInvitationWithDetails[];
  selectedIds: string[];
  busyInvitationId: string | null;
  onSelectedIdsChange: (
    update: string[] | ((previous: string[]) => string[]),
  ) => void;
  onResend: (invitationId: string, duration: InvitationDuration) => void;
  onCancel: (invitationId: string) => void;
  onDelete: (invitationId: string) => void;
};

export default function PendingInvitationsTable({
  invitations,
  selectedIds,
  busyInvitationId,
  onSelectedIdsChange,
  onResend,
  onCancel,
  onDelete,
}: PendingInvitationsTableProps) {
  const allSelected =
    invitations.length > 0 &&
    invitations.every((invitation) => selectedIds.includes(invitation.id));

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => {
                  if (checked === true) {
                    onSelectedIdsChange(
                      invitations.map((invitation) => invitation.id),
                    );
                    return;
                  }

                  onSelectedIdsChange([]);
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
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.map((invitation) => {
            const effectiveStatus = getEffectiveInvitationStatus(invitation);
            const canCancel = effectiveStatus === "pending";
            const canResend =
              effectiveStatus === "pending" || effectiveStatus === "expired";
            const isRowBusy = busyInvitationId === invitation.id;

            return (
              <TableRow key={invitation.id}>
                <TableCell>
                  <Checkbox
                    checked={selectedIds.includes(invitation.id)}
                    onCheckedChange={(checked) => {
                      onSelectedIdsChange((previous) => {
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
                <TableCell>
                  <div className="grid gap-0.5">
                    <span className="font-medium">{invitation.email}</span>
                    {invitation.invited_full_name ? (
                      <span className="text-muted-foreground text-xs">
                        {invitation.invited_full_name}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="capitalize">{invitation.role}</TableCell>
                <TableCell>
                  <InvitationStatusBadge
                    status={effectiveStatus as EffectiveStatus}
                  />
                </TableCell>
                <TableCell>
                  <div className="grid gap-1">
                    <DeliveryBadge
                      status={invitation.email_delivery_status || "pending"}
                    />
                    {invitation.email_delivery_error ? (
                      <p className="text-destructive max-w-56 truncate text-xs">
                        {invitation.email_delivery_error}
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatDate(
                    invitation.last_email_sent_at ||
                      invitation.last_email_attempt_at ||
                      invitation.created_at,
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatDate(invitation.expires_at)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isRowBusy}
                          aria-label={`Actions for ${invitation.email}`}
                        >
                          {isRowBusy ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <MoreHorizontal />
                          )}
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      {canResend ? (
                        <>
                          <DropdownMenuItem
                            onClick={() => onResend(invitation.id, "1_week")}
                          >
                            <Send />
                            Resend (1 week)
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onResend(invitation.id, "1_month")}
                          >
                            <Send />
                            Resend (1 month)
                          </DropdownMenuItem>
                        </>
                      ) : null}

                      {canCancel ? (
                        <DropdownMenuItem
                          onClick={() => onCancel(invitation.id)}
                        >
                          <XCircle />
                          Cancel invitation
                        </DropdownMenuItem>
                      ) : null}

                      {canResend || canCancel ? (
                        <DropdownMenuSeparator />
                      ) : null}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDelete(invitation.id)}
                      >
                        <Trash2 />
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
  );
}
