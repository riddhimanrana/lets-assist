"use client";

import { format, parseISO } from "date-fns";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Attendance } from "./attendance-format";

export type AttendanceSortField = "check_in_time" | "name";

export interface AttendanceSort {
  field: AttendanceSortField;
  direction: "asc" | "desc";
}

function SortableHead({
  label,
  field,
  sort,
  onSort,
}: {
  label: string;
  field: AttendanceSortField;
  sort: AttendanceSort;
  onSort: (field: AttendanceSortField) => void;
}) {
  const active = sort.field === field;
  const Icon = !active
    ? ArrowUpDown
    : sort.direction === "asc"
      ? ChevronUp
      : ChevronDown;

  return (
    <TableHead
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <Button variant="ghost" className="-ml-2.5" onClick={() => onSort(field)}>
        {label}
        <Icon data-icon="inline-end" aria-hidden="true" />
      </Button>
    </TableHead>
  );
}

function TimeCell({ time, missing }: { time: string | null; missing: string }) {
  return time ? (
    <Badge variant="success" className="tabular-nums">
      {format(parseISO(time), "h:mm a")}
    </Badge>
  ) : (
    <span className="text-muted-foreground">{missing}</span>
  );
}

/** One session's roster with its check-in and check-out actions. */
export function AttendanceTable({
  records,
  sort,
  onSort,
  manualDisabled,
  onCheckIn,
  onCheckOut,
}: {
  records: Attendance[];
  sort: AttendanceSort;
  onSort: (field: AttendanceSortField) => void;
  /** Automatic and sign-up only projects never check in by hand. */
  manualDisabled: boolean;
  onCheckIn: (signupId: string) => void;
  onCheckOut: (signupId: string) => void;
}) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              label="Name"
              field="name"
              sort={sort}
              onSort={onSort}
            />
            <SortableHead
              label="Check-in time"
              field="check_in_time"
              sort={sort}
              onSort={onSort}
            />
            <TableHead>Check-out time</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            const isRegistered = !!record.user_id;
            const name = isRegistered
              ? record.profile?.full_name
              : record.anonymous_signup?.name;
            const email = isRegistered
              ? record.profile?.email
              : record.anonymous_signup?.email;
            const phone = isRegistered
              ? record.profile?.phone
              : record.anonymous_signup?.phone_number;

            return (
              <TableRow key={record.id}>
                <TableCell className="font-medium">{name || "N/A"}</TableCell>
                <TableCell>
                  <TimeCell
                    time={record.check_in_time}
                    missing="Not checked in"
                  />
                </TableCell>
                <TableCell>
                  <TimeCell
                    time={record.check_out_time}
                    missing="Not checked out"
                  />
                </TableCell>
                <TableCell>
                  <div>{email}</div>
                  {isRegistered && phone && (
                    <div className="text-muted-foreground text-sm">
                      {phone.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3")}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => onCheckIn(record.id)}
                      disabled={!!record.check_in_time || manualDisabled}
                    >
                      Check in
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onCheckOut(record.id)}
                      disabled={!record.check_in_time || manualDisabled}
                    >
                      Check out
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
