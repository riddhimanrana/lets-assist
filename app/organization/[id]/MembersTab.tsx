"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { format } from "date-fns";
import { useEffect, useState, useMemo } from "react";
import {
  MoreHorizontal,
  Search,
  Shield,
  UserRoundCog,
  UserRound,
  X,
  Users,
  ArrowUpDown,
  Eye,
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { updateMemberRole, removeMember } from "./actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getMemberVolunteerHours } from "./member-hours-actions";
import MemberDetailsDialog from "./MemberDetailsDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  FilterFn,
} from "@tanstack/react-table";

interface MembersTabProps {
  members: OrganizationMember[];
  userRole: string | null;
  organizationId: string;
  currentUserId: string | undefined;
}

type MemberProfile = {
  full_name?: string | null;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
};

type OrganizationMember = {
  id: string;
  user_id: string;
  role: "admin" | "staff" | "member";
  joined_at: string;
  profiles?: MemberProfile | MemberProfile[] | null;
};

const getMemberProfile = (member: OrganizationMember): MemberProfile | null =>
  Array.isArray(member.profiles) ? member.profiles[0] ?? null : member.profiles ?? null;

// Custom filter function for searching multiple fields
const globalFilterFn: FilterFn<OrganizationMember> = (row, columnId, filterValue) => {
  const search = filterValue.toLowerCase();
  const profile = getMemberProfile(row.original);
  const fullName = profile?.full_name?.toLowerCase() || "";
  const username = profile?.username?.toLowerCase() || "";
  return fullName.includes(search) || username.includes(search);
};

export default function MembersTab({
  members,
  userRole,
  organizationId,
  currentUserId,
}: MembersTabProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState({});

  const [processingMember, setProcessingMember] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<{ id: string; name: string } | null>(null);
  const [memberHours, setMemberHours] = useState<Record<string, { totalHours: number; eventCount: number; lastEventDate?: string }>>({});
  const [loadingHours, setLoadingHours] = useState(false);
  const [selectedMember, setSelectedMember] = useState<OrganizationMember | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const canManageMembers = userRole === "admin" || userRole === "staff";
  const isAdmin = userRole === "admin";
  const canViewHours = userRole === "admin" || userRole === "staff";

  // Helper function to format hours as "Xh Ym"
  const formatHours = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  // Load member hours for admins and staff
  useEffect(() => {
    if (canViewHours && organizationId) {
      loadMemberHours();
    }
  }, [userRole, organizationId, dateRange]);

  const loadMemberHours = async () => {
    setLoadingHours(true);
    try {
      const dateRangeParam = dateRange?.from && dateRange?.to
        ? { from: dateRange.from, to: dateRange.to }
        : undefined;
      const result = await getMemberVolunteerHours(organizationId, dateRangeParam);
      if (!result.error) {
        setMemberHours(result.memberHours);
      }
    } catch (error) {
      console.error("Error loading member hours:", error);
    } finally {
      setLoadingHours(false);
    }
  };

  const handleViewDetails = (member: OrganizationMember) => {
    setSelectedMember(member);
    setIsDetailsOpen(true);
  };

  const handleUpdateRole = async (
    memberId: string,
    userId: string,
    userName: string,
    newRole: OrganizationMember["role"]
  ) => {
    if (userId === currentUserId && newRole !== "admin") {
      toast.error("You cannot demote yourself. Another admin must change your role.");
      return;
    }

    setProcessingMember(memberId);
    try {
      const result = await updateMemberRole(organizationId, memberId, newRole);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`${userName}'s role updated to ${newRole}`);
        // In a real app with SWR/Tanstack Query we would invalidate cache here.
        // For now, we rely on the parent or a refresh, or optimist UI updates if we controlled the data state fully.
        // Since 'members' is a prop, we can't mutate it directly without a refresh or parent update.
        // Assuming the parent page refreshes on action or we trigger a router refresh.
        window.location.reload();
      }
    } catch (error) {
      console.error("Error updating member role:", error);
      toast.error("Failed to update member role");
    } finally {
      setProcessingMember(null);
    }
  };

  const handleRemoveConfirm = async () => {
    if (!removingMember) return;

    setProcessingMember(removingMember.id);
    try {
      const result = await removeMember(organizationId, removingMember.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`${removingMember.name} has been removed from the organization`);
        window.location.reload();
      }
    } catch (error) {
      console.error("Error removing member:", error);
      toast.error("Failed to remove member");
    } finally {
      setProcessingMember(null);
      setRemovingMember(null);
    }
  };

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      // Create simple hours export data
      // We use table.getFilteredRowModel().rows to export what matches current filters if desired,
      // but usually exports are for the full dataset or current view. 
      // Using 'table.getCoreRowModel().rows' would export all.
      // Let's export what's currently filtered/sorted in the table view for consistency
      const rowsToExport = table.getFilteredRowModel().rows.map(r => r.original);

      const exportData = [];

      for (const member of rowsToExport) {
        const profile = getMemberProfile(member);
        const memberName = profile?.full_name || "Unknown User";
        const username = profile?.username || "";
        const totalHours = memberHours[member.user_id]?.totalHours || 0;
        const eventCount = memberHours[member.user_id]?.eventCount || 0;

        exportData.push({
          memberName,
          username,
          role: member.role,
          joinedDate: `"${format(new Date(member.joined_at), "MMM d, yyyy")}"`,
          totalHours: formatHours(totalHours),
          eventCount
        });
      }

      // Generate CSV
      const headers = [
        "Member Name", "Username", "Role", "Joined Date", "Total Hours", "Events Attended"
      ];
      const csvRows = [headers.join(",")];

      exportData.forEach(row => {
        const csvRow = [
          `"${row.memberName}"`,
          row.username,
          row.role,
          row.joinedDate,
          row.totalHours,
          row.eventCount
        ].join(",");
        csvRows.push(csvRow);
      });

      const csvData = csvRows.join("\n");
      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Create filename with date range if applicable
      const today = new Date().toISOString().split('T')[0];
      let filename = `member-hours-${today}`;
      if (dateRange?.from && dateRange?.to) {
        const fromDate = format(dateRange.from, "yyyy-MM-dd");
        const toDate = format(new Date(dateRange.to.getTime() - 24 * 60 * 60 * 1000), "yyyy-MM-dd");
        filename = `member-hours-${fromDate}-to-${toDate}`;
      } else {
        filename = `member-hours-lifetime-${today}`;
      }
      a.download = `${filename}.csv`;

      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success("Member hours exported successfully");
    } catch (error) {
      console.error("Error exporting member hours:", error);
      toast.error("Failed to export member hours");
    } finally {
      setIsExporting(false);
    }
  };


  const columns = useMemo<ColumnDef<OrganizationMember>[]>(() => {
    const cols: ColumnDef<OrganizationMember>[] = [
      {
        accessorKey: "member", // Composite accessor for sorting/filtering
        id: "member",
        header: "Member",
        accessorFn: (row) => {
          const profile = getMemberProfile(row);
          return profile?.full_name || "Unknown User";
        },
        cell: ({ row }) => {
          const profile = getMemberProfile(row.original);
          return (
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9 shrink-0 border border-border/50">
                <AvatarImage
                  src={profile?.avatar_url || undefined}
                  alt={profile?.full_name || ""}
                />
                <AvatarFallback className="bg-primary/5 text-primary text-xs">
                  <NoAvatar fullName={profile?.full_name || ""} />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex flex-col">
                <Link
                  href={`/profile/${profile?.username || ''}`}
                  className="font-medium hover:text-primary transition-colors truncate text-sm"
                >
                  {profile?.full_name || "Unknown User"}
                </Link>
                {profile?.username && (
                  <span className="text-xs text-muted-foreground truncate">
                    @{profile.username}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "role",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              className="-ml-4 h-8 data-[state=open]:bg-accent"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Role
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
        cell: ({ row }) => <RoleBadge role={row.original.role} />,
        sortingFn: (rowA, rowB, columnId) => {
          const roleOrder = { admin: 3, staff: 2, member: 1 };
          const roleA = rowA.getValue(columnId) as keyof typeof roleOrder;
          const roleB = rowB.getValue(columnId) as keyof typeof roleOrder;
          return roleOrder[roleA] - roleOrder[roleB];
        }
      },
      {
        accessorKey: "joined_at",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              className="-ml-4 h-8 data-[state=open]:bg-accent"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Joined
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
        cell: ({ row }) => (
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            {format(new Date(row.original.joined_at), "MMM d, yyyy")}
          </div>
        ),
      },
    ];

    if (canViewHours) {
      cols.splice(2, 0, {
        id: "hours",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="-ml-4 h-8 data-[state=open]:bg-accent"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Hours
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        accessorFn: (row) => memberHours[row.user_id]?.totalHours || 0,
        cell: ({ row }) => (
          loadingHours ? (
            <Skeleton className="h-4 w-12 rounded-full" />
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-medium text-primary tabular-nums text-sm">
                {formatHours(memberHours[row.original.user_id]?.totalHours || 0)}
              </span>
              {(isAdmin || userRole === "staff" || row.original.user_id === currentUserId) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-full hover:bg-primary/10 hover:text-primary transition-colors"
                  onClick={() => handleViewDetails(row.original)}
                >
                  <Eye className="h-3 w-3" />
                </Button>
              )}
            </div>
          )
        ),
      });

      cols.splice(3, 0, {
        id: "events",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="-ml-4 h-8 data-[state=open]:bg-accent"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Events
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        accessorFn: (row) => memberHours[row.user_id]?.eventCount || 0,
        cell: ({ row }) => (
          loadingHours ? (
            <Skeleton className="h-4 w-8 rounded-full" />
          ) : (
            <span className="font-medium tabular-nums text-sm">
              {memberHours[row.original.user_id]?.eventCount || 0}
            </span>
          )
        ),
      });
    }

    if (canManageMembers) {
      cols.push({
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const member = row.original;
          const profile = getMemberProfile(member);

          if (!((isAdmin || (userRole === "staff" && member.role === "member")) && member.user_id !== currentUserId)) {
            return <div className="w-8 h-8" />;
          }

          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      disabled={processingMember === member.id}
                    >
                      {processingMember === member.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <MoreHorizontal className="h-4 w-4" />
                      )}
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-56 rounded-xl shadow-lg border-muted/40">
                  <div className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Modify Member Permissions
                  </div>

                  {isAdmin && (
                    <>
                      <DropdownMenuItem
                        className="gap-2 py-2"
                        onClick={() => handleUpdateRole(
                          member.id,
                          member.user_id,
                          profile?.full_name || "Member",
                          "admin"
                        )}
                        disabled={member.role === "admin"}
                      >
                        <Shield className="h-4 w-4 text-primary" />
                        <span className="font-medium">Make Admin</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2 py-2"
                        onClick={() => handleUpdateRole(
                          member.id,
                          member.user_id,
                          profile?.full_name || "Member",
                          "staff"
                        )}
                        disabled={member.role === "staff"}
                      >
                        <UserRoundCog className="h-4 w-4 text-info" />
                        <span className="font-medium">Make Staff</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2 py-2"
                        onClick={() => handleUpdateRole(
                          member.id,
                          member.user_id,
                          profile?.full_name || "Member",
                          "member"
                        )}
                        disabled={member.role === "member"}
                      >
                        <UserRound className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Make Member</span>
                      </DropdownMenuItem>
                    </>
                  )}

                  {userRole === "staff" && member.role === "member" && (
                    <DropdownMenuItem
                      className="gap-2 py-2"
                      onClick={() => handleUpdateRole(
                        member.id,
                        member.user_id,
                        profile?.full_name || "Member",
                        "staff"
                      )}
                    >
                      <UserRoundCog className="h-4 w-4 text-info" />
                      <span className="font-medium">Make Staff</span>
                    </DropdownMenuItem>
                  )}

                  <div className="h-px bg-muted my-1" />
                  <div className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive">
                    Danger Zone
                  </div>

                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive focus:bg-destructive/10 gap-2 py-2"
                    onClick={() => setRemovingMember({
                      id: member.id,
                      name: profile?.full_name || "Member"
                    })}
                  >
                    <X className="h-4 w-4" />
                    <span className="font-medium">Remove Member</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      });
    }

    return cols;
  }, [canViewHours, canManageMembers, memberHours, userRole, isAdmin, currentUserId, processingMember, loadingHours]);

  const table = useReactTable({
    data: members,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn, // Use custom global filter
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
      rowSelection,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Members</h2>
          <p className="text-sm text-muted-foreground">
            {table.getFilteredRowModel().rows.length} member{table.getFilteredRowModel().rows.length === 1 ? "" : "s"} in this organization
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {canViewHours && (
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              placeholder={dateRange?.from ? undefined : "Lifetime"}
              showQuickSelect={true}
              className="w-full sm:w-[240px]"
            />
          )}

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members..."
              className="pl-9 h-9"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
            />
          </div>

          {canViewHours && (
            <Button
              onClick={handleExportCSV}
              disabled={isExporting}
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id} className="h-11 px-4">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className="group border-b last:border-0"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-4 px-4">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-32 text-center">
                    {globalFilter ? (
                      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Search className="h-8 w-8 opacity-20" />
                        <p>No results found for &quot;{globalFilter}&quot;</p>
                        <Button
                          variant="link"
                          onClick={() => setGlobalFilter("")}
                          className="h-auto p-0"
                        >
                          Clear search
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Users className="h-8 w-8 opacity-20" />
                        <p>No members yet</p>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
          <div className="text-xs font-medium text-muted-foreground">
            Showing {table.getRowModel().rows.length} members
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>


      {/* Remove Member Dialog */}
      <Dialog
        open={!!removingMember}
        onOpenChange={(open) => !open && setRemovingMember(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {removingMember?.name} from this organization?
              They will lose access to all organization resources.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 gap-2">
            <Button
              variant="outline"
              onClick={() => setRemovingMember(null)}
              disabled={processingMember === removingMember?.id}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveConfirm}
              disabled={processingMember === removingMember?.id}
            >
              {processingMember === removingMember?.id ? "Removing..." : "Remove Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Member Details Dialog */}
      <MemberDetailsDialog
        isOpen={isDetailsOpen}
        onClose={() => {
          setIsDetailsOpen(false);
          setSelectedMember(null);
        }}
        member={selectedMember}
        organizationId={organizationId}
      />
    </div>
  );
}

// Helper component for role badges
function RoleBadge({ role }: { role: string }) {
  switch (role) {
    case 'admin':
      return (
        <Badge variant="default" className="gap-1 rounded-full px-2.5 py-0.5">
          <Shield className="h-3 w-3" />
          Admin
        </Badge>
      );
    case 'staff':
      return (
        <Badge variant="info" className="gap-1 rounded-full px-2.5 py-0.5">
          <UserRoundCog className="h-3 w-3" />
          Staff
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1 rounded-full px-2.5 py-0.5 text-muted-foreground">
          <UserRound className="h-3 w-3" />
          Member
        </Badge>
      );
  }
}
