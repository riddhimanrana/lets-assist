"use client";

import { ColumnDef } from "@/lib/table/legacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard";
import { format } from "date-fns";
import { updateTrustedMemberStatus } from "../../actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Define the shape of our data
export interface TrustedMember {
  id: string;
  user_id?: string;
  status: boolean | null;
  created_at: string;
  email: string;
  name: string;
  reason: string;
  profiles?: {
    id?: string;
    full_name: string | null;
    email?: string | null;
    avatar_url?: string | null;
    username?: string | null;
  } | null;
}

export const columns: ColumnDef<TrustedMember>[] = [
  {
    header: "User",
    accessorKey: "email", // Use email for sorting/filtering by default
    cell: ({ row }) => {
      const member = row.original;
      return (
        <ProfileHoverCard
          username={member.profiles?.username || "unknown"}
          fullName={member.profiles?.full_name || member.name}
          avatarUrl={member.profiles?.avatar_url || undefined}
        >
          <div className="flex cursor-pointer items-center gap-3 py-1">
            <Avatar className="size-8">
              <AvatarImage
                src={member.profiles?.avatar_url || undefined}
                alt={member.profiles?.full_name || member.name}
              />
              <AvatarFallback>
                <NoAvatar
                  fullName={
                    member.profiles?.full_name ||
                    member.name ||
                    member.email.split("@")[0]
                  }
                />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-medium">
                {member.profiles?.full_name || member.name}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {member.email}
              </div>
            </div>
          </div>
        </ProfileHoverCard>
      );
    },
  },
  {
    accessorKey: "reason",
    header: "Reason",
    cell: ({ row }) => {
      const member = row.original;
      return (
        <div className="max-w-75">
          <p className="text-muted-foreground truncate text-sm">
            "{member.reason}"
          </p>
          <ReasonDialog
            reason={member.reason}
            name={member.profiles?.full_name || member.name}
            email={member.email}
          />
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status;
      if (status === true) {
        return <Badge variant="success">Approved</Badge>;
      }
      if (status === false) {
        return <Badge variant="destructive">Denied</Badge>;
      }
      return <Badge variant="warning">Pending</Badge>;
    },
  },
  {
    accessorKey: "created_at",
    header: "Applied",
    cell: ({ row }) => {
      return (
        <span className="text-sm text-muted-foreground">
          {format(new Date(row.original.created_at), "MMM d, yyyy")}
        </span>
      );
    },
  },
  {
    id: "actions",
    header: () => <div className="text-right">Actions</div>,
    cell: ({ row }) => <ActionsCell member={row.original} />,
  },
];

function ActionsCell({ member }: { member: TrustedMember }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleApprove = async () => {
    const targetId = member.user_id || member.id;
    toast.promise(updateTrustedMemberStatus(targetId, true), {
      loading: "Approving member...",
      success: () => {
        router.refresh();
        return "Member approved";
      },
      error: (err: Error) => err.message || "Failed to approve member",
    });
  };

  const handleDeny = async () => {
    const targetId = member.user_id || member.id;
    toast.promise(updateTrustedMemberStatus(targetId, false), {
      loading: "Denying member...",
      success: () => {
        router.refresh();
        return "Member denied";
      },
      error: (err: Error) => err.message || "Failed to deny member",
    });
  };

  const name = member.profiles?.full_name || member.name;
  const isRevoke = member.status === true;
  const denyLabel = isRevoke ? "Revoke access" : "Deny";

  return (
    <div className="flex justify-end gap-1">
      {/* Pending and denied applications can be approved */}
      {member.status !== true && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                onClick={handleApprove}
                aria-label={`Approve ${name}`}
              />
            }
          >
            <Check aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Approve</TooltipContent>
        </Tooltip>
      )}

      {/* Pending applications can be denied; approved members can be revoked */}
      {member.status !== false && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="destructive-ghost"
                onClick={() => setConfirmOpen(true)}
                aria-label={
                  isRevoke ? `Revoke access for ${name}` : `Deny ${name}`
                }
              />
            }
          >
            <X aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{denyLabel}</TooltipContent>
        </Tooltip>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isRevoke
                ? `Revoke trusted access for ${name}?`
                : `Deny ${name}'s application?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isRevoke
                ? "They lose trusted member status right away. You can approve them again later."
                : "Their application is marked as denied. You can approve them later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                void handleDeny();
              }}
            >
              {denyLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ReasonDialog({
  reason,
  name,
  email,
}: {
  reason: string;
  name: string;
  email: string;
}) {
  const shouldShow = reason.length > 80 || reason.includes("\n");
  if (!reason || !shouldShow) {
    return null;
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="link" className="h-auto p-0 text-xs">
            View full reason
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Application reason</DialogTitle>
          <DialogDescription>
            <span className="text-foreground font-medium">{name}</span> ({email}
            )
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[40vh]">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            "{reason}"
          </p>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
