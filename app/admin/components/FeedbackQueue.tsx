"use client";

import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
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
import { cn } from "@/lib/utils";

import { statusTone } from "./admin-status";
import {
  getValidDate,
  statusLabel,
  type FeedbackItem,
  type ModerationStatus,
} from "./FeedbackTabModel";

export function FeedbackQueue({
  filteredFeedback,
  selectedId,
  setSelectedId,
  selectedIndex,
  selectByOffset,
  getModerationStatus,
}: {
  filteredFeedback: FeedbackItem[];
  selectedId: string | null;
  setSelectedId: (value: string | null) => void;
  selectedIndex: number;
  selectByOffset: (offset: number) => void;
  getModerationStatus: (item: FeedbackItem) => ModerationStatus;
}) {
  const resultsSummary =
    filteredFeedback.length === 1
      ? "1 result"
      : `${filteredFeedback.length.toLocaleString()} results`;

  const queuePosition =
    selectedIndex >= 0
      ? `${selectedIndex + 1} / ${Math.max(filteredFeedback.length, 1)}`
      : "0 / 0";

  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="border-b">
        <CardTitle>Review queue</CardTitle>
        <CardDescription>{resultsSummary}</CardDescription>
        <CardAction className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => selectByOffset(-1)}
            disabled={filteredFeedback.length === 0}
          >
            <ChevronLeft />
            <span className="sr-only">Previous feedback</span>
          </Button>
          <span className="text-muted-foreground min-w-14 text-center text-xs tabular-nums">
            {queuePosition}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => selectByOffset(1)}
            disabled={filteredFeedback.length === 0}
          >
            <ChevronRight />
            <span className="sr-only">Next feedback</span>
          </Button>
        </CardAction>
      </CardHeader>

      {filteredFeedback.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <MessageSquare
                className="text-muted-foreground size-5"
                aria-hidden="true"
              />
            </EmptyMedia>
            <EmptyTitle className="text-base">Nothing to review</EmptyTitle>
            <EmptyDescription>
              No feedback matches the current filters.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="max-h-[68vh] divide-y overflow-y-auto">
          {filteredFeedback.map((item) => {
            const isSelected = item.id === selectedId;
            const moderation = getModerationStatus(item);
            const createdAt = getValidDate(item.created_at);

            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-current={isSelected ? "true" : undefined}
                  className={cn(
                    "focus-visible:ring-ring/50 grid w-full gap-1 px-4 py-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
                    isSelected ? "bg-muted" : "hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-1 text-sm font-medium">
                      {item.title}
                      {item.rating ? ` · ${item.rating}/5` : ""}
                    </p>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {createdAt
                        ? formatDistanceToNowStrict(createdAt, {
                            addSuffix: true,
                          })
                        : "Unknown date"}
                    </span>
                  </div>

                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {item.feedback}
                  </p>

                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <Badge variant="outline" className="capitalize">
                      {item.section}
                    </Badge>
                    <Badge variant={statusTone(moderation)}>
                      {statusLabel[moderation]}
                    </Badge>
                    <span className="max-w-60 truncate">
                      {item.profiles?.full_name ||
                        item.profiles?.username ||
                        item.email}
                    </span>
                    {item.page_path ? (
                      <span className="max-w-55 truncate font-mono">
                        {item.page_path}
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
