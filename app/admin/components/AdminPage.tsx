import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Shared container for every admin screen. The outer width never changes, so
 * the left edge stays put while moving between pages; form pages narrow the
 * inner column instead of re-centring it.
 */
export function AdminPage({
  width = "wide",
  className,
  children,
}: {
  width?: "wide" | "form";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div
        className={cn("grid gap-6", width === "form" && "max-w-4xl", className)}
      >
        {children}
      </div>
    </div>
  );
}

/** The one way an admin page reports that its data could not be loaded. */
export function AdminLoadError({
  title,
  message,
}: {
  title: string;
  message: React.ReactNode;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
