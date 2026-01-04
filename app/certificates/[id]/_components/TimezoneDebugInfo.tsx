"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Globe, Info } from "lucide-react";

interface TimezoneDebugInfoProps {
  show?: boolean;
  className?: string;
}

export function TimezoneDebugInfo({ show = false, className = "" }: TimezoneDebugInfoProps) {
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
      const offsetSign = offset <= 0 ? '+' : '-';
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;

      setTimezoneInfo({
        timezone,
        offset: `UTC${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMins.toString().padStart(2, '0')}`,
        locale,
        currentTime: now.toLocaleString(),
        isClient: true,
      });
    } catch (error) {
      console.error("Error getting timezone info:", error);
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

  return (
    <Card className={`${className} border-dashed border-amber-200 bg-amber-50/50 dark:bg-amber-950/20`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-2">
          <Info className="h-4 w-4" />
          Timezone Debug Info
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-medium">Timezone:</span>
          <Badge variant="outline" className="text-xs">
            {timezoneInfo.timezone}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-medium">Offset:</span>
          <Badge variant="outline" className="text-xs">
            {timezoneInfo.offset}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Current Time:</span>
          <code className="text-xs bg-amber-100 dark:bg-amber-900/50 px-2 py-1 rounded">
            {timezoneInfo.currentTime}
          </code>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Locale:</span>
          <Badge variant="outline" className="text-xs">
            {timezoneInfo.locale}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Client-side:</span>
          <Badge variant={timezoneInfo.isClient ? "default" : "destructive"} className="text-xs">
            {timezoneInfo.isClient ? "Yes" : "No"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
