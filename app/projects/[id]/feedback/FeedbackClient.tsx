"use client";

import Link from "next/link";
import { ArrowLeft, MessageSquareText, ShieldAlert, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemHeader,
  ItemTitle,
} from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { StarRatingDisplay } from "@/components/projects/StarRatingInput";
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
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "shrink-0",
          )}
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
            <span className="text-3xl">{summary.average ?? "—"}</span>
            {summary.average !== null && (
              <StarRatingDisplay
                rating={Math.round(summary.average)}
                size="md"
              />
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
              <Star
                aria-hidden="true"
                className="size-3.5 fill-amber-400 text-amber-400"
              />
              <Progress
                aria-label={`${summary.distribution[value]} ${value}-star responses`}
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
        <Empty className="border">
          <EmptyMedia variant="icon">
            <MessageSquareText />
          </EmptyMedia>
          <EmptyTitle>No feedback yet</EmptyTitle>
          <EmptyDescription>
            Attendees can rate the project from its page once it&apos;s
            completed, or from the follow-up email.
          </EmptyDescription>
        </Empty>
      ) : (
        <ItemGroup className="gap-3">
          {entries.map((entry) => (
            <Item
              key={entry.id}
              variant="outline"
              className="flex-col items-stretch"
            >
              <ItemHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <StarRatingDisplay rating={entry.rating} />
                  <ItemTitle>{entry.volunteerName ?? "Volunteer"}</ItemTitle>
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
              </ItemHeader>
              {entry.comment ? (
                <ItemContent>
                  <ItemDescription className="text-foreground">
                    {entry.comment}
                  </ItemDescription>
                </ItemContent>
              ) : entry.commentModerationStatus === "blocked" ? (
                <ItemContent>
                  <ItemDescription className="italic">
                    Comment removed by moderation.
                  </ItemDescription>
                </ItemContent>
              ) : null}
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  );
}
