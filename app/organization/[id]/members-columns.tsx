"use client";

import { format } from "date-fns";
import { ArrowUpDown } from "lucide-react";
import Link from "next/link";

import { NoAvatar } from "@/components/shared/NoAvatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ColumnDef, FilterFn } from "@/lib/table/legacy";

import { MemberRoleBadge } from "./MemberRoleBadge";
import { MemberRowMenu } from "./MemberRowMenu";
import {
  formatHours,
  getMemberName,
  getMemberProfile,
  type MemberDirectoryMap,
  type MemberHoursMap,
  type OrganizationMember,
} from "./members-shared";

type MemberColumn = ColumnDef<OrganizationMember>;
type HeaderColumn = {
  toggleSorting: (desc?: boolean) => void;
  getIsSorted: () => false | "asc" | "desc";
};

export type MembersColumnContext = {
  viewerRole: string | null;
  currentUserId: string | undefined;
  /** Staff and admins see hours, events and the row menu. */
  canViewHours: boolean;
  /** Staff and admins see email, status and last activity when loaded. */
  showDirectory: boolean;
  memberHours: MemberHoursMap;
  loadingHours: boolean;
  directory: MemberDirectoryMap;
  loadingDirectory: boolean;
  processingMember: string | null;
  onViewHours: (member: OrganizationMember) => void;
  onUpdateRole: (
    memberId: string,
    userId: string,
    userName: string,
    newRole: OrganizationMember["role"],
  ) => void;
  onRemove: (member: { id: string; name: string }) => void;
};

/** Search across name and username, plus email for staff and admins. */
export function createMemberSearchFilter(
  directory: MemberDirectoryMap,
): FilterFn<OrganizationMember> {
  return (row, _columnId, filterValue) => {
    const search = String(filterValue).toLowerCase();
    const profile = getMemberProfile(row.original);
    const fullName = profile?.full_name?.toLowerCase() || "";
    const username = profile?.username?.toLowerCase() || "";
    const email = directory[row.original.id]?.email?.toLowerCase() || "";
    return (
      fullName.includes(search) ||
      username.includes(search) ||
      (email !== "" && email.includes(search))
    );
  };
}

function SortableHeader({
  column,
  label,
}: {
  column: HeaderColumn;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      className="-ml-2.5"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {label}
      <ArrowUpDown data-icon="inline-end" className="text-muted-foreground" />
    </Button>
  );
}

const formatDay = (value: string) => format(new Date(value), "MMM d, yyyy");

const ROLE_ORDER = { admin: 3, staff: 2, member: 1 } as const;

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function buildMemberColumns(ctx: MembersColumnContext): MemberColumn[] {
  const memberColumn: MemberColumn = {
    id: "member",
    header: "Member",
    accessorFn: (row) => getMemberName(row),
    cell: ({ row }) => {
      const profile = getMemberProfile(row.original);
      return (
        <div className="flex items-center gap-3">
          <Avatar className="size-9 shrink-0">
            <AvatarImage
              src={profile?.avatar_url || undefined}
              alt={profile?.full_name || ""}
            />
            <AvatarFallback className="text-primary text-xs">
              <NoAvatar fullName={profile?.full_name || ""} />
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/profile/${profile?.username || ""}`}
              className="hover:text-primary truncate text-sm font-medium transition-colors"
            >
              {profile?.full_name || "Unknown User"}
            </Link>
            {profile?.username && (
              <span className="text-muted-foreground truncate text-xs">
                @{profile.username}
              </span>
            )}
          </div>
        </div>
      );
    },
  };

  const roleColumn: MemberColumn = {
    accessorKey: "role",
    header: ({ column }) => <SortableHeader column={column} label="Role" />,
    cell: ({ row }) => <MemberRoleBadge role={row.original.role} />,
    sortFn: (rowA, rowB, columnId) => {
      const roleA = rowA.getValue(columnId) as keyof typeof ROLE_ORDER;
      const roleB = rowB.getValue(columnId) as keyof typeof ROLE_ORDER;
      return ROLE_ORDER[roleA] - ROLE_ORDER[roleB];
    },
  };

  const joinedColumn: MemberColumn = {
    accessorKey: "joined_at",
    header: ({ column }) => <SortableHeader column={column} label="Joined" />,
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm whitespace-nowrap">
        {formatDay(row.original.joined_at)}
      </span>
    ),
  };

  if (!ctx.canViewHours) return [memberColumn, roleColumn, joinedColumn];

  const hoursColumn: MemberColumn = {
    id: "hours",
    header: ({ column }) => <SortableHeader column={column} label="Hours" />,
    accessorFn: (row) => ctx.memberHours[row.user_id]?.totalHours || 0,
    cell: ({ row }) =>
      ctx.loadingHours ? (
        <Skeleton className="h-4 w-12" />
      ) : (
        <Button
          variant="ghost"
          className="-ml-2.5 tabular-nums"
          aria-label={`View hours for ${getMemberName(row.original)}`}
          onClick={() => ctx.onViewHours(row.original)}
        >
          {formatHours(ctx.memberHours[row.original.user_id]?.totalHours || 0)}
        </Button>
      ),
  };

  const eventsColumn: MemberColumn = {
    id: "events",
    header: ({ column }) => <SortableHeader column={column} label="Events" />,
    accessorFn: (row) => ctx.memberHours[row.user_id]?.eventCount || 0,
    cell: ({ row }) =>
      ctx.loadingHours ? (
        <Skeleton className="h-4 w-8" />
      ) : (
        <span className="text-sm tabular-nums">
          {ctx.memberHours[row.original.user_id]?.eventCount || 0}
        </span>
      ),
  };

  const directoryCell = (
    member: OrganizationMember,
    render: (entry: MemberDirectoryMap[string]) => React.ReactNode,
  ) => {
    if (ctx.loadingDirectory) return <Skeleton className="h-4 w-20" />;
    const entry = ctx.directory[member.id];
    const content = entry ? render(entry) : null;
    return content ?? <span className="text-muted-foreground">—</span>;
  };

  const emailColumn: MemberColumn = {
    id: "email",
    header: "Email",
    accessorFn: (row) => ctx.directory[row.id]?.email || "",
    cell: ({ row }) =>
      directoryCell(row.original, (entry) =>
        entry.email ? (
          <span className="text-muted-foreground text-sm">{entry.email}</span>
        ) : null,
      ),
  };

  const statusColumn: MemberColumn = {
    id: "status",
    header: "Status",
    accessorFn: (row) => ctx.directory[row.id]?.status || "",
    cell: ({ row }) =>
      directoryCell(row.original, (entry) =>
        entry.status ? (
          <Badge
            variant={entry.status === "active" ? "success" : "outline"}
            className={
              entry.status === "active" ? undefined : "text-muted-foreground"
            }
          >
            {statusLabel(entry.status)}
          </Badge>
        ) : null,
      ),
  };

  const lastActivityColumn: MemberColumn = {
    id: "last_activity",
    header: ({ column }) => (
      <SortableHeader column={column} label="Last activity" />
    ),
    accessorFn: (row) => ctx.directory[row.id]?.lastActivityAt || "",
    cell: ({ row }) =>
      directoryCell(row.original, (entry) =>
        entry.lastActivityAt ? (
          <span className="text-muted-foreground text-sm whitespace-nowrap">
            {formatDay(entry.lastActivityAt)}
          </span>
        ) : null,
      ),
  };

  const actionsColumn: MemberColumn = {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <MemberRowMenu
        member={row.original}
        viewerRole={ctx.viewerRole}
        currentUserId={ctx.currentUserId}
        processing={ctx.processingMember === row.original.id}
        onViewHours={ctx.onViewHours}
        onUpdateRole={ctx.onUpdateRole}
        onRemove={ctx.onRemove}
      />
    ),
  };

  return [
    memberColumn,
    ...(ctx.showDirectory ? [emailColumn] : []),
    roleColumn,
    ...(ctx.showDirectory ? [statusColumn] : []),
    hoursColumn,
    eventsColumn,
    joinedColumn,
    ...(ctx.showDirectory ? [lastActivityColumn] : []),
    actionsColumn,
  ];
}
