"use client";

import React, { useState, useEffect } from "react";
import { Bell, AlertCircle, AlertTriangle, CircleCheck, Loader2, Check, Settings } from "lucide-react";
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
  data?: Record<string, any> | null;
};

export function NotificationPopover() {
  const { user } = useAuth(); // Use centralized auth hook
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<Notification | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const supabase = createClient();
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 768px)");

  const parseNotificationData = (value: unknown): Record<string, any> | null => {
    if (!value) return null;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (typeof value === "object") {
      return value as Record<string, any>;
    }
    return null;
  };

  const isReportFeedbackNotification = (notification: Notification) => {
    return notification.data?.modalType === 'report-feedback';
  };
  
  useEffect(() => {
    if (!user?.id) return; // Wait for user to be available
    
    if (open) {
      loadNotifications();
    }
    
    // Setup realtime subscription using user from auth hook
    const channelName = `notification-popover-${user.id}-${Date.now()}`;
    console.log(`Setting up notification badge channel: ${channelName}`);
    
    // Update unread count on component load
    updateUnreadCount();
    
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', 
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`
        }, 
        (payload) => {
          console.log('Notification badge update event:', payload.eventType);
          if (open) {
            loadNotifications();
          } else {
            updateUnreadCount();
          }
        }
      )
      .subscribe(status => {
        console.log(`Badge notification channel status: ${status}`);
      });
    
    // Cleanup function
    return () => {
      console.log('Removing notification badge channel');
      supabase.removeChannel(channel);
    };
  }, [user?.id, open]);

  // Auto mark all notifications as read when the popover closes and there are unread notifications
  useEffect(() => {
    if (!open && notifications.length > 0) {
      const unreadNotifications = notifications.filter(n => !n.read);
      if (unreadNotifications.length > 0) {
        markAllAsRead();
      }
    }
  }, [open, notifications]);

  async function loadNotifications() {
    if (!user?.id) return;
    setLoading(true);
    
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
        
      if (error) {
        console.error("Error loading notifications:", error);
        throw error;
      }
      
      console.log('Notifications loaded:', data);
      const normalized = (data || []).map((notification) => ({
        ...notification,
        data: parseNotificationData((notification as any).data),
      }));
      setNotifications(normalized as Notification[]);
    } catch (error) {
      console.error("Error loading notifications:", error);
    } finally {
      setLoading(false);
    }
  }

  async function markAsRead(id: string) {
    try {
      await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", id);
        
      setNotifications(notifications.map(n => 
        n.id === id ? { ...n, read: true } : n
      ));
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
      
      setNotifications(notifications.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
    }
  }

  async function handleNotificationClick(notification: Notification) {
    if (!notification.read) {
      await markAsRead(notification.id);
    }

    if (isReportFeedbackNotification(notification)) {
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

  async function updateUnreadCount() {
    if (!user?.id) return;
    try {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: 'exact', head: true })
        .eq("read", false)
        .eq("user_id", user.id);
        
      if (error) throw error;
      
      setUnreadCount(count || 0);
    } catch (error) {
      console.error("Error updating unread count:", error);
    }
  }

  // Helper function to get icon based on severity
  const getNotificationIcon = (severity: NotificationSeverity = 'info') => {
    switch (severity) {
      case 'warning':
        return (
          <div className="h-8 w-8 rounded-full bg-chart-6/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4 text-chart-6" />
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
          <div className="h-8 w-8 rounded-full bg-chart-3/10 flex items-center justify-center shrink-0">
            <AlertCircle className="h-4 w-4 text-chart-3" />
          </div>
        );
    }
  };

  const formatTimeAgo = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const formatted = formatDistanceToNow(date, { addSuffix: true });
      
      // Convert "about 1 hour ago" to "1h ago" and similar
      return formatted
        .replace(/about /g, '')
        .replace(/less than a minute ago/g, 'just now')
        .replace(/ minutes? ago/g, 'm ago')
        .replace(/ hours? ago/g, 'h ago')
        .replace(/ days? ago/g, 'd ago')
        .replace(/ weeks? ago/g, 'w ago')
        .replace(/ months? ago/g, 'mo ago')
        .replace(/ years? ago/g, 'y ago');
    } catch (e) {
      return "recently";
    }
  };

  const renderNotificationItem = (notification: Notification) => (
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
              {!notification.read && (
                <div className="h-2 w-2 rounded-full bg-primary"></div>
              )}
              <span className="text-[10px] text-muted-foreground whitespace-nowrap bg-muted/50 px-1.5 py-0.5 rounded-full">
                {formatTimeAgo(notification.created_at)}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {notification.body}
          </p>
          
          <div className="flex justify-between items-center">
            {(notification.action_url || isReportFeedbackNotification(notification)) && (
              <span className="text-xs text-primary font-medium hover:underline">
                View details
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );

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

  // Create a shared content component that works for both Popover and Drawer
  const NotificationsContent = () => (
    <>
      
      <ScrollArea className={cn("h-[400px]", isMobile && "h-[calc(60vh-80px)]")}>
        {loading ? (
          <div className="flex flex-col justify-center items-center py-16">
            <div className="relative">
              <div className="absolute inset-0 rounded-full"></div>
              <div className="relative rounded-full p-3">
                <Loader2 className="h-6 w-6 animate-spin font-bold text-primary" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">Loading notifications...</p>
          </div>
        ) : notifications.length > 0 ? (
          notifications.map(renderNotificationItem)
        ) : (
          renderEmptyState()
        )}
      </ScrollArea>
    </>
  );

  const NotificationButton = (
    <Button variant="ghost" size="icon" className="border relative rounded-full">
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <Badge
          variant="destructive"
          className="absolute -top-0 -right-0 h-3 w-3 p-0 flex items-center justify-center"
        />
      )}
    </Button>
  );

  const detailMetadata = activeNotification?.data ?? null;
  const detailStatus = typeof detailMetadata?.status === 'string' ? detailMetadata.status : null;
  const detailStatusLabel = detailStatus ? detailStatus.replace(/_/g, ' ') : null;
  const detailTimestamp = (typeof detailMetadata?.resolvedAt === 'string'
    ? detailMetadata.resolvedAt
    : undefined) ?? activeNotification?.created_at;
  const detailSubtitle = detailTimestamp
    ? `Updated ${formatTimeAgo(detailTimestamp)}`
    : 'Notification details';

  const handleDetailDialogChange = (nextOpen: boolean) => {
    setDetailOpen(nextOpen);
    if (!nextOpen) {
      setActiveNotification(null);
    }
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
            <Badge
              variant={detailStatus === 'resolved' ? 'secondary' : detailStatus === 'dismissed' ? 'outline' : 'default'}
              className="w-fit uppercase"
            >
              {detailStatusLabel}
            </Badge>
          )}
          <p className="text-sm text-foreground whitespace-pre-line">
            {activeNotification?.body}
          </p>
          {detailMetadata?.reportDescription && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">Your original report</p>
              <p className="mt-1 text-sm text-foreground whitespace-pre-line">
                {detailMetadata.reportDescription}
              </p>
              {detailMetadata.reportReason && (
                <p className="mt-2 text-xs text-muted-foreground">Tagged as: {detailMetadata.reportReason}</p>
              )}
            </div>
          )}
          {detailMetadata?.reportId && (
            <p className="text-xs text-muted-foreground">Reference ID: {detailMetadata.reportId}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => handleDetailDialogChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // Render either Popover or Drawer based on screen size
  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>
            {NotificationButton}
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="px-0 pt-0">
              <div className="px-4 py-3 flex justify-between items-center">
                <DrawerTitle className="font-medium">Notifications</DrawerTitle>
                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground p-2 h-7 w-7"
                  onClick={() => {
                    router.push("/account/notifications");
                    setOpen(false);
                  }}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
              <div className="h-[1px] w-full bg-border"></div>
            </DrawerHeader>
            <div className="pb-6">
              <NotificationsContent />
            </div>
          </DrawerContent>
        </Drawer>
        {detailDialog}
      </>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {NotificationButton}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px] p-0">
        <div>
          {/* Simple Header */}
          <div className="px-4 py-3 flex justify-between items-center">
            <h3 className="text-sm font-medium">Notifications</h3>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground p-2 h-7 w-7"
              onClick={() => {
                router.push("/account/notifications");
                setOpen(false);
              }}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Full-width separator */}
          <div className="h-[1px] w-full bg-border"></div>
        </div>

          <NotificationsContent />
        </PopoverContent>
      </Popover>
      {detailDialog}
    </>
  );
}
