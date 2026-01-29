"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Bell, AlertCircle, AlertTriangle, CircleCheck, Loader2, Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useAuth } from "@/hooks/useAuth";
import type { RealtimeChannel } from "@supabase/realtime-js";
import { useInfiniteQuery, type SupabaseQueryHandler } from "@/hooks/use-infinite-query";
import { useInView } from "react-intersection-observer";

type NotificationSeverity = 'info' | 'warning' | 'success';

type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  severity: NotificationSeverity;
  read: boolean;
  created_at: string;
  action_url?: string | null;
  data?: Record<string, unknown> | null;
};

/**
 * Debounce hook: delays execution of a callback until specified ms have passed
 * without any new calls. Useful for batching rapid realtime events.
 */
function useDebounce<T extends (...args: unknown[]) => void>(
  callback: T,
  delayMs: number = 500
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
        timeoutRef.current = null;
      }, delayMs);
    },
    [callback, delayMs]
  );
}

export function NotificationPopover() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<Notification | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  // Use useState to keep supabase client stable across renders
  const [supabase] = useState(() => createClient());
  const realtimeClient = supabase as unknown as {
    channel: (name: string) => RealtimeChannel;
    removeChannel: (channel: RealtimeChannel) => Promise<unknown>;
  };
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);

  // Track if we've fetched unread count on initial mount
  const initialFetchDone = useRef(false);
  // Stable channel ref to avoid recreating subscriptions
  const channelRef = useRef<RealtimeChannel | null>(null);

  const notificationsQueryHandler = useCallback<SupabaseQueryHandler<"notifications">>(
    (query) => {
      // Should not happen if enabled={!!user?.id}, but safe guard
      if (!user?.id) return query;
      return query.eq("user_id", user.id).order("created_at", { ascending: false });
    },
    [user?.id]
  );

  const {
    data: notifications,
    isLoading: initialLoading,
    isFetching: fetching,
    hasMore,
    fetchNextPage,
    refresh,
    error: queryError
  } = useInfiniteQuery<Notification, "notifications">({
    tableName: "notifications",
    columns: "*",
    pageSize: 10,
    trailingQuery: notificationsQueryHandler,
    enabled: !!user?.id,
    client: supabase, // Pass the authenticated client
  });

  useEffect(() => {
    if (queryError) {
      console.error("NotificationPopover: Error fetching notifications", queryError);
    }
  }, [queryError]);

  const { ref: loadMoreRef, inView } = useInView();

  useEffect(() => {
    if (inView && hasMore && !fetching) {
      fetchNextPage();
    }
  }, [inView, hasMore, fetching, fetchNextPage]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch initial unread count on mount
  useEffect(() => {
    if (!user?.id || initialFetchDone.current) return;
    initialFetchDone.current = true;

    const fetchUnreadCount = async () => {
      try {
        const { count, error } = await supabase
          .from("notifications")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("read", false);

        if (error) {
          console.error("Error fetching unread count:", error);
          return;
        }

        setUnreadCount(count ?? 0);
      } catch (error) {
        console.error("Error fetching unread count:", error);
      }
    };

    fetchUnreadCount();
  }, [user?.id, supabase]);

  // Subscribe to realtime notifications for unread count updates
  useEffect(() => {
    if (!user?.id) return;

    const channelName = `notification-count:${user.id}`;

    // Clean up existing channel
    if (channelRef.current) {
      realtimeClient.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = realtimeClient
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // New notification arrived - increment count if popover is closed
          if (!open) {
            setUnreadCount((prev) => prev + 1);
          }
          // Refresh the notifications list
          refresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Notification was updated (e.g., marked as read) - refresh
          refresh();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("Subscribed to notification count updates");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Notification subscription error:", status);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        realtimeClient.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, realtimeClient, refresh, open]);

  // Auto-read all notifications when popover opens
  useEffect(() => {
    if (open && unreadCount > 0 && user?.id) {
      const markAllAsRead = async () => {
        try {
          // Optimistic update for UI
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

      // Small delay to ensure user actually saw them
      const timer = setTimeout(markAllAsRead, 1000);
      return () => clearTimeout(timer);
    }
  }, [open, unreadCount, user?.id, refresh, supabase]);

  const isReportFeedbackNotification = (notification: Notification) => {
    return notification.data?.modalType === 'report-feedback';
  };

  const isLongNotification = (notification: Notification) => {
    const body = (notification.body || '').trim();
    return body.length > 160 || body.includes('\n');
  };

  async function markAsRead(id: string) {
    try {
      await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", id);
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

  const getNotificationIcon = (severity: NotificationSeverity = 'info') => {
    switch (severity) {
      case 'warning':
        return (
          <div className="h-6 w-6 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-3 w-3 text-warning" />
          </div>
        );
      case 'success':
        return (
          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <CircleCheck className="h-3 w-3 text-primary" />
          </div>
        );
      case 'info':
      default:
        return (
          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <AlertCircle className="h-3 w-3 text-primary" />
          </div>
        );
    }
  };

  const formatTimeAgo = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const formatted = formatDistanceToNow(date, { addSuffix: true });
      return formatted
        .replace(/about /g, '')
        .replace(/less than a minute ago/g, 'just now')
        .replace(/ minutes? ago/g, 'm ago')
        .replace(/ hours? ago/g, 'h ago')
        .replace(/ days? ago/g, 'd ago')
        .replace(/ weeks? ago/g, 'w ago')
        .replace(/ months? ago/g, 'mo ago')
        .replace(/ years? ago/g, 'y ago');
    } catch {
      return "recently";
    }
  };

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="bg-muted/40 p-3 rounded-full mb-3">
        <Bell className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <p className="text-sm text-muted-foreground font-medium">No notifications yet</p>
    </div>
  );

  const renderNotificationItem = (notification: Notification) => {
    // We show "Open link" if there is an action URL, regardless of other conditions
    const showLink = Boolean(notification.action_url);

    return (
      <div
        key={notification.id}
        className={cn(
          "flex flex-col p-4 transition-all cursor-pointer relative group border-l-2",
          !notification.read
            ? "bg-primary/[0.03] border-l-primary hover:bg-primary/[0.06]"
            : "bg-transparent border-l-transparent hover:bg-muted/40"
        )}
        onClick={() => handleNotificationClick(notification)}
      >
        <div className="flex items-start gap-3">
          {getNotificationIcon(notification.severity)}
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start gap-2 mb-1">
              <h5 className={cn(
                "text-sm line-clamp-1 leading-none pt-0.5",
                !notification.read ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'
              )}>
                {notification.title}
              </h5>
              <span className="text-xs text-muted-foreground/70 whitespace-nowrap">
                {formatTimeAgo(notification.created_at)}
              </span>
            </div>
            <p className={cn(
              "text-xs line-clamp-2 leading-relaxed mb-1",
              !notification.read ? "text-foreground/80" : "text-muted-foreground/80"
            )}>
              {notification.body}
            </p>
            {showLink && (
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs text-primary hover:underline underline-offset-2 font-medium">
                  Open link
                </span>
              </div>
            )}
          </div>
          {!notification.read && (
            <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-1.5 animate-pulse" />
          )}
        </div>
      </div>
    );
  };

  const renderNotificationsContent = () => (
    <div className="flex flex-col w-full overflow-hidden">
      <div className="px-4 py-3 border-b flex justify-between items-center gap-4 bg-muted/5">
        <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 rounded-full"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            router.push("/account/notifications");
          }}
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea ref={scrollAreaRef} className={cn("h-[420px]", isMobile && "h-[calc(80vh-100px)]")}>
        {initialLoading ? (
          <div className="flex flex-col justify-center items-center py-20">
            <Loader2 className="h-7 w-7 animate-spin text-primary/40" />
          </div>
        ) : notifications.length > 0 ? (
          <div className="flex flex-col divide-y divide-border/40">
            {notifications.map(renderNotificationItem)}

            {/* Infinite scroll trigger */}
            {hasMore && (
              <div ref={loadMoreRef} className="py-6 flex justify-center w-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
              </div>
            )}
          </div>
        ) : (
          renderEmptyState()
        )}
      </ScrollArea>
    </div>
  );

  const notificationTriggerContent = (
    <>
      <Bell className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
      {unreadCount > 0 && (
        <Badge
          className="absolute -top-0.5 -right-0.5 h-4 w-4 p-0 flex items-center justify-center bg-destructive text-[10px] border-2 border-background"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </Badge>
      )}
    </>
  );

  const triggerClasses = "relative rounded-full h-9 w-9 inline-flex items-center justify-center hover:bg-muted/50 transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  const detailMetadata = activeNotification?.data ?? null;
  const detailStatusLabel = typeof detailMetadata?.status === 'string' ? detailMetadata.status.replace(/_/g, ' ') : null;
  const detailSubtitle = activeNotification?.created_at ? `Updated ${formatTimeAgo(activeNotification.created_at)}` : 'Notification details';

  const handleDetailDialogChange = (nextOpen: boolean) => {
    setDetailOpen(nextOpen);
    if (!nextOpen) setActiveNotification(null);
  };

  const detailDialog = (
    <Dialog open={detailOpen} onOpenChange={handleDetailDialogChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{activeNotification?.title ?? 'Notification'}</DialogTitle>
          <DialogDescription>{detailSubtitle}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {detailStatusLabel && (
            <Badge variant="secondary" className="uppercase tracking-wider font-semibold text-[10px] py-0.5">{detailStatusLabel}</Badge>
          )}
          <div className="text-sm text-foreground/90 whitespace-pre-line leading-relaxed bg-muted/30 p-4 rounded-xl border border-border/50">
            {activeNotification?.body}
          </div>
          {/* Note: User asked for "Link stuff" to be in modal. We keep the Open Link button. 
              The text display of raw link is often ugly/unnecessary if we have a button, 
              but I'll keep it as a fallback or context if they want validation. 
              Refining it slightly. */}
          {activeNotification?.action_url && (
            <div className="rounded-xl border bg-muted/40 p-3 flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Related URL</p>
              <p className="text-xs text-foreground break-all font-mono opacity-80">{activeNotification.action_url}</p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => handleDetailDialogChange(false)} className="rounded-full">Close</Button>
          {activeNotification?.action_url && (
            <Button
              className="rounded-full"
              onClick={() => {
                router.push(activeNotification.action_url!);
                handleDetailDialogChange(false);
                setOpen(false);
              }}
            >
              Open Link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="relative h-9 w-9 p-0 rounded-full border">
        <Bell className="h-5 w-5 text-muted-foreground" />
      </Button>
    );
  }

  const NotificationTrigger = (
    <Button className={triggerClasses} variant="ghost">
      {notificationTriggerContent}
    </Button>
  );

  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>
            {NotificationTrigger}
          </DrawerTrigger>
          <DrawerContent className="max-h-[85vh] p-0">
            {renderNotificationsContent()}
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
        <PopoverContent align="end" className="w-[380px] p-0 overflow-hidden shadow-2xl border-border/60 rounded-2xl">
          {renderNotificationsContent()}
        </PopoverContent>
      </Popover>
      {detailDialog}
    </>
  );
}
