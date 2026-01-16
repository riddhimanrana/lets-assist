"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[hsl(var(--toast-bg))] group-[.toaster]:text-[hsl(var(--toast-foreground))] group-[.toaster]:border-[hsl(var(--toast-border))] group-[.toaster]:shadow-[0_10px_30px_hsl(var(--toast-shadow)/0.18)]",
          description: "group-[.toast]:text-[hsl(var(--toast-muted))]",
          actionButton:
            "group-[.toast]:bg-[hsl(var(--toast-action))] group-[.toast]:text-[hsl(var(--toast-action-foreground))] group-[.toast]:hover:bg-[hsl(var(--toast-action)/0.9)]",
          cancelButton:
            "group-[.toast]:bg-[hsl(var(--toast-cancel))] group-[.toast]:text-[hsl(var(--toast-cancel-foreground))] group-[.toast]:hover:bg-[hsl(var(--toast-cancel)/0.9)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
