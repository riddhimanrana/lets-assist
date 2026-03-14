import React from "react";

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ProjectCardSkeletonProps {
  className?: string;
}

export function ProjectCardSkeleton({ className }: ProjectCardSkeletonProps) {
  return (
    <Card
      className={cn(
        "overflow-hidden flex flex-col h-full py-0 gap-0 dark:ring-0 dark:shadow-md",
        className,
      )}
    >
      <CardHeader className="p-4 pb-2 space-y-3">
        <div className="flex justify-between items-start gap-2">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </CardHeader>

      <CardContent className="p-4 pt-2 grow space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-3.5 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-3.5 w-24" />
        </div>

        <Skeleton className="h-14 w-full" />
      </CardContent>

      <CardFooter className="p-4 pt-0 mt-auto bg-transparent border-t-0">
        <Skeleton className="h-9 w-full rounded-md" />
      </CardFooter>
    </Card>
  );
}
