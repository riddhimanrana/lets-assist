"use client";

import { ShieldCheck } from "lucide-react";

export function SecureCheckLoading() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="relative flex size-8 items-center justify-center rounded-full border border-border bg-muted/40 text-primary">
          <ShieldCheck className="size-4" />
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary motion-safe:animate-pulse" />
        </span>
        <span className="flex flex-col">
          <span className="text-xs font-semibold text-foreground">
            Preparing secure check
          </span>
          <span className="mt-1 flex items-center gap-1 text-[0.7rem]">
            <span>Almost ready</span>
            <span className="flex gap-0.5" aria-hidden>
              <span className="size-1 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce [animation-delay:-200ms]" />
              <span className="size-1 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce [animation-delay:-100ms]" />
              <span className="size-1 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce" />
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}
