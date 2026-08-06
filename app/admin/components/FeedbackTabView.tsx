"use client";

import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  Flag,
  Keyboard,
  Loader2,
  Search,
} from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";

import { NoAvatar } from "@/components/shared/NoAvatar";
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  getValidDate,
  statusLabel,
  statusStyles,
  type FeedbackCounts,
  type FeedbackItem,
  type ModerationStatus,
} from "./FeedbackTabModel";

export function FeedbackTabView({
  searchQuery,
  setSearchQuery,
  typeFilter,
  setTypeFilter,
  statusFilter,
  setStatusFilter,
  sortOrder,
  setSortOrder,
  counts,
  filteredFeedback,
  selectedId,
  setSelectedId,
  selectedFeedback,
  selectedIndex,
  selectByOffset,
  getModerationStatus,
  handleModeration,
  handleDelete,
  isActionLoading,
}: {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  statusFilter: "all" | ModerationStatus;
  setStatusFilter: (value: "all" | ModerationStatus) => void;
  sortOrder: "pending_first" | "newest" | "oldest";
  setSortOrder: (value: "pending_first" | "newest" | "oldest") => void;
  counts: FeedbackCounts;
  filteredFeedback: FeedbackItem[];
  selectedId: string | null;
  setSelectedId: (value: string | null) => void;
  selectedFeedback: FeedbackItem | null;
  selectedIndex: number;
  selectByOffset: (offset: number) => void;
  getModerationStatus: (item: FeedbackItem) => ModerationStatus;
  handleModeration: (
    status: ModerationStatus,
    moveNext?: boolean,
  ) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
  isActionLoading: boolean;
}) {
  const selectedDate = getValidDate(selectedFeedback?.created_at);
  const selectedModerationDate = getValidDate(
    selectedFeedback?.moderation_reviewed_at,
  );

  const resultsSummary =
    filteredFeedback.length === 1
      ? "1 result"
      : `${filteredFeedback.length.toLocaleString()} results`;

  const queuePosition =
    selectedIndex >= 0
      ? `${selectedIndex + 1} / ${Math.max(filteredFeedback.length, 1)}`
      : "0 / 0";

  const selectedStatus = selectedFeedback
    ? getModerationStatus(selectedFeedback)
    : "pending";

  const disableActionButtons = isActionLoading || !selectedFeedback;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center">
        <div className="relative w-full">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title, content, user, or page path..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Select
          value={typeFilter}
          onValueChange={(val) => val && setTypeFilter(val)}
        >
          <SelectTrigger className="w-full min-w-37.5 lg:w-42.5">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="issue">Issues</SelectItem>
            <SelectItem value="idea">Ideas</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(val) =>
            val && setStatusFilter(val as "all" | ModerationStatus)
          }
        >
          <SelectTrigger className="w-full min-w-42.5 lg:w-47.5">
            <SelectValue placeholder="Moderation status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="flagged">Flagged</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={sortOrder}
          onValueChange={(val) =>
            val && setSortOrder(val as "pending_first" | "newest" | "oldest")
          }
        >
          <SelectTrigger className="w-full min-w-42.5 lg:w-47.5">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending_first">Pending first</SelectItem>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold">
              {counts.total.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-lg font-semibold">
              {counts.pending.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Approved</p>
            <p className="text-lg font-semibold">
              {counts.approved.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Flagged</p>
            <p className="text-lg font-semibold">
              {counts.flagged.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Archived</p>
            <p className="text-lg font-semibold">
              {counts.archived.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Review queue</CardTitle>
                <CardDescription>{resultsSummary}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => selectByOffset(-1)}
                  disabled={filteredFeedback.length === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="sr-only">Previous feedback</span>
                </Button>
                <div className="min-w-18 text-center text-xs text-muted-foreground">
                  {queuePosition}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => selectByOffset(1)}
                  disabled={filteredFeedback.length === 0}
                >
                  <ChevronRight className="h-4 w-4" />
                  <span className="sr-only">Next feedback</span>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-[68vh] space-y-2 overflow-y-auto pr-1">
              {filteredFeedback.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No feedback matches the current filters.
                </div>
              ) : (
                filteredFeedback.map((item) => {
                  const isSelected = item.id === selectedId;
                  const moderation = getModerationStatus(item);
                  const createdAt = getValidDate(item.created_at);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left transition-colors",
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-primary/50 hover:bg-muted/30",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant={
                                item.section === "issue"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {item.section}
                            </Badge>
                            <Badge
                              className={cn(
                                "capitalize",
                                statusStyles[moderation],
                              )}
                            >
                              {statusLabel[moderation]}
                            </Badge>
                          </div>
                          <p className="line-clamp-1 text-sm font-medium">
                            {item.title}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {createdAt
                            ? formatDistanceToNowStrict(createdAt, {
                                addSuffix: true,
                              })
                            : "Unknown date"}
                        </span>
                      </div>

                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {item.feedback}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate max-w-60">
                          {item.profiles?.full_name ||
                            item.profiles?.username ||
                            item.email}
                        </span>
                        {item.page_path ? (
                          <span className="truncate max-w-55">
                            {item.page_path}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle className="text-base">Feedback details</CardTitle>
            <CardDescription>
              Use keyboard shortcuts to fly through moderation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedFeedback ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Select a feedback item to review.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        selectedFeedback.section === "issue"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {selectedFeedback.section}
                    </Badge>
                    <Badge
                      className={cn("capitalize", statusStyles[selectedStatus])}
                    >
                      {statusLabel[selectedStatus]}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {selectedDate
                      ? format(selectedDate, "PPP p")
                      : "Unknown date"}
                  </span>
                </div>

                <h3 className="text-lg font-semibold leading-tight">
                  {selectedFeedback.title}
                </h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {selectedFeedback.feedback}
                </p>

                <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span>Submitted by</span>
                    <ProfileHoverCard
                      username={
                        selectedFeedback.profiles?.username || "unknown"
                      }
                      fullName={
                        selectedFeedback.profiles?.full_name ||
                        selectedFeedback.email
                      }
                      avatarUrl={
                        selectedFeedback.profiles?.avatar_url || undefined
                      }
                    >
                      <span className="cursor-pointer font-medium text-foreground">
                        {selectedFeedback.profiles?.full_name ||
                          selectedFeedback.email}
                      </span>
                    </ProfileHoverCard>
                  </div>
                  {selectedFeedback.page_path ? (
                    <div className="flex items-start justify-between gap-2">
                      <span>Page</span>
                      <span className="max-w-[70%] truncate font-mono text-[11px] text-foreground/80">
                        {selectedFeedback.page_path}
                      </span>
                    </div>
                  ) : null}
                  {selectedModerationDate ? (
                    <div className="flex items-start justify-between gap-2">
                      <span>Last reviewed</span>
                      <span className="text-foreground/80">
                        {format(selectedModerationDate, "PPP p")}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleModeration("approved", true)}
                    disabled={disableActionButtons}
                  >
                    {isActionLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    Approve + next
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleModeration("flagged", true)}
                    disabled={disableActionButtons}
                  >
                    <Flag className="mr-2 h-4 w-4" />
                    Flag + next
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleModeration("archived", true)}
                    disabled={disableActionButtons}
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    Archive + next
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSelectedId(
                        filteredFeedback[Math.max(selectedIndex - 1, 0)]?.id ??
                          null,
                      )
                    }
                    disabled={filteredFeedback.length === 0}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSelectedId(
                        filteredFeedback[
                          Math.min(
                            selectedIndex + 1,
                            filteredFeedback.length - 1,
                          )
                        ]?.id ?? null,
                      )
                    }
                    disabled={filteredFeedback.length === 0}
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleDelete(selectedFeedback.id)}
                    disabled={disableActionButtons}
                  >
                    Remove
                  </Button>
                </div>

                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground/80">
                    <Keyboard className="h-3.5 w-3.5" />
                    Keyboard shortcuts
                  </div>
                  <p>
                    Next: <span className="font-mono">J / N / ↓</span>
                  </p>
                  <p>
                    Previous: <span className="font-mono">K / P / ↑</span>
                  </p>
                  <p>
                    Approve: <span className="font-mono">A</span> • Flag:{" "}
                    <span className="font-mono">F</span> • Archive:{" "}
                    <span className="font-mono">R</span>
                  </p>
                </div>

                <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                  <Avatar className="h-6 w-6">
                    <AvatarImage
                      src={selectedFeedback.profiles?.avatar_url || undefined}
                      alt={
                        selectedFeedback.profiles?.full_name ||
                        selectedFeedback.email
                      }
                    />
                    <AvatarFallback>
                      <NoAvatar
                        fullName={
                          selectedFeedback.profiles?.full_name ||
                          selectedFeedback.email
                        }
                      />
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">
                    {selectedFeedback.profiles?.username
                      ? `@${selectedFeedback.profiles.username}`
                      : selectedFeedback.email}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
