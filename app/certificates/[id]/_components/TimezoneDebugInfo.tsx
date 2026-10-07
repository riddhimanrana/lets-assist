"use client";
import { safeConsole } from "@/lib/safe-console";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface TimezoneDebugInfoProps {
  show?: boolean;
  className?: string;
}

export function TimezoneDebugInfo({
  show = false,
  className = "",
}: TimezoneDebugInfoProps) {
  const [timezoneInfo, setTimezoneInfo] = useState<{
    timezone: string;
    offset: string;
    locale: string;
    currentTime: string;
    isClient: boolean;
  } | null>(null);

  useEffect(() => {
    try {
      const now = new Date();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const offset = now.getTimezoneOffset();
      const offsetHours = Math.abs(offset / 60);
      const offsetMins = Math.abs(offset % 60);
      const offsetSign = offset <= 0 ? "+" : "-";
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;

      setTimezoneInfo({
        timezone,
        offset: `UTC${offsetSign}${offsetHours.toString().padStart(2, "0")}:${offsetMins.toString().padStart(2, "0")}`,
        locale,
        currentTime: now.toLocaleString(),
        isClient: true,
      });
    } catch (error) {
      safeConsole.error("Error getting timezone info:", error);
      setTimezoneInfo({
        timezone: "Unknown",
        offset: "Unknown",
        locale: "Unknown",
        currentTime: "Unknown",
        isClient: false,
      });
    }
  }, []);

  if (!show || !timezoneInfo) return null;

  const rows = [
    ["Timezone", timezoneInfo.timezone],
    ["Offset", timezoneInfo.offset],
    ["Current time", timezoneInfo.currentTime],
    ["Locale", timezoneInfo.locale],
    ["Client-side", timezoneInfo.isClient ? "Yes" : "No"],
  ];

  return (
    <Alert variant="warning" className={className}>
      <AlertTitle>Timezone debug info</AlertTitle>
      <AlertDescription>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd className="text-foreground font-mono tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </AlertDescription>
    </Alert>
  );
}
