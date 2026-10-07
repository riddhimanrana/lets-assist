"use client";

import { useMemo, useState } from "react";
import { Download, EyeOff } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { SectionHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  type SortingState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@/lib/table/legacy";

import MemberDetailsDialog from "./MemberDetailsDialog";
import { MembersTable } from "./MembersTable";
import { MembersToolbar } from "./MembersToolbar";
import { RemoveMemberDialog } from "./RemoveMemberDialog";
import {
  buildMemberColumns,
  createMemberSearchFilter,
} from "./members-columns";
import { downloadMemberHoursCsv } from "./members-export";
import type {
  MemberHoursMap,
  MemberHoursPeriod,
  MemberRoleFilter,
  MemberStatusFilter,
  OrganizationMember,
} from "./members-shared";
import { useMemberActions } from "./use-member-actions";
import { useMemberDirectory, useMemberHours } from "./use-member-hours";

interface MembersTabProps {
  members: OrganizationMember[];
  userRole: string | null;
  organizationId: string;
  currentUserId: string | undefined;
  canViewMembers?: boolean;
  /**
   * True when the organization hides its member list from the public. Members
   * then see a note explaining that only they can see this list.
   */
  membersHiddenFromPublic?: boolean;
  demoMemberHours?: MemberHoursMap;
  demoMemberDetails?: Record<
    string,
    {
      events: Array<{
        id: string;
        projectTitle: string;
        eventDate: string;
        hours: number;
        isCertified: boolean;
        organizationName: string;
      }>;
      totalHours: number;
    }
  >;
}

export default function MembersTab({
  members,
  userRole,
  organizationId,
  currentUserId,
  canViewMembers = true,
  membersHiddenFromPublic = false,
  demoMemberHours,
  demoMemberDetails,
}: MembersTabProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<MemberRoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>("all");
  const [selectedMember, setSelectedMember] =
    useState<OrganizationMember | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [dateRange, setDateRange] = useState<MemberHoursPeriod>(undefined);

  const isAdmin = userRole === "admin";
  const canViewHours = userRole === "admin" || userRole === "staff";
  // Demo previews have no real membership rows to look up.
  const showDirectory = canViewHours && !demoMemberHours;
  const showVisibilityNote =
    !!userRole && (membersHiddenFromPublic || !canViewMembers);

  const { memberHours, loadingHours } = useMemberHours({
    organizationId,
    enabled: canViewHours,
    dateRange,
    demoMemberHours,
  });
  const { directory, loadingDirectory } = useMemberDirectory({
    organizationId,
    enabled: showDirectory,
  });
  const {
    processingMember,
    removingMember,
    setRemovingMember,
    handleUpdateRole,
    handleRemoveConfirm,
  } = useMemberActions({ organizationId, currentUserId });

  const handleViewDetails = (member: OrganizationMember) => {
    setSelectedMember(member);
    setIsDetailsOpen(true);
  };

  const visibleMembers = useMemo(
    () =>
      members.filter((member) => {
        if (roleFilter !== "all" && member.role !== roleFilter) return false;
        if (showDirectory && !loadingDirectory && statusFilter !== "all") {
          return directory[member.id]?.status === statusFilter;
        }
        return true;
      }),
    [
      members,
      roleFilter,
      statusFilter,
      showDirectory,
      loadingDirectory,
      directory,
    ],
  );

  const columns = useMemo(
    () =>
      buildMemberColumns({
        viewerRole: userRole,
        currentUserId,
        canViewHours,
        showDirectory,
        memberHours,
        loadingHours,
        directory,
        loadingDirectory,
        processingMember,
        onViewHours: handleViewDetails,
        onUpdateRole: handleUpdateRole,
        onRemove: setRemovingMember,
      }),
    // The handlers only close over stable setters and the ids listed here.
    [
      userRole,
      currentUserId,
      canViewHours,
      showDirectory,
      memberHours,
      loadingHours,
      directory,
      loadingDirectory,
      processingMember,
      organizationId,
    ],
  );

  const globalFilterFn = useMemo(
    () => createMemberSearchFilter(directory),
    [directory],
  );

  const table = useReactTable({
    data: visibleMembers,
    columns,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { sorting, globalFilter },
  });

  const handleExportCSV = () => {
    setIsExporting(true);
    try {
      // Export what the current search and filters show.
      downloadMemberHoursCsv({
        members: table.getFilteredRowModel().rows.map((row) => row.original),
        memberHours,
        dateRange,
      });
      toast.success("Member hours exported successfully");
    } catch (error) {
      console.error("Error exporting member hours:", error);
      toast.error("Failed to export member hours");
    } finally {
      setIsExporting(false);
    }
  };

  const hasFilters =
    globalFilter !== "" || roleFilter !== "all" || statusFilter !== "all";

  return (
    <div className="flex flex-col gap-6">
      {showVisibilityNote && (
        <Alert variant="info">
          <EyeOff />
          <AlertTitle>Only members can see this list</AlertTitle>
          <AlertDescription>
            This organization hides its member list from the public. Visitors
            who are not members cannot view it.
          </AlertDescription>
        </Alert>
      )}

      <SectionHeader
        title="Members"
        description={`${members.length} member${members.length === 1 ? "" : "s"} in this organization`}
        actions={
          isAdmin ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={`/organization/${organizationId}/settings?section=members`}
                />
              }
            >
              <Download data-icon="inline-start" />
              Export members
            </Button>
          ) : undefined
        }
      />

      <MembersToolbar
        search={globalFilter}
        onSearchChange={setGlobalFilter}
        roleFilter={roleFilter}
        onRoleFilterChange={setRoleFilter}
        showStatusFilter={showDirectory}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        showHoursControls={canViewHours}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        isExporting={isExporting}
        onExportHours={handleExportCSV}
      />

      <MembersTable
        table={table}
        hasFilters={hasFilters}
        onClearFilters={() => {
          setGlobalFilter("");
          setRoleFilter("all");
          setStatusFilter("all");
        }}
      />

      <RemoveMemberDialog
        member={removingMember}
        processing={!!removingMember && processingMember === removingMember.id}
        onCancel={() => setRemovingMember(null)}
        onConfirm={handleRemoveConfirm}
      />

      <MemberDetailsDialog
        isOpen={isDetailsOpen}
        onClose={() => {
          setIsDetailsOpen(false);
          setSelectedMember(null);
        }}
        member={selectedMember}
        organizationId={organizationId}
        demoMemberDetails={demoMemberDetails}
      />
    </div>
  );
}
