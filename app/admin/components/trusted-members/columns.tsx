"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard";
import { format } from "date-fns";
import { updateTrustedMemberStatus } from "../../actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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
                    <div className="flex items-center gap-3 py-1 cursor-pointer">
                        <Avatar className="h-10 w-10">
                            {member.profiles?.avatar_url ? (
                                <>
                                    <AvatarImage src={member.profiles.avatar_url} />
                                    <AvatarFallback>
                                        {member.profiles?.full_name
                                            ? member.profiles.full_name
                                                  .split(" ")
                                                  .map((n) => n[0])
                                                  .slice(0, 2)
                                                  .join("")
                                                  .toUpperCase()
                                            : (member.name || member.email || "")[0]?.toUpperCase()}
                                    </AvatarFallback>
                                </>
                            ) : (
                                <AvatarFallback>
                                    <NoAvatar fullName={member.profiles?.full_name || member.name || member.email.split("@")[0]} />
                                </AvatarFallback>
                            )}
                        </Avatar>
                        <div className="min-w-0">
                            <div className="font-semibold truncate">
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
                <div className="max-w-[300px]">
                    <p className="text-sm text-muted-foreground line-clamp-1 italic">
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
                return (
                    <Badge className="rounded-full px-3 py-0.5 bg-success/10 text-success border-success/20 hover:bg-success/20 shadow-none">
                        Approved
                    </Badge>
                );
            }
            if (status === false) {
                return (
                    <Badge
                        variant="destructive"
                        className="rounded-full px-3 py-0.5 shadow-none"
                    >
                        Denied
                    </Badge>
                );
            }
            return (
                <Badge
                    variant="secondary"
                    className="rounded-full px-3 py-0.5 shadow-none"
                >
                    Pending
                </Badge>
            );
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

    const handleApprove = async () => {
        const targetId = member.user_id || member.id;
        toast.promise(updateTrustedMemberStatus(targetId, true), {
            loading: 'Approving member...',
            success: () => {
                router.refresh();
                return 'Member approved';
            },
            error: (err: Error) => err.message || 'Failed to approve member'
        });
    };

    const handleDeny = async () => {
        const targetId = member.user_id || member.id;
        toast.promise(updateTrustedMemberStatus(targetId, false), {
            loading: 'Denying member...',
            success: () => {
                router.refresh();
                return 'Member denied';
            },
            error: (err: Error) => err.message || 'Failed to deny member'
        })
    };

    return (
        <div className="flex justify-end gap-1">
            {/* Pending State */}
            {member.status === null && (
                <>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-success hover:bg-success/10 hover:text-success"
                        onClick={handleApprove}
                        title="Approve"
                    >
                        <Check className="h-4 w-4" />
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={handleDeny}
                        title="Deny"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </>
            )}

            {/* Denied State - Allow re-approve */}
            {member.status === false && (
                <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-success hover:bg-success/10 hover:text-success"
                    onClick={handleApprove}
                    title="Approve"
                >
                    <Check className="h-4 w-4" />
                </Button>
            )}

            {/* Approved State - Allow revoke */}
            {member.status === true && (
                <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleDeny}
                    title="Revoke Access"
                >
                    <X className="h-4 w-4" />
                </Button>
            )}
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
            <DialogTrigger render={
                <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs font-semibold text-primary"
                >
                    View full reason
                </Button>
            } />
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Application Reason</DialogTitle>
                    <DialogDescription className="flex items-center gap-2 mt-1">
                        <span className="font-medium text-foreground">{name}</span>
                        <span className="text-muted-foreground">({email})</span>
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="mt-4 max-h-[40vh] rounded-xl border bg-muted/30 p-4">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap italic">
                        "{reason}"
                    </p>
                </ScrollArea>
                <DialogFooter>
                    {/* Using a standard close button pattern or just rely on the X in the corner, 
                but providing a distinct Close button is good for UX in dialogs. */}
                    <div className="flex w-full justify-end">
                        {/* Shadcn DialogContent usually has a Close button in the corner. 
                     We can add a manual one if needed, but often strict closing logic 
                     isn't exposed easily without controlled state or just using the built-in X.
                     I'll omit a manual close button to keep it simple unless requested, 
                     as the X is standard.  */}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
