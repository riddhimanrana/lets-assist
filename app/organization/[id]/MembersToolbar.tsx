"use client";

import { Download, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type {
  MemberHoursPeriod,
  MemberRoleFilter,
  MemberStatusFilter,
} from "./members-shared";

const ROLE_FILTER_LABELS: Record<MemberRoleFilter, string> = {
  all: "All roles",
  admin: "Admin",
  staff: "Staff",
  member: "Member",
};

const STATUS_FILTER_LABELS: Record<MemberStatusFilter, string> = {
  all: "Any status",
  active: "Active",
  inactive: "Inactive",
};

export function MembersToolbar({
  search,
  onSearchChange,
  roleFilter,
  onRoleFilterChange,
  showStatusFilter,
  statusFilter,
  onStatusFilterChange,
  showHoursControls,
  dateRange,
  onDateRangeChange,
  isExporting,
  onExportHours,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  roleFilter: MemberRoleFilter;
  onRoleFilterChange: (value: MemberRoleFilter) => void;
  showStatusFilter: boolean;
  statusFilter: MemberStatusFilter;
  onStatusFilterChange: (value: MemberStatusFilter) => void;
  showHoursControls: boolean;
  dateRange: MemberHoursPeriod;
  onDateRangeChange: (value: MemberHoursPeriod) => void;
  isExporting: boolean;
  onExportHours: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <InputGroup className="sm:max-w-xs">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search members"
            placeholder={
              showStatusFilter ? "Search by name or email" : "Search members"
            }
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </InputGroup>

        <Select
          value={roleFilter}
          onValueChange={(value) =>
            value && onRoleFilterChange(value as MemberRoleFilter)
          }
        >
          <SelectTrigger aria-label="Filter by role" className="w-full sm:w-36">
            <SelectValue>{ROLE_FILTER_LABELS[roleFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ROLE_FILTER_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {showStatusFilter && (
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              value && onStatusFilterChange(value as MemberStatusFilter)
            }
          >
            <SelectTrigger
              aria-label="Filter by status"
              className="w-full sm:w-36"
            >
              <SelectValue>{STATUS_FILTER_LABELS[statusFilter]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_FILTER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {showHoursControls && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-muted-foreground text-sm whitespace-nowrap">
            Hours period
          </span>
          <DateRangePicker
            value={dateRange}
            onChange={onDateRangeChange}
            placeholder={dateRange?.from ? undefined : "Lifetime"}
            showQuickSelect={true}
            className="sm:w-auto"
          />
          <Button
            variant="outline"
            className="sm:ml-auto"
            onClick={onExportHours}
            disabled={isExporting}
          >
            {isExporting ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Download data-icon="inline-start" />
            )}
            Export hours
          </Button>
        </div>
      )}
    </div>
  );
}
