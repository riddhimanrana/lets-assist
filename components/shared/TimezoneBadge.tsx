import { Badge } from "@/components/ui/badge";
import { getTimezoneAbbreviation } from "@/utils/timezone";

interface TimezoneBadgeProps {
  timezone: string;
  /**
   * When the time being labelled falls: a Date, an ISO timestamp, or a
   * yyyy-MM-dd day. Daylight saving changes the abbreviation, so pass it
   * whenever the badge sits beside an event date.
   */
  date?: Date | string | null;
  className?: string;
}

/**
 * The timezone abbreviation (PST, EST) as a label badge. It says what the
 * time is in, so it is a label, not a status.
 */
export function TimezoneBadge({
  timezone,
  date,
  className,
}: TimezoneBadgeProps) {
  const abbreviation = getTimezoneAbbreviation(timezone, date);

  return (
    <Badge variant="outline" className={className}>
      {abbreviation}
    </Badge>
  );
}
