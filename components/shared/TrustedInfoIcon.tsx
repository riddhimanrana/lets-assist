"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Props = {
  message: string;
  linkLabel?: string;
  className?: string;
};

export function TrustedInfoIcon({ message, linkLabel = "Apply for Trusted Member", className }: Props) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span aria-label="Trusted member required" role="img" className={className}>
            <Info className="h-4 w-4 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="max-w-xs space-y-2">
            <p className="text-xs leading-snug">{message}</p>
            <Link href="/trusted-member" className="text-xs text-primary underline">
              {linkLabel}
            </Link>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
