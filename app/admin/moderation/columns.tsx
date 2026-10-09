"use client";

import { ColumnDef } from "@/lib/table/legacy";
import { ArrowUpDown, Sparkles, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { humanize, levelTone, statusTone } from "../components/admin-status";

export type ContentReport = {
  id: string;
  content_id?: string;
  content_type?: string;
  reason?: string | null;
  priority?: string | null;
  status?: string | null;
  created_at?: string | null;
  reporter_label?: string | null;
  reporter?: {
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
  creator_details?: {
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
  ai_metadata?: {
    verdict?: string;
    confidence?: number;
    suggestedStatus?: string | null;
    recommendedAction?: string | null;
    suggestedAction?: string | null;
  } | null;
};

export type FlaggedContent = {
  id: string;
  content_id?: string;
  content_type?: string;
  status?: string | null;
  flag_type?: string | null;
  confidence_score?: number | string | null;
  severity?: string;
  created_at?: string | null;
  content_details?: {
    title?: string | null;
    username?: string | null;
    full_name?: string | null;
  } | null;
  creator_details?: {
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
};

const formatConfidence = (val?: number | string | null) => {
  if (val === undefined || val === null) return "—";
  const num = Number(val);
  const normalized = num > 1 ? num : num * 100;
  return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`;
};

function SortableHeader({
  label,
  onToggle,
}: {
  label: string;
  onToggle: () => void;
}) {
  return (
    <Button variant="ghost" onClick={onToggle} className="-ml-2.5">
      {label}
      <ArrowUpDown data-icon="inline-end" />
    </Button>
  );
}

function aiVerdictTone(verdict?: string) {
  if (verdict === "Safe") return "success" as const;
  if (verdict?.includes("Violat")) return "destructive" as const;
  return "info" as const;
}

export const getReportColumns = (
  onViewDetails: (report: ContentReport) => void,
): ColumnDef<ContentReport>[] => [
  {
    accessorKey: "reason",
    header: "Subject & reporter",
    cell: ({ row }) => {
      const report = row.original;
      return (
        <div className="grid gap-0.5 py-1">
          <span className="line-clamp-1 font-medium">
            {humanize(report.reason, "No reason provided")}
          </span>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
            <span>{humanize(report.content_type, "Content")}</span>
            <span aria-hidden="true">·</span>
            <span>Reported by</span>
            {report.reporter ? (
              <ProfileHoverCard
                username={report.reporter.username || "unknown"}
                fullName={report.reporter.full_name || "Anonymous"}
                avatarUrl={report.reporter.avatar_url || undefined}
                variant="profile"
              >
                <span className="text-foreground cursor-pointer font-medium hover:underline">
                  {report.reporter.full_name || report.reporter.username}
                </span>
              </ProfileHoverCard>
            ) : (
              <span className="font-medium">
                {report.reporter_label || "Anonymous"}
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span>
              {report.created_at
                ? format(new Date(report.created_at), "MMM d")
                : "-"}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "ai_analysis",
    header: "AI recommendation",
    cell: ({ row }) => {
      const ai = row.original.ai_metadata;
      if (!ai)
        return (
          <span className="text-muted-foreground text-xs">Pending...</span>
        );

      const recommendedAction = ai.recommendedAction || ai.suggestedAction;
      const action =
        recommendedAction && recommendedAction !== "none"
          ? recommendedAction.replace(/_/g, " ")
          : ai.suggestedStatus
            ? `Set ${ai.suggestedStatus.replace(/_/g, " ")}`
            : "Review required";

      return (
        <div className="flex items-center gap-2">
          <Badge variant={aiVerdictTone(ai.verdict)} className="capitalize">
            <Sparkles data-icon="inline-start" aria-hidden="true" />
            {action}
          </Badge>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className="text-muted-foreground text-xs tabular-nums">
                {formatConfidence(ai.confidence)}
              </TooltipTrigger>
              <TooltipContent>Confidence score</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <SortableHeader
        label="Status"
        onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => {
      const status = row.original.status || "pending";
      return <Badge variant={statusTone(status)}>{humanize(status)}</Badge>;
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      return (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onViewDetails(row.original)}>
            Open case
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      );
    },
  },
];

export const getFlaggedColumns = (
  onViewDetails: (item: FlaggedContent) => void,
): ColumnDef<FlaggedContent>[] => [
  {
    id: "content_details",
    accessorFn: (row) => {
      const d = row.content_details;
      return [
        d?.title,
        d?.full_name,
        d?.username,
        row.content_id,
        row.content_type || "",
      ]
        .filter(Boolean)
        .join(" ");
    },
    header: "Content details",
    cell: ({ row }) => {
      const item = row.original;
      const title =
        item.content_details?.title ||
        item.content_details?.full_name ||
        item.content_details?.username ||
        "Untitled content";

      return (
        <div className="grid gap-0.5 py-1">
          <span className="line-clamp-1 font-medium">{title}</span>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
            {item.content_type && (
              <>
                <span>{humanize(item.content_type)}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>Created by</span>
            {item.creator_details ? (
              <ProfileHoverCard
                username={item.creator_details.username || "unknown"}
                fullName={item.creator_details.full_name || "Anonymous"}
                avatarUrl={item.creator_details.avatar_url || undefined}
                variant="profile"
              >
                <span className="text-foreground cursor-pointer font-medium hover:underline">
                  {item.creator_details.full_name ||
                    item.creator_details.username}
                </span>
              </ProfileHoverCard>
            ) : (
              <span>Unknown user</span>
            )}
            <span aria-hidden="true">·</span>
            <span>
              {item.created_at ? format(new Date(item.created_at), "PPP") : "-"}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <SortableHeader
        label="Status"
        onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => {
      const status = row.original.status || "pending";
      return <Badge variant={statusTone(status)}>{humanize(status)}</Badge>;
    },
  },
  {
    accessorKey: "severity",
    header: ({ column }) => (
      <SortableHeader
        label="Severity"
        onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => {
      const severity = row.original.severity || "unknown";
      return <Badge variant={levelTone(severity)}>{humanize(severity)}</Badge>;
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      return (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onViewDetails(row.original)}>
            Open flag
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      );
    },
  },
];
