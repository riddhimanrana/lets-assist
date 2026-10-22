"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Stands in for content whose server read failed, so a failed read is never
 * shown as an empty result. The only retry is the button: it refreshes the
 * current route, which reruns the same server read with the same URL. Copy is
 * fixed by the caller and never carries a backend message, id or token.
 */
export function ReadLoadError({
  title,
  description = "Something went wrong on our side. Check your connection and try again.",
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Alert variant="destructive" className={className} aria-busy={isPending}>
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="col-start-2 mt-3 w-fit"
        disabled={isPending}
        focusableWhenDisabled
        onClick={() => startTransition(() => router.refresh())}
      >
        {isPending ? "Trying again..." : "Try again"}
      </Button>
    </Alert>
  );
}
