"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  Brain,
  CheckCircle,
  ExternalLink,
  Loader2,
  Shield,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { getDetailedReportWithContext, takeModeratorAction } from "../moderation/actions";
import Link from "next/link";

interface ReportDetailViewProps {
  reportId: string;
  onActionTaken?: () => void;
}

type ActionType = "warn_user" | "remove_content" | "block_content" | "dismiss" | "escalate_to_legal";

interface ReportData {
  report: {
    id: string;
    reason: string;
    description: string;
    content_type: string;
    content_id: string;
    status: string;
    priority: string;
    created_at: string;
    reviewed_at?: string;
    resolution_notes?: string;
    [key: string]: unknown;
  };
  reporter: {
    id?: unknown;
    full_name?: unknown;
    username?: unknown;
    avatar_url?: unknown;
    [key: string]: unknown;
  } | null;
  reviewer: Record<string, unknown> | null;
  content: unknown;
  creator: {
    id?: unknown;
    full_name?: unknown;
    username?: unknown;
    avatar_url?: unknown;
    [key: string]: unknown;
  } | null;
}

export function ReportDetailView({
  reportId,
  onActionTaken,
}: ReportDetailViewProps) {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ActionType | "">("");
  const [actionReason, setActionReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        const result = await getDetailedReportWithContext(reportId);
        if (result.error || !result.data) {
          setError(result.error || "Failed to load report");
          toast.error(result.error || "Failed to load report");
        } else {
          setReportData(result.data);
          setError(null);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to load report";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [reportId]);

  const handleTakeAction = async () => {
    if (!selectedAction) {
      toast.error("Please select an action");
      return;
    }

    setActionLoading(true);
    try {
      const result = await takeModeratorAction(
        reportId,
        selectedAction as ActionType,
        actionReason
      );

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(result.message || "Action taken successfully");
        setActionDialogOpen(false);
        setSelectedAction("");
        setActionReason("");
        onActionTaken?.();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to take action";
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error || !reportData) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="flex items-center gap-4 py-6">
          <AlertCircle className="h-6 w-6 text-red-600" />
          <div>
            <p className="font-medium text-red-900">Error loading report</p>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { report, content, creator, reporter } = reportData;
  const aiMetadata = report.resolution_notes && typeof report.resolution_notes === 'string'
    ? parseAiMetadata(report.resolution_notes)
    : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Report #{report.id.slice(0, 8)}
              </CardTitle>
              <CardDescription>
                {new Date(report.created_at).toLocaleDateString()} at{" "}
                {new Date(report.created_at).toLocaleTimeString()}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Badge
                variant={
                  report.status === "resolved"
                    ? "default"
                    : report.status === "under_review"
                      ? "secondary"
                      : "outline"
                }
              >
                {report.status}
              </Badge>
              <Badge
                variant={
                  report.priority === "critical"
                    ? "destructive"
                    : report.priority === "high"
                      ? "secondary"
                      : "outline"
                }
              >
                {report.priority}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Report Reason</p>
              <p className="font-medium">{report.reason}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Content Type</p>
              <p className="font-medium">{report.content_type}</p>
            </div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Description</p>
            <p className="text-sm whitespace-pre-wrap rounded bg-muted p-3">
              {report.description}
            </p>
          </div>
        </CardContent>
      </Card>

      {reporter && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Reported by
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              {typeof reporter?.avatar_url === 'string' && reporter.avatar_url && (
                <img
                  src={reporter.avatar_url}
                  alt={String(reporter.full_name || '')}
                  className="h-10 w-10 rounded-full"
                />
              )}
              <div>
                <p className="font-medium">{String(reporter?.full_name || '')}</p>
                <p className="text-sm text-muted-foreground">
                  @{String(reporter?.username || '')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {content && typeof content === 'object' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Content Under Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const contentObj = content as Record<string, unknown>;
              return report.content_type === "project" ? (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground">Project Title</p>
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{String(contentObj?.title || '')}</p>
                      <Link
                        href={`/projects/${String(contentObj?.id || '')}`}
                        target="_blank"
                        className="text-blue-600 hover:underline"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Description</p>
                    <p className="text-sm whitespace-pre-wrap rounded bg-muted p-3">
                      {String(contentObj?.description || '')}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <p className="font-medium">{String(contentObj?.status || '')}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Created</p>
                      <p className="font-medium">
                        {new Date(String(contentObj?.created_at || '')).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground">Organization</p>
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{String(contentObj?.name || '')}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Description</p>
                    <p className="text-sm whitespace-pre-wrap rounded bg-muted p-3">
                      {String(contentObj?.description || 'No description')}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Type</p>
                      <p className="font-medium capitalize">{String(contentObj?.type || '')}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Verified</p>
                      <p className="font-medium">
                        {contentObj?.verified ? "Yes" : "No"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Username</p>
                      <p className="font-medium">@{String(contentObj?.username || '')}</p>
                    </div>
                  </div>
                </>
              );
            })()}

            {creator && (
              <div className="border-t pt-4">
                <p className="text-sm text-muted-foreground mb-2">Content Creator</p>
                <div className="flex items-center gap-3">
                  {typeof creator?.avatar_url === 'string' && creator.avatar_url && (
                    <img
                      src={creator.avatar_url}
                      alt={String(creator.full_name || '')}
                      className="h-10 w-10 rounded-full"
                    />
                  )}
                  <div>
                    <p className="font-medium">{String(creator.full_name || '')}</p>
                    <p className="text-sm text-muted-foreground">
                      @{String(creator.username || '')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {aiMetadata && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4" />
              AI Moderation Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Verdict</p>
              <p className="font-medium">{aiMetadata.verdict}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Reasoning</p>
              <p className="text-sm whitespace-pre-wrap rounded bg-white p-3">
                {aiMetadata.reasoning}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Confidence</p>
                <p className="font-medium">
                  {(aiMetadata.confidence * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Priority</p>
                <Badge variant="outline">{aiMetadata.priority}</Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Recommended Action</p>
                <Badge variant="secondary">
                  {aiMetadata.recommendedAction || "None"}
                </Badge>
              </div>
            </div>
            {aiMetadata.tags && aiMetadata.tags.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {aiMetadata.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {report.reviewed_by && reportData.reviewer ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Review History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <Shield className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">{String(reportData.reviewer?.full_name || '')}</p>
                <p className="text-sm text-muted-foreground">
                  Reviewed {new Date(String(report.reviewed_at || '')).toLocaleDateString()}
                </p>
              </div>
            </div>
            {report.resolution_notes && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">Notes</p>
                <p className="text-sm whitespace-pre-wrap rounded bg-muted p-3">
                  {report.resolution_notes}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Button
        onClick={() => setActionDialogOpen(true)}
        className="w-full"
        size="lg"
      >
        <Zap className="mr-2 h-4 w-4" />
        Take Moderator Action
      </Button>

      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take Moderator Action</DialogTitle>
            <DialogDescription>
              Choose an action to take on this report
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Action</label>
              <Select
                value={selectedAction}
                onValueChange={(value) => setSelectedAction(value as ActionType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select action..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dismiss">
                    Dismiss - Not a violation
                  </SelectItem>
                  <SelectItem value="warn_user">
                    Warn User - Send warning
                  </SelectItem>
                  <SelectItem value="remove_content">
                    Remove Content - Delete content
                  </SelectItem>
                  <SelectItem value="block_content">
                    Block Content - Block & flag
                  </SelectItem>
                  <SelectItem value="escalate_to_legal">
                    Escalate to Legal
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Reason (optional)</label>
              <Textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="Additional notes about this action..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActionDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleTakeAction}
              disabled={!selectedAction || actionLoading}
            >
              {actionLoading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Take Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function parseAiMetadata(resolutionNotes: string): {
  verdict: string;
  confidence: number;
  priority: string;
  reasoning: string;
  recommendedAction: string;
  tags: string[];
} | null {
  // Parse AI metadata from resolution notes
  // Format: "[AI triage] timestamp: verdict (confidence X%, priority Y). reasoning"
  const aiPattern = /\[AI triage\].*?:\s*(.*?)\s*\(confidence\s*(\d+)%,\s*priority\s*(.*?)\)\.\s*(.*?)(?:\n|$)/;
  const match = resolutionNotes.match(aiPattern);

  if (!match) return null;

  return {
    verdict: match[1],
    confidence: parseInt(match[2]) / 100,
    priority: match[3],
    reasoning: match[4],
    recommendedAction: extractRecommendedAction(resolutionNotes),
    tags: extractTags(resolutionNotes),
  };
}

function extractRecommendedAction(text: string): string {
  const actionMatch = text.match(/recommended.*?action:\s*(\w+(?:_\w+)*)/i);
  return actionMatch ? actionMatch[1] : "none";
}

function extractTags(text: string): string[] {
  const tagMatch = text.match(/tags?:\s*\[(.*?)\]/i);
  if (!tagMatch) return [];
  return tagMatch[1].split(",").map((t) => t.trim());
}
