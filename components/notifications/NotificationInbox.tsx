"use client";

import { useEffect, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import {
  BellIcon,
  SettingsIcon,
  useAnimatedIcon,
} from "@/components/icons/animated";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { notificationActionLabel } from "@/services/notification-action-label";

import { formatTimeAgo, type Notification } from "./notification-format";
import { readableNotificationText } from "./notification-text";

type Props = {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  hasError: boolean;
  hasMore: boolean;
  loadMoreRef: (node?: Element | null) => void;
  onRetry: () => void;
  onMarkAllRead: () => void;
  onOpenSettings: () => void;
  onSelect: (notification: Notification) => void;
  onAction: (notification: Notification) => void;
  /** The drawer fills its sheet; the popover keeps a fixed list height. */
  fill?: boolean;
  /** Extra header control, such as the drawer's close button. */
  headerEnd?: ReactNode;
};

export function NotificationInbox({
  notifications,
  unreadCount,
  isLoading,
  hasError,
  hasMore,
  loadMoreRef,
  onRetry,
  onMarkAllRead,
  onOpenSettings,
  onSelect,
  onAction,
  fill = false,
  headerEnd,
}: Props) {
  const settingsIcon = useAnimatedIcon();

  return (
    <div className={cn("flex w-full flex-col", fill && "min-h-0 flex-1")}>
      <div className="flex h-14 shrink-0 items-center gap-1 border-b pr-2 pl-4">
        <h2 className="text-base font-semibold">Notifications</h2>
        {unreadCount > 0 ? (
          <Badge
            variant="secondary"
            className="ml-1 tabular-nums"
            aria-label={`${unreadCount} unread`}
          >
            {unreadCount}
          </Badge>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-9"
          onClick={onMarkAllRead}
          disabled={unreadCount === 0}
        >
          Mark all as read
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notification settings"
          onClick={onOpenSettings}
          {...settingsIcon.triggerProps}
        >
          <SettingsIcon ref={settingsIcon.ref} size={16} aria-hidden="true" />
        </Button>
        {headerEnd}
      </div>

      <ScrollArea className={fill ? "min-h-0 flex-1" : "h-105"}>
        {isLoading ? (
          <ul aria-label="Loading notifications" className="divide-y">
            {Array.from({ length: 5 }, (_, index) => (
              <SkeletonRow key={index} />
            ))}
          </ul>
        ) : notifications.length > 0 ? (
          <ul className="divide-y">
            {notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onSelect={onSelect}
                onAction={onAction}
              />
            ))}
            {hasMore ? <SkeletonRow ref={loadMoreRef} /> : null}
          </ul>
        ) : hasError ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Couldn't load notifications</AlertTitle>
              <AlertDescription>
                Check your connection and try again.
              </AlertDescription>
            </Alert>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : (
          <EmptyInbox />
        )}
      </ScrollArea>
    </div>
  );
}

function NotificationRow({
  notification,
  onSelect,
  onAction,
}: {
  notification: Notification;
  onSelect: (notification: Notification) => void;
  onAction: (notification: Notification) => void;
}) {
  const unread = !notification.read;

  return (
    <li className="relative flex gap-3 py-3 pr-4 pl-3 hover:bg-muted has-[[data-row-target]:focus-visible]:bg-muted">
      {/* The dot is the only unread signal; its column stays reserved so titles align. */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {notification.severity === "warning" ? (
            <AlertTriangle
              aria-hidden="true"
              className="size-4 shrink-0 text-warning"
            />
          ) : null}
          {/* The title is the row's button; its ::after stretches over the whole row. */}
          <button
            type="button"
            data-row-target=""
            className="min-w-0 flex-1 truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
            onClick={() => onSelect(notification)}
          >
            {unread ? <span className="sr-only">Unread. </span> : null}
            {notification.severity === "warning" ? (
              <span className="sr-only">Warning. </span>
            ) : null}
            {notification.title}
          </button>
          <time
            dateTime={notification.created_at}
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
          >
            {formatTimeAgo(notification.created_at)}
          </time>
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
          {readableNotificationText(notification.body)}
        </p>
        {notification.action_url ? (
          <Button
            variant="link"
            className="relative z-10 -mb-2 px-0"
            onClick={() => onAction(notification)}
          >
            {notificationActionLabel(notification.data)}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function SkeletonRow({ ref }: { ref?: (node?: Element | null) => void }) {
  return (
    <li ref={ref} aria-hidden="true" className="flex gap-3 py-3 pr-4 pl-3">
      <span className="size-2 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-6">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/5" />
      </div>
    </li>
  );
}

function EmptyInbox() {
  const icon = useAnimatedIcon();
  const play = icon.triggerProps.onMouseEnter;

  // Empty-state icons play once when they appear, never on a loop.
  useEffect(() => {
    play();
  }, [play]);

  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BellIcon ref={icon.ref} size={20} aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-base">No notifications yet</EmptyTitle>
        <EmptyDescription>New notifications will appear here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
