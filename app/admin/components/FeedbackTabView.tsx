"use client";

import { Search } from "lucide-react";

import { StatStrip } from "@/components/layout/SettingsSection";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { FeedbackDetail } from "./FeedbackDetail";
import { FeedbackQueue } from "./FeedbackQueue";
import {
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
  return (
    <div className="grid gap-6">
      <StatStrip
        items={[
          { label: "Total", value: counts.total.toLocaleString() },
          { label: "Pending", value: counts.pending.toLocaleString() },
          { label: "Approved", value: counts.approved.toLocaleString() },
          { label: "Flagged", value: counts.flagged.toLocaleString() },
          { label: "Archived", value: counts.archived.toLocaleString() },
        ]}
      />

      <div className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <InputGroup className="sm:col-span-3 lg:col-span-1">
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search feedback"
              placeholder="Search title, content, user, or page path..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </InputGroup>

          <Select
            value={typeFilter}
            onValueChange={(val) => val && setTypeFilter(val)}
          >
            <SelectTrigger aria-label="Type" className="w-full lg:w-40">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
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
            <SelectTrigger
              aria-label="Moderation status"
              className="w-full lg:w-44"
            >
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
            <SelectTrigger aria-label="Sort" className="w-full lg:w-44">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending_first">Pending first</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <FeedbackQueue
            filteredFeedback={filteredFeedback}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            selectedIndex={selectedIndex}
            selectByOffset={selectByOffset}
            getModerationStatus={getModerationStatus}
          />
          <FeedbackDetail
            filteredFeedback={filteredFeedback}
            setSelectedId={setSelectedId}
            selectedFeedback={selectedFeedback}
            selectedIndex={selectedIndex}
            getModerationStatus={getModerationStatus}
            handleModeration={handleModeration}
            handleDelete={handleDelete}
            isActionLoading={isActionLoading}
          />
        </div>
      </div>
    </div>
  );
}
