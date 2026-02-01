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
import { useInfiniteQuery, type SupabaseQueryHandler } from "@/hooks/use-infinite-query";
import { useInView } from "react-intersection-observer";
import { useNotification } from "@/contexts/NotificationContext";

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

export function NotificationPopover() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<Notification | null>(null);

  const { unreadCount, setUnreadCount, refreshTrigger } = useNotification();

  // Use useState to keep supabase client stable across renders for data manipulation
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const scrollAreaRef = useRef<HTMLDivElement>(null);

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

  // Deduplicate notifications
  const uniqueNotifications = React.useMemo(() => {
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

  // Auto-read all notifications when popover opens
  useEffect(() => {
    if (open && unreadCount > 0 && user?.id) {
      const markAllAsRead = async () => {
        try {
          // Optimistic update for UI via Context
          setUnreadCount(0);

          await supabase
            .from("notifications")
            .update({ read: true })
            .eq("user_id", user.id)
            .eq("read", false);

          refresh();
          // Also trigger context to stay in sync if needed, though we just optimistically set it.
          // contextRefresh(); 
        } catch (error) {
          console.error("Error marking all notifications as read:", error);
        }
      };

      // Small delay to ensure user actually saw them
      const timer = setTimeout(markAllAsRead, 1000);
      return () => clearTimeout(timer);
    }
  }, [open, unreadCount, user?.id, refresh, supabase, setUnreadCount]);

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
          <div className="h-6 w-6 rounded-full bg-info/10 flex items-center justify-center shrink-0">
            <AlertCircle className="h-3 w-3 text-info" />
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
                <Button
                  variant="link"
                  className="h-auto p-0 text-xs text-primary hover:underline underline-offset-2 font-medium"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (notification.action_url) {
                      router.push(notification.action_url);
                      setOpen(false);
                      if (!notification.read) {
                        markAsRead(notification.id);
                      }
                    }
                  }}
                >
                  Open link
                </Button>
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
            {uniqueNotifications.map(renderNotificationItem)}

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
    <div className="relative">
      <Bell className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
      {unreadCount > 0 && (
        <Badge
          className="absolute -top-2 -right-2 h-[16px] min-w-[16px] px-1 flex items-center justify-center bg-destructive hover:bg-destructive text-[10px] font-bold border-2rounded-full shadow-sm select-none"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </Badge>
      )}
    </div>
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
