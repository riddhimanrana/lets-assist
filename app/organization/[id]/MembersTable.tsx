"use client";

import { ChevronLeft, ChevronRight, SearchX, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { flexRender, type useReactTable } from "@/lib/table/legacy";

import type { OrganizationMember } from "./members-shared";

type MembersTableInstance = ReturnType<
  typeof useReactTable<OrganizationMember>
>;

export function MembersTable({
  table,
  hasFilters,
  onClearFilters,
}: {
  table: MembersTableInstance;
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;

  if (total === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {hasFilters ? <SearchX /> : <Users />}
          </EmptyMedia>
          <EmptyTitle>
            {hasFilters ? "No members match" : "No members yet"}
          </EmptyTitle>
          <EmptyDescription>
            {hasFilters
              ? "Try a different search or filter."
              : "People who join this organization will show up here."}
          </EmptyDescription>
        </EmptyHeader>
        {hasFilters && (
          <EmptyContent>
            <Button variant="outline" onClick={onClearFilters}>
              Clear filters
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  const { pageIndex, pageSize } = table.getState().pagination;
  const first = pageIndex * pageSize + 1;
  const last = first + rows.length - 1;

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table aria-label="Members">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="px-4">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="px-4 py-3">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
        <p className="text-muted-foreground text-sm tabular-nums">
          {first}–{last} of {total}
        </p>
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="outline"
                aria-label="Go to previous page"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronLeft data-icon="inline-start" />
                <span className="hidden sm:block">Previous</span>
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="outline"
                aria-label="Go to next page"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="hidden sm:block">Next</span>
                <ChevronRight data-icon="inline-end" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
