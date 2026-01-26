"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Bell, AlertCircle, AlertTriangle, CircleCheck, Loader2, Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
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
import { createClient } from "@/utils/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useAuth } from "@/hooks/useAuth";
import type { RealtimeChannel } from "@supabase/realtime-js";
import { useInfiniteQuery, type SupabaseQueryHandler } from "@/hooks/use-infinite-query";

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
 * Example: 5 notification inserts in quick succession → 1 loadNotifications call
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
  const supabase = createClient();
  const realtimeClient = supabase as unknown as {
    channel: (name: string) => RealtimeChannel;
    removeChannel: (channel: RealtimeChannel) => Promise<unknown>;
  };
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);

  // Track if we've fetched unread count on initial mount
  const initialFetchDone = React.useRef(false);
  // Stable channel ref to avoid recreating subscriptions
  const channelRef = React.useRef<RealtimeChannel | null>(null);

  const notificationsQueryHandler = useCallback<SupabaseQueryHandler<"notifications">>(
    (query) => {
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
  } = useInfiniteQuery<Notification, "notifications">({
    tableName: "notifications",
    columns: "*",
    pageSize: 10,
    trailingQuery: notificationsQueryHandler,
  });

  useEffect(() => {
    setMounted(true);
  }, []);



  const isReportFeedbackNotification = (notification: Notification) => {
    return notification.data?.modalType === 'report-feedback';
  };

  const isLongNotification = (notification: Notification) => {
    const body = (notification.body || '').trim();
    return body.length > 160 || body.includes('\n');
  };

  const handleLoadMore = useCallback(async () => {
    const currentScrollPos = scrollPositionRef.current;
    await fetchNextPage();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scrollViewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
        if (scrollViewport) {
          scrollViewport.scrollTop = currentScrollPos;
        }
      });
    });
  }, [fetchNextPage]);

  const updateUnreadCount = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("id", { count: 'exact' })
        .eq("read", false)
        .eq("user_id", user.id)
        .limit(1);

      if (error) throw error;
      setUnreadCount(data?.length || 0);
    } catch (error) {
      console.error("Error updating unread count:", error);
    }
  }, [user?.id, supabase]);

  const debouncedUpdateUnreadCount = useDebounce(updateUnreadCount, 300);
  const debouncedUnreadRef = useRef(debouncedUpdateUnreadCount);

  useEffect(() => {
    debouncedUnreadRef.current = debouncedUpdateUnreadCount;
  }, [debouncedUpdateUnreadCount]);

  useEffect(() => {
    if (!user?.id) return;

    if (!initialFetchDone.current) {
      updateUnreadCount();
      initialFetchDone.current = true;
    }

    if (channelRef.current) return;

    const channelName = `notification-popover-${user.id}`;
    const channel = realtimeClient
      .channel(channelName)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          refresh();
          debouncedUnreadRef.current();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        realtimeClient.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, refresh, updateUnreadCount]);

  useEffect(() => {
    if (open && user?.id) {
      refresh();
    }
  }, [open, user?.id, refresh]);

  useEffect(() => {
    if (!open && notifications.length > 0) {
      const unreadNotifications = notifications.filter(n => !n.read);
      if (unreadNotifications.length > 0) {
        markAllAsRead();
      }
    }
  }, [open, notifications]);

  useEffect(() => {
    const scrollViewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
    if (!scrollViewport) return;

    const handleScroll = () => {
      scrollPositionRef.current = scrollViewport.scrollTop;
    };

    scrollViewport.addEventListener('scroll', handleScroll);
    return () => scrollViewport.removeEventListener('scroll', handleScroll);
  }, []);

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

  async function markAllAsRead() {
    if (!user?.id) return;
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("read", false)
        .eq("user_id", user.id);

      if (error) throw error;
      refresh();
      setUnreadCount(0);
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
    }
  }

  async function handleNotificationClick(notification: Notification) {
    if (!notification.read) {
      await markAsRead(notification.id);
    }

    if (isReportFeedbackNotification(notification) || isLongNotification(notification)) {
      setActiveNotification(notification);
      setDetailOpen(true);
      setOpen(false);
      return;
    }

    if (notification.action_url) {
      router.push(notification.action_url);
      setOpen(false);
    }
  }

  const getNotificationIcon = (severity: NotificationSeverity = 'info') => {
    switch (severity) {
      case 'warning':
        return (
          <div className="h-8 w-8 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4 text-warning" />
          </div>
        );
      case 'success':
        return (
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <CircleCheck className="h-4 w-4 text-primary" />
          </div>
        );
      case 'info':
      default:
        return (
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <AlertCircle className="h-4 w-4 text-primary" />
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

  const renderNotificationItem = (notification: Notification) => {
    const showDetails = isReportFeedbackNotification(notification) || isLongNotification(notification);
    const showLink = Boolean(notification.action_url);

    return (
      <div
        key={notification.id}
        className="flex flex-col p-4 hover:bg-accent/50 transition-colors cursor-pointer border-b border-border/50"
        onClick={() => handleNotificationClick(notification)}
      >
        <div className="flex items-start gap-4">
          {getNotificationIcon(notification.severity)}
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start gap-2 mb-0.5">
              <h5 className={`text-sm line-clamp-1 ${!notification.read ? 'font-medium' : 'font-normal'}`}>
                {notification.title}
              </h5>
              <div className="flex items-center gap-2">
                {!notification.read && <div className="h-2 w-2 rounded-full bg-primary"></div>}
                <span className="text-[10px] text-muted-foreground whitespace-nowrap bg-muted/50 px-1.5 py-0.5 rounded-full">
                  {formatTimeAgo(notification.created_at)}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
              {notification.body}
            </p>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                {showDetails && <span className="text-xs text-primary font-medium hover:underline">View details</span>}
                {showLink && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (notification.action_url) {
                        router.push(notification.action_url);
                        setOpen(false);
                      }
                    }}
                  >
                    Open link
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="bg-primary/10 p-4 rounded-full mb-4">
        <Bell className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-sm font-medium mb-2">No notifications</h3>
      <p className="text-xs text-center text-muted-foreground max-w-[220px]">
        When you receive notifications, they will appear here
      </p>
    </div>
  );

  const NotificationsContent = () => (
    <ScrollArea ref={scrollAreaRef} className={cn("h-[400px]", isMobile && "h-[calc(60vh-80px)]")}>
      <div className="px-1">
        {initialLoading ? (
          <div className="flex flex-col justify-center items-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground mt-4">Loading notifications...</p>
          </div>
        ) : notifications.length > 0 ? (
          <div className="space-y-1">
            {notifications.map(renderNotificationItem)}
            {hasMore && (
              <div className="p-3 flex justify-center border-t mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={fetching}
                  className="text-xs"
                >
                  {fetching ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-2" />Loading...</>
                  ) : (
                    'Load more notifications'
                  )}
                </Button>
              </div>
            )}
          </div>
        ) : (
          renderEmptyState()
        )}
      </div>
    </ScrollArea>
  );

  const NotificationButton = (
    <Button variant="ghost" size="icon" className="border relative rounded-full">
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <Badge
          variant="destructive"
          className="absolute top-0 right-0 h-3 w-3 p-0 flex items-center justify-center"
        />
      )}
    </Button>
  );

  const detailMetadata = activeNotification?.data ?? null;
  const detailStatusLabel = typeof detailMetadata?.status === 'string' ? detailMetadata.status.replace(/_/g, ' ') : null;
  const detailSubtitle = activeNotification?.created_at ? `Updated ${formatTimeAgo(activeNotification.created_at)}` : 'Notification details';

  const handleDetailDialogChange = (nextOpen: boolean) => {
    setDetailOpen(nextOpen);
    if (!nextOpen) setActiveNotification(null);
  };

  const detailDialog = (
    <Dialog open={detailOpen} onOpenChange={handleDetailDialogChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{activeNotification?.title ?? 'Notification'}</DialogTitle>
          <DialogDescription>{detailSubtitle}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {detailStatusLabel && (
            <Badge variant="secondary" className="w-fit uppercase">{detailStatusLabel}</Badge>
          )}
          <p className="text-sm text-foreground whitespace-pre-line">{activeNotification?.body}</p>
          {activeNotification?.action_url && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">Related link</p>
              <p className="mt-1 text-xs text-foreground break-all">{activeNotification.action_url}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          {activeNotification?.action_url && (
            <Button
              variant="outline"
              onClick={() => {
                router.push(activeNotification.action_url!);
                handleDetailDialogChange(false);
                setOpen(false);
              }}
            >
              Open link
            </Button>
          )}
          <Button variant="secondary" onClick={() => handleDetailDialogChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="relative h-9 w-9 p-0">
        <Bell className="h-5 w-5" />
      </Button>
    );
  }

  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger render={NotificationButton} />
          <DrawerContent>
            <DrawerHeader className="px-0 pt-0">
              <div className="px-4 py-3 flex justify-between items-center">
                <DrawerTitle className="font-medium">Notifications</DrawerTitle>
                <Button variant="ghost" className="p-2 h-7 w-7" onClick={() => { router.push("/account/notifications"); setOpen(false); }}>
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
              <div className="h-px w-full bg-border"></div>
            </DrawerHeader>
            <div className="pb-6"><NotificationsContent /></div>
          </DrawerContent>
        </Drawer>
        {detailDialog}
      </>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={NotificationButton} />
        <PopoverContent align="end" className="w-[360px] p-0">
          <div className="px-4 py-3 flex justify-between items-center">
            <h3 className="text-sm font-medium">Notifications</h3>
            <Button variant="ghost" className="p-2 h-7 w-7" onClick={() => { router.push("/account/notifications"); setOpen(false); }}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
          <div className="h-px w-full bg-border"></div>
          <NotificationsContent />
        </PopoverContent>
      </Popover>
      {detailDialog}
    </>
  );
}
