import React from "react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ProjectCardSkeletonProps {
  className?: string;
}

/** Same shape as a feed card: title, host, then the three fact rows. */
export function ProjectCardSkeleton({ className }: ProjectCardSkeletonProps) {
  return (
    <Card className={cn("h-full gap-3", className)}>
      <div className="grid gap-1.5 px-4">
        <div className="grid min-h-11 content-start gap-2 pt-1">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <div className="mt-auto grid gap-1.5 border-t px-4 pt-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-28" />
      </div>
    </Card>
  );
}
