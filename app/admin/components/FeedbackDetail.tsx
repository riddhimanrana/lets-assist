"use client";

import { useState } from "react";
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";

import { NoAvatar } from "@/components/shared/NoAvatar";
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";

import { statusTone } from "./admin-status";
import {
  getValidDate,
  statusLabel,
  type FeedbackItem,
  type ModerationStatus,
} from "./FeedbackTabModel";

export function FeedbackDetail({
  filteredFeedback,
  setSelectedId,
  selectedFeedback,
  selectedIndex,
  getModerationStatus,
  handleModeration,
  handleDelete,
  isActionLoading,
}: {
  filteredFeedback: FeedbackItem[];
  setSelectedId: (value: string | null) => void;
  selectedFeedback: FeedbackItem | null;
  selectedIndex: number;
  getModerationStatus: (item: FeedbackItem) => ModerationStatus;
  handleModeration: (
    status: ModerationStatus,
    moveNext?: boolean,
  ) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
  isActionLoading: boolean;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);

  if (!selectedFeedback) {
    return (
      <Card className="h-fit xl:sticky xl:top-4">
        <CardHeader>
          <CardTitle>Feedback details</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Select a feedback item to review.
          </p>
        </CardContent>
      </Card>
    );
  }

  const selectedDate = getValidDate(selectedFeedback.created_at);
  const selectedModerationDate = getValidDate(
    selectedFeedback.moderation_reviewed_at,
  );
  const selectedStatus = getModerationStatus(selectedFeedback);
  const submitterName =
    selectedFeedback.profiles?.full_name || selectedFeedback.email;

  return (
    <Card className="h-fit xl:sticky xl:top-4">
      <CardHeader>
        <CardTitle>Feedback details</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="capitalize">
                {selectedFeedback.section}
              </Badge>
              <Badge variant={statusTone(selectedStatus)}>
                {statusLabel[selectedStatus]}
              </Badge>
            </div>
            <span className="text-muted-foreground text-xs">
              {selectedDate ? format(selectedDate, "PPP p") : "Unknown date"}
            </span>
          </div>

          <h3 className="text-lg leading-tight font-semibold">
            {selectedFeedback.title}
            {selectedFeedback.rating ? ` · ${selectedFeedback.rating}/5` : ""}
          </h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {selectedFeedback.feedback}
          </p>
        </div>

        <dl className="divide-y border-y text-sm">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted-foreground">Submitted by</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <Avatar className="size-6">
                <AvatarImage
                  src={selectedFeedback.profiles?.avatar_url || undefined}
                  alt={submitterName}
                />
                <AvatarFallback>
                  <NoAvatar fullName={submitterName} />
                </AvatarFallback>
              </Avatar>
              <ProfileHoverCard
                username={selectedFeedback.profiles?.username || "unknown"}
                fullName={submitterName}
                avatarUrl={selectedFeedback.profiles?.avatar_url || undefined}
              >
                <span className="cursor-pointer truncate font-medium">
                  {submitterName}
                </span>
              </ProfileHoverCard>
              {selectedFeedback.profiles?.username ? (
                <span className="text-muted-foreground truncate text-xs">
                  @{selectedFeedback.profiles.username}
                </span>
              ) : null}
            </dd>
          </div>
          {selectedFeedback.page_path ? (
            <div className="flex items-start justify-between gap-3 py-2.5">
              <dt className="text-muted-foreground">Page</dt>
              <dd className="max-w-[70%] truncate font-mono text-xs">
                {selectedFeedback.page_path}
              </dd>
            </div>
          ) : null}
          {selectedModerationDate ? (
            <div className="flex items-start justify-between gap-3 py-2.5">
              <dt className="text-muted-foreground">Last reviewed</dt>
              <dd>{format(selectedModerationDate, "PPP p")}</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => void handleModeration("approved", true)}
            disabled={isActionLoading}
          >
            {isActionLoading ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Check data-icon="inline-start" />
            )}
            Approve + next
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleModeration("flagged", true)}
            disabled={isActionLoading}
          >
            <Flag data-icon="inline-start" />
            Flag + next
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleModeration("archived", true)}
            disabled={isActionLoading}
          >
            <Archive data-icon="inline-start" />
            Archive + next
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setSelectedId(
                filteredFeedback[Math.max(selectedIndex - 1, 0)]?.id ?? null,
              )
            }
            disabled={filteredFeedback.length === 0}
          >
            <ChevronLeft data-icon="inline-start" />
            Previous
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setSelectedId(
                filteredFeedback[
                  Math.min(selectedIndex + 1, filteredFeedback.length - 1)
                ]?.id ?? null,
              )
            }
            disabled={filteredFeedback.length === 0}
          >
            Next
            <ChevronRight data-icon="inline-end" />
          </Button>
          <Button
            type="button"
            variant="destructive-ghost"
            className="ml-auto"
            onClick={() => setRemoveOpen(true)}
            disabled={isActionLoading}
          >
            Remove
          </Button>
        </div>
      </CardContent>
      <CardFooter className="text-muted-foreground flex-wrap gap-x-4 gap-y-2 text-xs">
        <span className="flex items-center gap-1">
          Next <Kbd>J</Kbd> <Kbd>N</Kbd> <Kbd>↓</Kbd>
        </span>
        <span className="flex items-center gap-1">
          Previous <Kbd>K</Kbd> <Kbd>P</Kbd> <Kbd>↑</Kbd>
        </span>
        <span className="flex items-center gap-1">
          Approve <Kbd>A</Kbd>
        </span>
        <span className="flex items-center gap-1">
          Flag <Kbd>F</Kbd>
        </span>
        <span className="flex items-center gap-1">
          Archive <Kbd>R</Kbd>
        </span>
      </CardFooter>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this feedback?</AlertDialogTitle>
            <AlertDialogDescription>
              The submission is deleted for good and cannot be restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setRemoveOpen(false);
                void handleDelete(selectedFeedback.id);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
