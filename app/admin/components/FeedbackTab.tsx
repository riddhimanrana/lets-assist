"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Search,
  Filter,
  Check,
  Flag,
  Archive,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard";
import { format, formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { deleteFeedback, updateFeedbackModerationStatus } from "../actions";

type ModerationStatus = "pending" | "approved" | "flagged" | "archived";

type ModerateResult = { error?: string; success?: boolean } | void;

const statusStyles: Record<ModerationStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  flagged: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  archived: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

const statusLabel: Record<ModerationStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  flagged: "Flagged",
  archived: "Archived",
};

function getValidDate(input: string | null | undefined) {
  if (!input) {
    return null;
  }

  const value = new Date(input);
  return Number.isNaN(value.getTime()) ? null : value;
}

interface FeedbackItem {
  id: string;
  section: string;
  title: string;
  feedback: string;
  created_at: string;
  email: string;
  page_path?: string | null;
  metadata?: Record<string, unknown> | null;
  moderation_status?: ModerationStatus;
  moderation_notes?: string | null;
  moderation_reviewed_at?: string | null;
  moderation_reviewed_by?: string | null;
  profiles?: {
    full_name: string | null;
    avatar_url?: string | null;
    username?: string | null;
  } | null;
}

interface FeedbackTabProps {
  feedback: FeedbackItem[];
  onDelete?: (id: string) => Promise<void>;
  onModerate?: (id: string, status: ModerationStatus) => Promise<ModerateResult>;
}

export function FeedbackTab({ feedback, onDelete, onModerate }: FeedbackTabProps) {
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>(feedback);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ModerationStatus>("pending");
  const [sortOrder, setSortOrder] = useState<"pending_first" | "newest" | "oldest">("pending_first");
  const [selectedId, setSelectedId] = useState<string | null>(feedback[0]?.id ?? null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  useEffect(() => {
    setFeedbackItems(feedback);
  }, [feedback]);

  const getModerationStatus = useCallback(
    (item: FeedbackItem): ModerationStatus => item.moderation_status || "pending",
    [],
  );

  const filteredFeedback = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const results = feedbackItems.filter((item) => {
      const moderation = getModerationStatus(item);
      const searchable = [
        item.title,
        item.feedback,
        item.email,
        item.page_path || "",
        item.profiles?.full_name || "",
        item.profiles?.username || "",
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = query.length === 0 || searchable.includes(query);
      const matchesType = typeFilter === "all" || item.section === typeFilter;
      const matchesStatus = statusFilter === "all" || moderation === statusFilter;

      return matchesSearch && matchesType && matchesStatus;
    });

    const statusRank: Record<ModerationStatus, number> = {
      pending: 0,
      flagged: 1,
      approved: 2,
      archived: 3,
    };

    return results.sort((a, b) => {
      const dateA = getValidDate(a.created_at)?.getTime() ?? 0;
      const dateB = getValidDate(b.created_at)?.getTime() ?? 0;

      if (sortOrder === "oldest") {
        return dateA - dateB;
      }

      if (sortOrder === "newest") {
        return dateB - dateA;
      }

      const statusA = statusRank[getModerationStatus(a)];
      const statusB = statusRank[getModerationStatus(b)];

      if (statusA !== statusB) {
        return statusA - statusB;
      }

      return dateB - dateA;
    });
  }, [feedbackItems, getModerationStatus, searchQuery, sortOrder, statusFilter, typeFilter]);

  useEffect(() => {
    if (filteredFeedback.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !filteredFeedback.some((item) => item.id === selectedId)) {
      setSelectedId(filteredFeedback[0].id);
    }
  }, [filteredFeedback, selectedId]);

  const selectedIndex = filteredFeedback.findIndex((item) => item.id === selectedId);
  const selectedFeedback = selectedIndex >= 0 ? filteredFeedback[selectedIndex] : null;

  const counts = useMemo(() => {
    return feedbackItems.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[getModerationStatus(item)] += 1;
        return acc;
      },
      {
        total: 0,
        pending: 0,
        approved: 0,
        flagged: 0,
        archived: 0,
      },
    );
  }, [feedbackItems, getModerationStatus]);

  const selectByOffset = useCallback(
    (offset: number) => {
      if (filteredFeedback.length === 0) {
        return;
      }

      const baseIndex = selectedIndex >= 0 ? selectedIndex : 0;
      const nextIndex = Math.min(Math.max(baseIndex + offset, 0), filteredFeedback.length - 1);
      setSelectedId(filteredFeedback[nextIndex]?.id ?? null);
    },
    [filteredFeedback, selectedIndex],
  );

  const updateLocalModeration = useCallback((id: string, status: ModerationStatus) => {
    setFeedbackItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              moderation_status: status,
              moderation_reviewed_at: new Date().toISOString(),
            }
          : item,
      ),
    );
  }, []);

  const handleModeration = useCallback(
    async (status: ModerationStatus, moveNext = true) => {
      if (!selectedFeedback || isActionLoading) {
        return;
      }

      const currentFeedbackId = selectedFeedback.id;
      const fallbackIndex = Math.min(selectedIndex + 1, Math.max(filteredFeedback.length - 1, 0));
      const fallbackId = filteredFeedback[fallbackIndex]?.id ?? null;

      setIsActionLoading(true);
      try {
        const result = onModerate
          ? await onModerate(currentFeedbackId, status)
          : await updateFeedbackModerationStatus({
              feedbackId: currentFeedbackId,
              status,
            });

        if (result && "error" in result && result.error) {
          toast.error(result.error);
          return;
        }

        updateLocalModeration(currentFeedbackId, status);
        toast.success(`Marked as ${statusLabel[status].toLowerCase()}`);

        if (moveNext && fallbackId) {
          setSelectedId(fallbackId);
        }
      } catch (error) {
        console.error("Error updating feedback moderation:", error);
        toast.error("Failed to update feedback moderation");
      } finally {
        setIsActionLoading(false);
      }
    },
    [
      filteredFeedback,
      isActionLoading,
      onModerate,
      selectedFeedback,
      selectedIndex,
      updateLocalModeration,
    ],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (isActionLoading) {
        return;
      }

      const listIndex = filteredFeedback.findIndex((item) => item.id === id);
      const nextCandidate =
        filteredFeedback[listIndex + 1]?.id ||
        filteredFeedback[listIndex - 1]?.id ||
        null;

      setIsActionLoading(true);
      try {
        if (onDelete) {
          await onDelete(id);
        } else {
          const result = await deleteFeedback(id);
          if (result.error) {
            toast.error(result.error);
            return;
          }
        }

        setFeedbackItems((prev) => prev.filter((item) => item.id !== id));
        if (selectedId === id) {
          setSelectedId(nextCandidate);
        }
        toast.success("Feedback removed");
      } catch (error) {
        console.error("Error deleting feedback:", error);
        toast.error("Failed to remove feedback");
      } finally {
        setIsActionLoading(false);
      }
    },
    [filteredFeedback, isActionLoading, onDelete, selectedId],
  );

  useEffect(() => {
    const handleKeyboardShortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping =
        target?.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select";

      if (isTyping) {
        return;
      }

      const key = event.key.toLowerCase();

      if (["j", "n", "arrowdown"].includes(key)) {
        event.preventDefault();
        selectByOffset(1);
        return;
      }

      if (["k", "p", "arrowup"].includes(key)) {
        event.preventDefault();
        selectByOffset(-1);
        return;
      }

      if (key === "a") {
        event.preventDefault();
        void handleModeration("approved", true);
        return;
      }

      if (key === "f") {
        event.preventDefault();
        void handleModeration("flagged", true);
        return;
      }

      if (key === "r") {
        event.preventDefault();
        void handleModeration("archived", true);
      }
    };

    window.addEventListener("keydown", handleKeyboardShortcuts);
    return () => {
      window.removeEventListener("keydown", handleKeyboardShortcuts);
    };
  }, [handleModeration, selectByOffset]);

  const selectedDate = getValidDate(selectedFeedback?.created_at);
  const selectedModerationDate = getValidDate(selectedFeedback?.moderation_reviewed_at);

  const resultsSummary =
    filteredFeedback.length === 1
      ? "1 result"
      : `${filteredFeedback.length.toLocaleString()} results`;

  const queuePosition =
    selectedIndex >= 0
      ? `${selectedIndex + 1} / ${Math.max(filteredFeedback.length, 1)}`
      : "0 / 0";

  const selectedStatus = selectedFeedback ? getModerationStatus(selectedFeedback) : "pending";

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

        <Select value={typeFilter} onValueChange={(val) => val && setTypeFilter(val)}>
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
          onValueChange={(val) => val && setStatusFilter(val as "all" | ModerationStatus)}
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
          onValueChange={(val) => val && setSortOrder(val as "pending_first" | "newest" | "oldest")}
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
            <p className="text-lg font-semibold">{counts.total.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-lg font-semibold">{counts.pending.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Approved</p>
            <p className="text-lg font-semibold">{counts.approved.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Flagged</p>
            <p className="text-lg font-semibold">{counts.flagged.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Archived</p>
            <p className="text-lg font-semibold">{counts.archived.toLocaleString()}</p>
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
                <div className="min-w-18 text-center text-xs text-muted-foreground">{queuePosition}</div>
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
                            <Badge variant={item.section === "issue" ? "destructive" : "secondary"}>
                              {item.section}
                            </Badge>
                            <Badge className={cn("capitalize", statusStyles[moderation])}>
                              {statusLabel[moderation]}
                            </Badge>
                          </div>
                          <p className="line-clamp-1 text-sm font-medium">{item.title}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {createdAt ? formatDistanceToNowStrict(createdAt, { addSuffix: true }) : "Unknown date"}
                        </span>
                      </div>

                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.feedback}</p>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate max-w-60">
                          {item.profiles?.full_name || item.profiles?.username || item.email}
                        </span>
                        {item.page_path ? <span className="truncate max-w-55">{item.page_path}</span> : null}
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
                    <Badge variant={selectedFeedback.section === "issue" ? "destructive" : "secondary"}>
                      {selectedFeedback.section}
                    </Badge>
                    <Badge className={cn("capitalize", statusStyles[selectedStatus])}>
                      {statusLabel[selectedStatus]}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {selectedDate ? format(selectedDate, "PPP p") : "Unknown date"}
                  </span>
                </div>

                <h3 className="text-lg font-semibold leading-tight">{selectedFeedback.title}</h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {selectedFeedback.feedback}
                </p>

                <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span>Submitted by</span>
                    <ProfileHoverCard
                      username={selectedFeedback.profiles?.username || "unknown"}
                      fullName={selectedFeedback.profiles?.full_name || selectedFeedback.email}
                      avatarUrl={selectedFeedback.profiles?.avatar_url || undefined}
                    >
                      <span className="cursor-pointer font-medium text-foreground">
                        {selectedFeedback.profiles?.full_name || selectedFeedback.email}
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
                      <span className="text-foreground/80">{format(selectedModerationDate, "PPP p")}</span>
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
                    {isActionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
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
                    onClick={() => setSelectedId(filteredFeedback[Math.max(selectedIndex - 1, 0)]?.id ?? null)}
                    disabled={filteredFeedback.length === 0}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedId(filteredFeedback[Math.min(selectedIndex + 1, filteredFeedback.length - 1)]?.id ?? null)}
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
                  <p>Next: <span className="font-mono">J / N / ↓</span></p>
                  <p>Previous: <span className="font-mono">K / P / ↑</span></p>
                  <p>Approve: <span className="font-mono">A</span> • Flag: <span className="font-mono">F</span> • Archive: <span className="font-mono">R</span></p>
                </div>

                <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                  {selectedFeedback.profiles?.avatar_url ? (
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={selectedFeedback.profiles.avatar_url} />
                      <AvatarFallback>{selectedFeedback.profiles.full_name?.[0] || "U"}</AvatarFallback>
                    </Avatar>
                  ) : (
                    <NoAvatar
                      fullName={selectedFeedback.profiles?.full_name || selectedFeedback.email}
                      className="h-6 w-6 rounded-full bg-muted"
                    />
                  )}
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
