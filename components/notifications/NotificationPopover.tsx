"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { useRouter } from "next/navigation";
import { useInView } from "react-intersection-observer";

import { BellIcon, XIcon, useAnimatedIcon } from "@/components/icons/animated";
import { useNotification } from "@/components/providers/NotificationContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  useInfiniteQuery,
  type SupabaseQueryHandler,
} from "@/hooks/use-infinite-query";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";

import { NotificationDetailDialog } from "./NotificationDetailDialog";
import { NotificationInbox } from "./NotificationInbox";
import type { Notification } from "./notification-format";
import { resolveNotificationAction } from "./notification-action-url";

/** Drawer below this width, Popover above it. */
export const NOTIFICATION_MOBILE_MEDIA_QUERY = "(max-width: 768px)";
/** Exact complement of Navbar's `lg:` split, i.e. which container is visible. */
export const NOTIFICATION_DESKTOP_NAV_MEDIA_QUERY = "(min-width: 1024px)";

/**
 * Navbar mounts one NotificationPopover per responsive container, so each
 * instance has to be told which container it lives in. Without that contract
 * both instances resolve the same media query, both pick the same surface, and
 * the copy the parent hides with CSS stays mounted, focusable and querying.
 */
export type NotificationViewport = "mobile" | "desktop";

export type NotificationSurface = "placeholder" | "drawer" | "popover" | "none";

/**
 * Resolves what a single instance may render. Ownership follows the navbar
 * breakpoint so exactly the visible container renders a trigger, while the
 * drawer/popover choice keeps its own narrower breakpoint. Before the media
 * queries hydrate neither instance owns the active mode, so both fall back to
 * the inert placeholder that matches the server HTML.
 */
export function resolveNotificationSurface({
  viewport,
  mounted,
  isDesktopNav,
  isMobile,
}: {
  viewport: NotificationViewport;
  mounted: boolean;
  isDesktopNav: boolean;
  isMobile: boolean;
}): NotificationSurface {
  if (!mounted) return "placeholder";
  if (viewport !== (isDesktopNav ? "desktop" : "mobile")) return "none";
  return isMobile ? "drawer" : "popover";
}

export function isActiveNotificationSurface(
  surface: NotificationSurface,
): boolean {
  return surface === "drawer" || surface === "popover";
}

export function NotificationPopover({
  viewport,
}: {
  viewport: NotificationViewport;
}) {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeNotification, setActiveNotification] =
    useState<Notification | null>(null);

  const { unreadCount, setUnreadCount, refreshTrigger } = useNotification();

  // Use useState to keep supabase client stable across renders for data manipulation
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const bellIcon = useAnimatedIcon();
  const closeIcon = useAnimatedIcon();
  const isMobile = useMediaQuery(NOTIFICATION_MOBILE_MEDIA_QUERY);
  const isDesktopNav = useMediaQuery(NOTIFICATION_DESKTOP_NAV_MEDIA_QUERY);
  const surface = resolveNotificationSurface({
    viewport,
    mounted,
    isDesktopNav,
    isMobile,
  });
  const isActiveSurface = isActiveNotificationSurface(surface);

  const notificationsQueryHandler = useCallback<
    SupabaseQueryHandler<"notifications">
  >(
    (query) => {
      // Should not happen if enabled={!!user?.id}, but safe guard
      if (!user?.id) return query;
      return query
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
    },
    [user?.id],
  );

  const {
    data: notifications,
    isLoading: initialLoading,
    isFetching: fetching,
    hasMore,
    fetchNextPage,
    refresh,
    error: queryError,
  } = useInfiniteQuery<Notification, "notifications">({
    tableName: "notifications",
    columns: "*",
    pageSize: 10,
    trailingQuery: notificationsQueryHandler,
    // The instance that does not own the active viewport never renders, so it
    // must not fetch notifications either.
    enabled: !!user?.id && isActiveSurface,
    client: supabase, // Pass the authenticated client
  });

  useEffect(() => {
    if (queryError) {
      console.error(
        "NotificationPopover: Error fetching notifications",
        queryError,
      );
    }
  }, [queryError]);

  const { ref: loadMoreRef, inView } = useInView();

  useEffect(() => {
    if (inView && hasMore && !fetching) {
      fetchNextPage();
    }
  }, [inView, hasMore, fetching, fetchNextPage]);

  // Deduplicate notifications
  const uniqueNotifications = useMemo(() => {
    const seen = new Set();
    return notifications.filter((n) => {
      const duplicate = seen.has(n.id);
      seen.add(n.id);
      return !duplicate;
    });
  }, [notifications]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync infinite query with context refresh trigger
  useEffect(() => {
    if (refreshTrigger > 0) {
      refresh();
    }
  }, [refreshTrigger, refresh]);

  // Reading is explicit: a row is marked when it is opened, and the header
  // action clears the rest. Opening the inbox alone leaves unread rows unread.
  const markAllAsRead = async () => {
    if (!user?.id) return;
    try {
      // Optimistic update for UI via Context
      setUnreadCount(0);

      await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", user.id)
        .eq("read", false);

      refresh();
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
    }
  };

  async function markAsRead(id: string) {
    try {
      // The realtime UPDATE re-reads the true count; this keeps the bell honest
      // in the meantime.
      setUnreadCount((count) => Math.max(0, count - 1));
      await supabase.from("notifications").update({ read: true }).eq("id", id);
      refresh();
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  }

  async function handleNotificationClick(notification: Notification) {
    if (!notification.read) {
      await markAsRead(notification.id);
    }

    // Always open details dialog first
    setActiveNotification(notification);
    setDetailOpen(true);
    setOpen(false);
  }

  function followNotificationAction(notification: Notification) {
    const target = resolveNotificationAction(
      notification.action_url,
      window.location.origin,
    );
    if (!target) return false;
    if (target.kind === "internal") {
      router.push(target.href);
    } else {
      window.open(target.href, "_blank", "noopener,noreferrer");
    }
    return true;
  }

  function handleNotificationAction(notification: Notification) {
    if (!followNotificationAction(notification)) return;
    setOpen(false);
    if (!notification.read) {
      markAsRead(notification.id);
    }
  }

  const handleDetailDialogChange = (nextOpen: boolean) => {
    setDetailOpen(nextOpen);
    if (!nextOpen) setActiveNotification(null);
  };

  const detailDialog = (
    <NotificationDetailDialog
      notification={activeNotification}
      open={detailOpen}
      onOpenChange={handleDetailDialogChange}
      onAction={(notification) => {
        if (!followNotificationAction(notification)) return;
        handleDetailDialogChange(false);
        setOpen(false);
      }}
    />
  );

  if (surface === "placeholder") {
    // Matches the server HTML in both responsive containers so hydration stays
    // clean, but is never focusable — the two containers must not contribute
    // two tab stops while the media query is still unresolved.
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        aria-disabled="true"
        tabIndex={-1}
      >
        <BellIcon size={16} aria-hidden="true" />
      </Button>
    );
  }

  if (surface === "none") {
    return null;
  }

  const NotificationTrigger = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Notifications"
      className="relative"
      {...bellIcon.triggerProps}
    >
      <BellIcon ref={bellIcon.ref} size={16} aria-hidden="true" />
      {unreadCount > 0 && (
        <Badge
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 tabular-nums"
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </Badge>
      )}
    </Button>
  );

  const renderInbox = (fill: boolean) => (
    <NotificationInbox
      notifications={uniqueNotifications}
      unreadCount={unreadCount}
      isLoading={initialLoading}
      hasError={Boolean(queryError)}
      hasMore={hasMore}
      loadMoreRef={loadMoreRef}
      onRetry={refresh}
      onMarkAllRead={markAllAsRead}
      onOpenSettings={() => {
        setOpen(false);
        router.push("/account/notifications");
      }}
      onSelect={handleNotificationClick}
      onAction={handleNotificationAction}
      fill={fill}
      headerEnd={
        fill ? (
          <DrawerClose asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close notifications"
              {...closeIcon.triggerProps}
            >
              <XIcon ref={closeIcon.ref} size={16} aria-hidden="true" />
            </Button>
          </DrawerClose>
        ) : null
      }
    />
  );

  if (surface === "drawer") {
    // On phones the inbox is a near full-height sheet rather than a short tray.
    return (
      <>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>{NotificationTrigger}</DrawerTrigger>
          <DrawerContent className="h-[calc(100dvh-1.5rem)] data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-1.5rem)]">
            <VisuallyHidden.Root>
              <DrawerTitle>Notifications</DrawerTitle>
            </VisuallyHidden.Root>
            {renderInbox(true)}
          </DrawerContent>
        </Drawer>
        {detailDialog}
      </>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={NotificationTrigger} />
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-96 gap-0 overflow-hidden rounded-xl p-0"
        >
          {renderInbox(false)}
        </PopoverContent>
      </Popover>
      {detailDialog}
    </>
  );
}
