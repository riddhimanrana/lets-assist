import type { ReactNode } from "react";
import { format } from "date-fns";

import { TimezoneBadge } from "@/components/shared/TimezoneBadge";
import { formatSpotsLeft } from "@/lib/projects/availability";
import { formatTimeTo12Hour } from "@/lib/utils";

/** "Saturday, March 14" from a yyyy-MM-dd string, without timezone drift. */
export function formatScheduleDay(dateStr: string) {
  const [year, month, dayNum] = dateStr.split("-").map(Number);
  if (!year || !month || !dayNum) return "Invalid date";
  const date = new Date(year, month - 1, dayNum);
  if (isNaN(date.getTime())) return "Invalid date";
  return format(date, "EEEE, MMMM d");
}

/** "9:00 AM - 12:00 PM", or "TBD" when no start time is set. */
export function formatSlotTimeRange(startTime?: string, endTime?: string) {
  const startLabel = startTime ? formatTimeTo12Hour(startTime) : "TBD";
  const endLabel = endTime ? formatTimeTo12Hour(endTime) : undefined;
  return endLabel ? `${startLabel} - ${endLabel}` : startLabel;
}

/**
 * One schedule slot: what it is, when, how many spots are left, and its one
 * action on the right. The action label carries the slot's state. Pass the
 * slot's day as `date` so the timezone badge shows that season's abbreviation.
 */
export function ProjectSlotRow({
  title,
  timeLabel,
  timezone,
  date,
  remaining,
  capacity,
  action,
  attendees,
}: {
  title?: ReactNode;
  timeLabel: string;
  timezone?: string | null;
  /** The slot's day, yyyy-MM-dd. */
  date?: string | null;
  /** Spots not held by a pending, approved or attended sign-up. */
  remaining: number;
  capacity: number;
  action: ReactNode;
  attendees?: ReactNode;
}) {
  // The wording comes from the shared formatter; only its leading count (or
  // the whole of "Full") is set in the stronger weight.
  const spotsLabel = formatSpotsLeft(remaining, capacity);
  const spotsLead = remaining > 0 ? String(remaining) : spotsLabel;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="grid min-w-40 flex-1 gap-0.5">
          {title ? (
            <p className="text-sm font-medium wrap-break-word">{title}</p>
          ) : null}
          <p
            className={
              title
                ? "text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm"
                : "flex flex-wrap items-center gap-1.5 text-sm font-medium"
            }
          >
            {timeLabel}
            {timezone ? (
              <TimezoneBadge timezone={timezone} date={date} />
            ) : null}
          </p>
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium tabular-nums">
              {spotsLead}
            </span>
            {spotsLabel.slice(spotsLead.length)}
          </p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      {attendees}
    </li>
  );
}
