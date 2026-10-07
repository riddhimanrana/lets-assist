import { Badge } from "@/components/ui/badge";
import { getTimezoneAbbreviation } from "@/utils/timezone";

interface TimezoneBadgeProps {
  timezone: string;
  className?: string;
}

/**
 * The timezone abbreviation (PST, EST) as a label badge. It says what the
 * time is in, so it is a label, not a status.
 */
export function TimezoneBadge({ timezone, className }: TimezoneBadgeProps) {
  const abbreviation = getTimezoneAbbreviation(timezone);

  return (
    <Badge variant="outline" className={className}>
      {abbreviation}
    </Badge>
  );
}
