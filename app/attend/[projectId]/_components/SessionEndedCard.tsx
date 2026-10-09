"use client";

import { PartyPopperIcon } from "@/components/icons/animated";
import { EmptyStateIcon } from "@/components/projects/EmptyStateIcon";
import { NoticePage } from "@/components/projects/NoticePage";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface SessionEndedCardProps {
  projectId: string;
  projectTitle: string;
  sessionName: string;
  elapsedTime: string;
}

export function SessionEndedCard({
  projectId,
  projectTitle,
  sessionName,
  elapsedTime,
}: SessionEndedCardProps) {
  return (
    <NoticePage
      icon={<EmptyStateIcon icon={PartyPopperIcon} />}
      tone="success"
      title="Event completed"
      description="Thanks for volunteering — your session is recorded."
      actions={
        <>
          <Link href={`/projects/${projectId}`} className={buttonVariants()}>
            View project details
          </Link>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Back to dashboard
          </Link>
        </>
      }
    >
      <dl className="grid gap-3 border-y py-4 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Project</dt>
          <dd className="font-medium wrap-break-word">{projectTitle}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="grid min-w-0 gap-0.5">
            <dt className="text-muted-foreground">Session</dt>
            <dd className="font-medium wrap-break-word">{sessionName}</dd>
          </div>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {elapsedTime}
          </Badge>
        </div>
      </dl>
      <p className="text-muted-foreground text-sm">
        Your hours will be finalized within 48 hours.
      </p>
    </NoticePage>
  );
}
