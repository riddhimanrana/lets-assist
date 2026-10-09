"use client";

import { MessageSquareText, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
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
  EmptyHeader,
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
import type {
  ProjectFeedbackEntry,
  ProjectFeedbackSummary,
} from "../server/feedback";
import { ProjectToolBreadcrumb } from "../ProjectToolBreadcrumb";

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
    <div className="container mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6">
      <PageHeader
        breadcrumb={
          <ProjectToolBreadcrumb
            projectId={projectId}
            projectTitle={projectTitle}
            current="Feedback"
          />
        }
        title="Volunteer feedback"
        description="Private to project managers."
      />

      <StatStrip
        items={[
          {
            label: "Average rating",
            value: (
              <span className="flex items-center gap-2">
                {summary.average ?? "—"}
                {summary.average !== null && (
                  <StarRatingDisplay
                    rating={Math.round(summary.average)}
                    size="md"
                  />
                )}
              </span>
            ),
          },
          { label: "Responses", value: summary.count },
          {
            label: "Response rate",
            value: responseRate !== null ? `${responseRate}%` : "—",
            helper:
              responseRate !== null
                ? `of ${summary.attendeeCount} ${summary.attendeeCount === 1 ? "attendee" : "attendees"}`
                : undefined,
          },
        ]}
      />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Ratings</CardTitle>
            <CardDescription>
              {summary.count} response{summary.count === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {([5, 4, 3, 2, 1] as const).map((value) => (
              <div key={value} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground w-3 tabular-nums">
                  {value}
                </span>
                <Star
                  aria-hidden="true"
                  className="fill-warning text-warning size-3.5"
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
                <span className="text-muted-foreground w-6 text-right tabular-nums">
                  {summary.distribution[value]}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          {entries.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareText aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No feedback yet</EmptyTitle>
                <EmptyDescription>
                  Attendees can rate the project from its page once it&apos;s
                  completed, or from the follow-up email.
                </EmptyDescription>
              </EmptyHeader>
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
                      <ItemTitle>
                        {entry.volunteerName ?? "Volunteer"}
                      </ItemTitle>
                      {entry.commentModerationStatus === "flagged" && (
                        <Badge variant="warning">Flagged for review</Badge>
                      )}
                    </div>
                    <span className="text-muted-foreground text-sm">
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
                      <ItemDescription>
                        Comment removed by moderation.
                      </ItemDescription>
                    </ItemContent>
                  ) : null}
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>
      </div>
    </div>
  );
}
