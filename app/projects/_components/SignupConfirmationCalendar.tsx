"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import Image from "next/image";

interface SignupConfirmationCalendarProps {
  calendarConnected: boolean;
  checkingConnection: boolean;
  connectedEmail: string | null;
  connectingCalendar: boolean;
  isLoading: boolean;
  onConnect: () => void;
  onDownloadICal: () => void;
}

export function SignupConfirmationCalendar({
  calendarConnected,
  checkingConnection,
  connectedEmail,
  connectingCalendar,
  isLoading,
  onConnect,
  onDownloadICal,
}: SignupConfirmationCalendarProps) {
  return (
    <div className="space-y-3 border-t pt-3">
      <h4 className="text-text text-sm font-semibold">Add to Calendar</h4>
      {checkingConnection ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking connection...
        </div>
      ) : calendarConnected ? (
        <div className="bg-success/10 border-success/80 flex max-w-md items-center justify-between gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="bg-success/20 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              <Image
                className="h-4 w-4"
                src="/resources/google-calendar-logo-2026.png"
                alt="Google Calendar"
                width={16}
                height={16}
              />
            </div>
            <div className="min-w-0">
              <div className="text-success truncate text-sm font-medium">
                Google Calendar Connected
              </div>
              {connectedEmail ? (
                <div className="text-success/80 truncate text-xs">
                  {connectedEmail}
                </div>
              ) : null}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0"
                  disabled={isLoading}
                  aria-label="Calendar options"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onDownloadICal}>
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Download as iCal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <Button
          variant="outline"
          className="h-auto w-full max-w-md justify-start p-3"
          onClick={onConnect}
          disabled={isLoading || connectingCalendar}
        >
          <div className="flex w-full items-center gap-3">
            {connectingCalendar ? (
              <Loader2
                className="h-5 w-5 shrink-0 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Image
                src="/resources/google-calendar-logo-2026.png"
                alt="Google Calendar"
                width={20}
                height={20}
                className="mr-1 h-5 w-5"
              />
            )}
            <div className="flex-1 text-left">
              <div className="text-sm font-medium">Connect Google Calendar</div>
              <div className="text-muted-foreground text-xs">
                Auto-sync events to your calendar
              </div>
            </div>
          </div>
        </Button>
      )}
    </div>
  );
}
