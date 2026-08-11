"use client";

import Link from "next/link";
import { ArrowLeft, MessageSquareText, ShieldAlert, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type {
  ProjectFeedbackEntry,
  ProjectFeedbackSummary,
} from "../server/feedback";

interface FeedbackClientProps {
  projectId: string;
  projectTitle: string;
  summary: ProjectFeedbackSummary;
  entries: ProjectFeedbackEntry[];
}

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span
      className={cn("flex items-center gap-0.5", className)}
      aria-label={`${rating} of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={cn(
            "size-4",
            value <= rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}

export function FeedbackClient({
  projectId,
  projectTitle,
  summary,
  entries,
}: FeedbackClientProps) {
  const responseRate =
    summary.attendeeCount > 0
      ? Math.round((summary.count / summary.attendeeCount) * 100)
      : null;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={`/projects/${projectId}`}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Back to project"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            Volunteer feedback
          </h1>
          <p className="text-sm text-muted-foreground">{projectTitle}</p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-baseline gap-3">
            <span className="text-3xl">
              {summary.average ?? "—"}
            </span>
            {summary.average !== null && (
              <Stars rating={Math.round(summary.average)} />
            )}
          </CardTitle>
          <CardDescription>
            {summary.count} response{summary.count === 1 ? "" : "s"}
            {responseRate !== null &&
              ` · ${responseRate}% of ${summary.attendeeCount} attendees`}
            {" · private to project managers"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {([5, 4, 3, 2, 1] as const).map((value) => (
            <div key={value} className="flex items-center gap-2 text-sm">
              <span className="w-3 text-muted-foreground">{value}</span>
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
              <Progress
                value={
                  summary.count > 0
                    ? (summary.distribution[value] / summary.count) * 100
                    : 0
                }
                className="h-2"
              />
              <span className="w-6 text-right text-muted-foreground">
                {summary.distribution[value]}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <MessageSquareText className="mx-auto mb-2 size-8" />
            No feedback yet. Attendees can rate the project from its page once
            it&apos;s completed.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Stars rating={entry.rating} />
                  <span className="text-sm font-medium">
                    {entry.volunteerName ?? "Volunteer"}
                  </span>
                  {entry.commentModerationStatus === "flagged" && (
                    <Badge variant="secondary" className="gap-1">
                      <ShieldAlert className="size-3" />
                      flagged for review
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleDateString("en-US", {
                    dateStyle: "medium",
                  })}
                </span>
              </div>
              {entry.comment ? (
                <p className="mt-2 text-sm">{entry.comment}</p>
              ) : entry.commentModerationStatus === "blocked" ? (
                <p className="mt-2 text-sm italic text-muted-foreground">
                  Comment removed by moderation.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
