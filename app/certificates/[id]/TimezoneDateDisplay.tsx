"use client";

import { useEffect, useState } from "react";
import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

interface TimezoneDateDisplayProps {
  dateString: string;
  format: string;
  className?: string;
  fallbackText?: string;
}

export function TimezoneDateDisplay({
  dateString,
  format,
  className = "",
  fallbackText = "Loading...",
}: TimezoneDateDisplayProps) {
  const [formattedDate, setFormattedDate] = useState<string>(fallbackText);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    try {
      // Get user's timezone
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Format the date in user's timezone
      const formatted = formatInTimeZone(
        parseISO(dateString),
        userTimezone,
        format,
      );

      setFormattedDate(formatted);
    } catch (error) {
      console.error("Error formatting date:", error);
      // Fallback to UTC if timezone conversion fails
      setFormattedDate(fallbackText);
    }
  }, [dateString, format, fallbackText]);

  if (!isClient) {
    return <span className={className}>{fallbackText}</span>;
  }

  return <span className={className}>{formattedDate}</span>;
}

interface TimezoneEventDateRangeProps {
  startDate: string;
  endDate: string;
  className?: string;
}

export function TimezoneEventDateRange({
  startDate,
  endDate,
  className = "",
}: TimezoneEventDateRangeProps) {
  const [formattedDates, setFormattedDates] = useState<{
    start: string;
    end: string;
  }>({
    start: "Loading...",
    end: "Loading...",
  });
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    try {
      // Get user's timezone
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Format both dates in user's timezone
      const formattedStart = formatInTimeZone(
        parseISO(startDate),
        userTimezone,
        "MMM d, yyyy • h:mm a",
      );

      const formattedEnd = formatInTimeZone(
        parseISO(endDate),
        userTimezone,
        "MMM d, yyyy • h:mm a",
      );

      setFormattedDates({
        start: formattedStart,
        end: formattedEnd,
      });
    } catch (error) {
      console.error("Error formatting dates:", error);
      setFormattedDates({
        start: "Error loading date",
        end: "Error loading date",
      });
    }
  }, [startDate, endDate]);

  if (!isClient) {
    return (
      <div className={className}>
        <p className="text-base font-semibold mt-0.5">Loading...</p>
        <p className="text-xs text-muted-foreground">to Loading...</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="text-base font-semibold mt-0.5">{formattedDates.start}</p>
      <p className="text-xs text-muted-foreground">to {formattedDates.end}</p>
    </div>
  );
}

interface TimezonePrintEventDateProps {
  startDate: string;
  className?: string;
}

export function TimezonePrintEventDate({
  startDate,
  className = "",
}: TimezonePrintEventDateProps) {
  const [formattedDate, setFormattedDate] = useState<string>("Loading...");
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    try {
      // Get user's timezone
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Format the date in user's timezone
      const formatted = formatInTimeZone(
        parseISO(startDate),
        userTimezone,
        "MMMM d, yyyy",
      );

      setFormattedDate(formatted);
    } catch (error) {
      console.error("Error formatting date:", error);
      setFormattedDate("Error loading date");
    }
  }, [startDate]);

  if (!isClient) {
    return <span className={className}>Loading...</span>;
  }

  return <span className={className}>{formattedDate}</span>;
}
