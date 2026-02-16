"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--toast-normal-bg)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--toast-normal-fg)",
          "--border-radius": "var(--radius)",
          "--success-bg": "var(--toast-success-bg)",
          "--success-text": "var(--success)",
          "--success-border": "var(--toast-success-fg)",
          "--error-bg": "var(--toast-error-bg)",
          "--error-text": "var(--destructive)",
          "--error-border": "var(--toast-error-fg)",
          "--warning-bg": "var(--toast-warning-bg)",
          "--warning-text": "var(--warning)",
          "--warning-border": "var(--toast-warning-fg)",
          "--info-bg": "var(--toast-info-bg)",
          "--info-text": "var(--info)",
          "--info-border": "var(--toast-info-fg)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
