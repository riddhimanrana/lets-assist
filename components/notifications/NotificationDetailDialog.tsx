"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { notificationActionLabel } from "@/services/notification-action-label";

import { formatTimeAgo, type Notification } from "./notification-format";

type Props = {
  notification: Notification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (notification: Notification) => void;
};

export function NotificationDetailDialog({
  notification,
  open,
  onOpenChange,
  onAction,
}: Props) {
  const metadata = notification?.data ?? null;
  const statusLabel =
    typeof metadata?.status === "string"
      ? metadata.status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
      : null;
  const subtitle = notification?.created_at
    ? `Updated ${formatTimeAgo(notification.created_at)}`
    : "Notification details";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{notification?.title ?? "Notification"}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-start gap-4">
          {statusLabel ? (
            <Badge variant="secondary">{statusLabel}</Badge>
          ) : null}
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {notification?.body}
          </p>
          {notification?.action_url ? (
            <div className="flex w-full flex-col gap-1 border-t pt-4">
              <p className="text-sm text-muted-foreground">Related URL</p>
              <p className="font-mono text-xs break-all">
                {notification.action_url}
              </p>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {notification?.action_url ? (
            <Button onClick={() => onAction(notification)}>
              {notificationActionLabel(notification.data)}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
