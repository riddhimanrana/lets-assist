"use client";

import { format } from "date-fns";
import {
  Award,
  BadgeCheck,
  CheckCheck,
  Download,
  ExternalLink,
  Loader2,
} from "lucide-react";

import { SectionHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

import type { MemberEventDetail } from "./member-details-export";
import { formatHours, type MemberHoursPeriod } from "./members-shared";

/** The scrollable content of the member details panel, same at every width. */
export function MemberDetailsBody({
  joinedAt,
  events,
  totalHours,
  loading,
  error,
  dateRange,
  onDateRangeChange,
  isExporting,
  onExport,
}: {
  joinedAt: string;
  events: MemberEventDetail[];
  totalHours: number;
  loading: boolean;
  error: string | null;
  dateRange: MemberHoursPeriod;
  onDateRangeChange: (value: MemberHoursPeriod) => void;
  isExporting: boolean;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-sm">Hours period</span>
        <DateRangePicker
          value={dateRange}
          onChange={onDateRangeChange}
          placeholder={dateRange?.from ? undefined : "Lifetime"}
          showQuickSelect={true}
        />
      </div>

      <StatStrip
        items={[
          {
            label: "Hours",
            value: loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              formatHours(totalHours)
            ),
          },
          {
            label: "Events",
            value: loading ? <Skeleton className="h-7 w-10" /> : events.length,
          },
          {
            label: "Joined",
            value: format(new Date(joinedAt), "MMM yyyy"),
          },
        ]}
      />

      <div className="flex flex-col gap-3">
        <SectionHeader
          title="Event participation"
          actions={
            events.length > 0 ? (
              <Button
                variant="outline"
                onClick={onExport}
                disabled={isExporting}
              >
                {isExporting ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                Export data
              </Button>
            ) : undefined
          }
        />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : events.length > 0 ? (
          <ItemGroup role="list" className="gap-2">
            {events.map((event) => (
              <Item key={event.id} role="listitem" variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>{event.projectTitle}</ItemTitle>
                  <ItemDescription>
                    {format(new Date(event.eventDate), "MMM d, yyyy")} ·{" "}
                    {formatHours(event.hours)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {event.isCertified ? (
                    <Badge variant="success">
                      <BadgeCheck />
                      Certified
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <CheckCheck />
                      Completed
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    nativeButton={false}
                    render={
                      <a
                        href={`/certificates/${event.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View certificate for ${event.projectTitle}`}
                      />
                    }
                  >
                    Certificate
                    <ExternalLink data-icon="inline-end" />
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Award />
              </EmptyMedia>
              <EmptyTitle>No events yet</EmptyTitle>
              <EmptyDescription>
                {dateRange?.from
                  ? "No organization events in this period."
                  : "This member hasn't participated in any organization events."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}
