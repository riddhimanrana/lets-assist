import Image from "next/image";
import Link from "next/link";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

import type { SheetSyncStatus } from "./sheets-actions";
import { getSyncIntervalLabel } from "./sheets/sheet-sync-options";

/**
 * Where the report goes in Google Sheets, at a glance. Admins can sync now and
 * jump to the configuration in settings; staff see the status only.
 */
export function ReportsSheetsStatus({
  sheetStatus,
  isAdmin,
  settingsHref,
  syncing,
  onSyncNow,
}: {
  sheetStatus: SheetSyncStatus | null;
  isAdmin: boolean;
  settingsHref: string;
  syncing: boolean;
  onSyncNow: () => void;
}) {
  if (!sheetStatus) {
    return (
      <Card className="py-0">
        <div
          className="p-4"
          role="status"
          aria-label="Loading Google Sheets status"
        >
          <Skeleton className="h-10 w-full" />
        </div>
      </Card>
    );
  }

  const syncConfig = sheetStatus.syncConfig ?? null;
  const ownerNeedsSheets =
    sheetStatus.connected && sheetStatus.scopesOk === false;
  const needsReconnect =
    Boolean(syncConfig) && (!sheetStatus.connected || ownerNeedsSheets);
  const lastSynced = syncConfig?.lastSyncedAt
    ? format(new Date(syncConfig.lastSyncedAt), "MMM d, yyyy h:mm a")
    : null;

  const description = syncConfig
    ? [
        lastSynced ? `Last synced ${lastSynced}` : "Not synced yet",
        syncConfig.autoSync
          ? `Auto-sync ${getSyncIntervalLabel(syncConfig.syncIntervalMinutes).toLowerCase()}`
          : "Auto-sync off",
        isAdmin && sheetStatus.connectedEmail
          ? sheetStatus.connectedEmail
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : isAdmin
      ? "Send this report to a Google spreadsheet and keep it up to date."
      : "Sheets sync is not set up. Organization admins manage it in settings.";

  return (
    <Card className="py-0">
      <Item>
        <ItemMedia>
          <Image
            src="/resources/google-sheets-logo-2026.png"
            alt=""
            width={33}
            height={24}
            className="h-6 w-auto object-contain"
          />
        </ItemMedia>
        <ItemContent className="min-w-48">
          <ItemTitle className="line-clamp-none flex-wrap">
            {syncConfig
              ? syncConfig.sheetTitle || "Google Sheets"
              : "Google Sheets sync"}
            {syncConfig ? (
              needsReconnect ? (
                <Badge variant="warning">Needs reconnect</Badge>
              ) : (
                <Badge variant="success">Connected</Badge>
              )
            ) : (
              <Badge variant="neutral">Not set up</Badge>
            )}
          </ItemTitle>
          <ItemDescription className="line-clamp-none">
            {description}
            {syncConfig && !isAdmin
              ? " · Managed by organization admins."
              : null}
          </ItemDescription>
        </ItemContent>
        {isAdmin ? (
          <ItemActions className="flex-wrap">
            {syncConfig ? (
              <>
                <Button variant="ghost" asChild>
                  <Link href={settingsHref}>Manage</Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={onSyncNow}
                  disabled={syncing || needsReconnect}
                >
                  <RefreshCw
                    data-icon="inline-start"
                    className={syncing ? "animate-spin" : undefined}
                  />
                  {syncing ? "Syncing..." : "Sync now"}
                </Button>
              </>
            ) : (
              <Button variant="outline" asChild>
                <Link href={settingsHref}>Set up Sheets sync</Link>
              </Button>
            )}
          </ItemActions>
        ) : null}
      </Item>
    </Card>
  );
}
