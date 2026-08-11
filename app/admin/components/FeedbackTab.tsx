"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { deleteFeedback, updateFeedbackModerationStatus } from "../actions";
import {
  getValidDate,
  statusLabel,
  type FeedbackItem,
  type FeedbackTabProps,
  type ModerationStatus,
} from "./FeedbackTabModel";
import { FeedbackTabView } from "./FeedbackTabView";

export function FeedbackTab({
  feedback,
  onDelete,
  onModerate,
}: FeedbackTabProps) {
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>(feedback);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ModerationStatus>(
    "pending",
  );
  const [sortOrder, setSortOrder] = useState<
    "pending_first" | "newest" | "oldest"
  >("pending_first");
  const [selectedId, setSelectedId] = useState<string | null>(
    feedback[0]?.id ?? null,
  );
  const [isActionLoading, setIsActionLoading] = useState(false);

  useEffect(() => {
    setFeedbackItems(feedback);
  }, [feedback]);

  const getModerationStatus = useCallback(
    (item: FeedbackItem): ModerationStatus =>
      item.moderation_status || "pending",
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
      const matchesStatus =
        statusFilter === "all" || moderation === statusFilter;

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
  }, [
    feedbackItems,
    getModerationStatus,
    searchQuery,
    sortOrder,
    statusFilter,
    typeFilter,
  ]);

  useEffect(() => {
    if (filteredFeedback.length === 0) {
      setSelectedId(null);
      return;
    }

    if (
      !selectedId ||
      !filteredFeedback.some((item) => item.id === selectedId)
    ) {
      setSelectedId(filteredFeedback[0].id);
    }
  }, [filteredFeedback, selectedId]);

  const selectedIndex = filteredFeedback.findIndex(
    (item) => item.id === selectedId,
  );
  const selectedFeedback =
    selectedIndex >= 0 ? filteredFeedback[selectedIndex] : null;

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
      const nextIndex = Math.min(
        Math.max(baseIndex + offset, 0),
        filteredFeedback.length - 1,
      );
      setSelectedId(filteredFeedback[nextIndex]?.id ?? null);
    },
    [filteredFeedback, selectedIndex],
  );

  const updateLocalModeration = useCallback(
    (id: string, status: ModerationStatus) => {
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
    },
    [],
  );

  const handleModeration = useCallback(
    async (status: ModerationStatus, moveNext = true) => {
      if (!selectedFeedback || isActionLoading) {
        return;
      }

      const currentFeedbackId = selectedFeedback.id;
      const fallbackIndex = Math.min(
        selectedIndex + 1,
        Math.max(filteredFeedback.length - 1, 0),
      );
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

  return (
    <FeedbackTabView
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      typeFilter={typeFilter}
      setTypeFilter={setTypeFilter}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      sortOrder={sortOrder}
      setSortOrder={setSortOrder}
      counts={counts}
      filteredFeedback={filteredFeedback}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
      selectedFeedback={selectedFeedback}
      selectedIndex={selectedIndex}
      selectByOffset={selectByOffset}
      getModerationStatus={getModerationStatus}
      handleModeration={handleModeration}
      handleDelete={handleDelete}
      isActionLoading={isActionLoading}
    />
  );
}
