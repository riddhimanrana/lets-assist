import { format as formatDate, parseISO } from "date-fns";
import { tz } from "@date-fns/tz";
import {
  certificateTimezone,
  formatCertificateDate,
  formatCertificateTime,
} from "@/lib/certificates/project-dates";

interface TimezoneDateDisplayProps {
  dateString: string;
  format: string;
  timeZone?: string | null;
  className?: string;
  fallbackText?: string;
}

/** Certificate dates use the recorded zone on both server and client. */
export function TimezoneDateDisplay({
  dateString,
  format,
  timeZone,
  className = "",
  fallbackText = "Unknown date",
}: TimezoneDateDisplayProps) {
  let formattedDate = fallbackText;
  try {
    const zone = certificateTimezone(timeZone);
    const date = parseISO(dateString);
    formattedDate = formatDate(date, format, {
      in: tz(zone),
    });
    if (format.includes("h") || format.includes("H")) {
      const abbreviation = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "short",
      })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value;
      if (abbreviation) formattedDate += ` ${abbreviation}`;
    }
  } catch {
    // Invalid historical dates retain the supplied readable fallback.
  }
  return <span className={className}>{formattedDate}</span>;
}

interface TimezoneEventDateRangeProps {
  startDate: string;
  endDate: string;
  timeZone?: string | null;
  className?: string;
}

export function TimezoneEventDateRange({
  startDate,
  endDate,
  timeZone,
  className = "",
}: TimezoneEventDateRangeProps) {
  const endpoint = (date: string) =>
    `${formatCertificateDate(date, timeZone, "display")} • ${formatCertificateTime(date, timeZone)}`;
  return (
    <div className={className}>
      <p className="font-medium tabular-nums">{endpoint(startDate)}</p>
      <p className="text-muted-foreground text-sm tabular-nums">
        to {endpoint(endDate)}
      </p>
    </div>
  );
}

interface TimezonePrintEventDateProps {
  startDate: string;
  timeZone?: string | null;
  className?: string;
}

export function TimezonePrintEventDate({
  startDate,
  timeZone,
  className = "",
}: TimezonePrintEventDateProps) {
  return (
    <TimezoneDateDisplay
      dateString={startDate}
      format="MMMM d, yyyy"
      timeZone={timeZone}
      className={className}
    />
  );
}
