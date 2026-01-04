import { Badge } from '@/components/ui/badge';
import { getTimezoneAbbreviation } from '@/utils/timezone';

interface TimezoneBadgeProps {
  timezone: string;
  className?: string;
}

/**
 * Display timezone abbreviation badge (e.g., PST, EST)
 * Shows the timezone in a small, subtle badge
 */
export function TimezoneBadge({ timezone, className = '' }: TimezoneBadgeProps) {
  const abbreviation = getTimezoneAbbreviation(timezone);
  
  return (
    <Badge 
      variant="secondary" 
      className={`text-xs font-normal px-1.5 py-0.5 ${className}`}
    >
      {abbreviation}
    </Badge>
  );
}
