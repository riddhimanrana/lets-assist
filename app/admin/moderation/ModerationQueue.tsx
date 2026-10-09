"use client";

import { CircleCheck } from "lucide-react";

import { SectionHeader } from "@/components/layout/PageHeader";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * One moderation queue: a heading, the status filter, and the table for the
 * chosen status. Reports and AI flags share this frame so their toolbars and
 * tables line up on the same edges.
 */
export function ModerationQueue<Filter extends string>({
  title,
  description,
  filter,
  filters,
  onFilterChange,
  isLoading,
  isEmpty,
  emptyTitle,
  emptyDescription,
  children,
}: {
  title: string;
  description: React.ReactNode;
  filter: Filter;
  filters: Array<{ value: Filter; label: string }>;
  onFilterChange: (next: Filter) => void;
  isLoading: boolean;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <SectionHeader title={title} description={description} />

      <Tabs
        value={filter}
        onValueChange={(value) => onFilterChange(value as Filter)}
      >
        <TabsList>
          {filters.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid gap-3" aria-busy="true" aria-label="Loading queue">
          <Skeleton className="h-9 w-full max-w-sm" />
          <div className="divide-y rounded-lg border">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-4 p-4">
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-9 w-24" />
              </div>
            ))}
          </div>
        </div>
      ) : isEmpty ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia>
              <CircleCheck
                className="text-muted-foreground size-5"
                aria-hidden="true"
              />
            </EmptyMedia>
            <EmptyTitle className="text-base">{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        children
      )}
    </section>
  );
}
