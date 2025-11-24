'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertTriangle,
  ShieldAlert,
  Clock,
  CheckCircle,
  XCircle,
  User,
  Calendar,
  Eye,
  Bot,
  ShieldX,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getFlaggedContent,
  updateFlaggedContentStatus,
  getContentReports,
  updateContentReportStatus,
} from './actions';
import { format } from 'date-fns';
import { toast } from 'sonner';

type FlaggedContent = {
  id: string;
  content_type?: string;
  severity?: string;
  reason?: string;
  categories?: Record<string, boolean>;
  profiles?: {
    full_name?: string;
    username?: string;
    email?: string;
  };
  created_at?: string | null;
};

type AiMetadata = {
  verdict?: string;
  reasoning?: string;
  confidence?: number;
  priority?: string | null;
  suggestedStatus?: string | null;
  triagedAt?: string | null;
  tags?: string[];
};

type ContentReport = {
  id: string;
  content_id?: string;
  content_type?: string;
  reason?: string | null;
  description?: string | null;
  priority?: string | null;
  status?: string | null;
  created_at?: string | null;
  resolution_notes?: string | null;
  reporter?: {
    full_name?: string | null;
    username?: string | null;
    email?: string | null;
  } | null;
  reporter_id?: string | null;
  user_id?: string | null;
  ai_metadata?: AiMetadata | null;
  content_snapshot?: Record<string, unknown> | null;
};

type FlaggedFilter = 'pending' | 'blocked' | 'confirmed' | 'dismissed';
type ReportsFilter = 'pending' | 'under_review' | 'resolved' | 'dismissed';

type ModerationStats = {
  total: number;
  pending: number;
  blocked: number;
  critical: number;
  recentWeek: number;
  monthlyActivity: number;
};

type ReportsStats = {
  total: number;
  pending: number;
  resolved: number;
  highPriority: number;
  recentWeek: number;
};

const REPORT_RESOLVE_NOTE = 'Resolved via moderation dashboard';
const REPORT_DISMISS_NOTE = 'Dismissed via moderation dashboard';

export default function ModerationDashboard({
  initialStats,
  initialFlagged,
  initialReports,
  initialReportsStats,
}: {
  initialStats: ModerationStats;
  initialFlagged: FlaggedContent[];
  initialReports: ContentReport[];
  initialReportsStats: ReportsStats;
}) {
  const stats = initialStats;
  const reportsStats = initialReportsStats;
  const [flaggedContent, setFlaggedContent] = useState(initialFlagged);
  const [contentReports, setContentReports] = useState(initialReports);
  const [flaggedFilter, setFlaggedFilter] = useState<FlaggedFilter>('pending');
  const [reportFilter, setReportFilter] = useState<ReportsFilter>('pending');
  const [isPending, startTransition] = useTransition();
  const [selectedFlag, setSelectedFlag] = useState<FlaggedContent | null>(null);
  const [selectedReport, setSelectedReport] = useState<ContentReport | null>(null);
  const selectedReportAi = selectedReport?.ai_metadata ?? null;
  const selectedReportAiJson = selectedReportAi
    ? {
        verdict: selectedReportAi.verdict,
        recommendedAction: formatRecommendedAction(selectedReportAi.suggestedStatus),
        confidence: formatConfidencePercent(selectedReportAi.confidence),
        priority: selectedReportAi.priority || 'normal',
        tags: selectedReportAi.tags || [],
      }
    : null;

  const loadFlaggedContent = async (status: FlaggedFilter) => {
    startTransition(async () => {
      const result = await getFlaggedContent(status);
      if (result.data) {
        setFlaggedContent(result.data);
      }
    });
  };

  const loadContentReports = async (status: ReportsFilter) => {
    startTransition(async () => {
      const result = await getContentReports(status);
      if (result.data) {
        setContentReports(result.data);
      }
    });
  };

  const handleFlagStatusUpdate = async (
    id: string,
    status: FlaggedFilter,
    notes?: string,
  ) => {
    startTransition(async () => {
      const result = await updateFlaggedContentStatus(id, status, notes);
      if (result.error) {
        toast.error('Failed to update status');
        return;
      }
      toast.success('Status updated successfully');
      await loadFlaggedContent(flaggedFilter);
      setSelectedFlag(null);
    });
  };

  const handleReportStatusChange = async (
    id: string,
    status: ReportsFilter | 'escalated',
    notes?: string,
  ) => {
    startTransition(async () => {
      const result = await updateContentReportStatus(id, status, notes);
      if (result.error) {
        toast.error('Failed to update report');
        return;
      }
      toast.success('Report updated');
      await loadContentReports(reportFilter);
      setSelectedReport(null);
    });
  };

  const getSeverityColor = (severity?: string): 'secondary' | 'destructive' | 'default' => {
    switch ((severity || '').toLowerCase()) {
      case 'critical':
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      default:
        return 'secondary';
    }
  };

  const getPriorityVariant = (priority?: string | null): 'outline' | 'secondary' | 'destructive' => {
    switch ((priority || '').toLowerCase()) {
      case 'high':
        return 'destructive';
      case 'medium':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getStatusVariant = (status?: string | null): 'default' | 'outline' | 'secondary' => {
    switch ((status || '').toLowerCase()) {
      case 'resolved':
        return 'default';
      case 'dismissed':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  return (
    <TooltipProvider delayDuration={80}>
      <div className="container mx-auto max-w-7xl space-y-8 p-4 md:p-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Flagged</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pending}</div>
            <p className="text-xs text-muted-foreground">Needs attention</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Issues</CardTitle>
            <ShieldAlert className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.critical}</div>
            <p className="text-xs text-muted-foreground">High + critical</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Week</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.recentWeek}</div>
            <p className="text-xs text-muted-foreground">Last 7 days</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Flagged Content</CardTitle>
          <CardDescription>AI + community flagged posts that require review.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={flaggedFilter}
            onValueChange={(value) => {
              const next = value as FlaggedFilter;
              setFlaggedFilter(next);
              loadFlaggedContent(next);
            }}
          >
            <TabsList>
              <TabsTrigger value="pending">Pending ({stats.pending})</TabsTrigger>
              <TabsTrigger value="blocked">Blocked</TabsTrigger>
              <TabsTrigger value="confirmed">Confirmed</TabsTrigger>
              <TabsTrigger value="dismissed">Dismissed</TabsTrigger>
            </TabsList>
            <TabsContent value={flaggedFilter} className="space-y-4">
              {isPending ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              ) : flaggedContent.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">No items found</h3>
                  <p className="text-sm text-muted-foreground">There are no flagged items in this state.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Flag</TableHead>
                        <TableHead className="hidden sm:table-cell w-[130px]">Severity</TableHead>
                        <TableHead className="text-right w-[160px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {flaggedContent.map((item) => (
                        <TableRow key={item.id} className="text-sm">
                          <TableCell className="w-full">
                            <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="capitalize">
                                  {item.content_type === 'image' ? 'Image' : item.content_type || 'Content'}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  Flagged {formatSafeDate(item.created_at)}
                                </span>
                              </div>
                              {item.profiles && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <User className="h-3.5 w-3.5" />
                                  <span>
                                    {item.profiles.full_name || item.profiles.username || item.profiles.email}
                                  </span>
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <Badge variant={getSeverityColor(item.severity)} className="text-[11px] tracking-tight">
                              {item.severity?.toUpperCase() || 'UNKNOWN'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setSelectedFlag(item)}
                                    aria-label="View flag details"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">View</TooltipContent>
                              </Tooltip>
                              {flaggedFilter === 'pending' && (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() =>
                                          handleFlagStatusUpdate(item.id, 'blocked', 'Blocked for policy violation')
                                        }
                                        aria-label="Block content"
                                        disabled={isPending}
                                      >
                                        <ShieldX className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Block</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => handleFlagStatusUpdate(item.id, 'confirmed', 'Confirmed violation')}
                                        aria-label="Confirm violation"
                                        disabled={isPending}
                                      >
                                        <CheckCircle className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Confirm</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => handleFlagStatusUpdate(item.id, 'dismissed', 'False positive')}
                                        aria-label="Dismiss flag"
                                        disabled={isPending}
                                      >
                                        <XCircle className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Dismiss</TooltipContent>
                                  </Tooltip>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>User Reports</CardTitle>
          <CardDescription>Manual reports blended with AI insights + recommendations.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={reportFilter}
            onValueChange={(value) => {
              const next = value as ReportsFilter;
              setReportFilter(next);
              loadContentReports(next);
            }}
          >
            <TabsList>
              <TabsTrigger value="pending">Pending ({reportsStats.pending})</TabsTrigger>
              <TabsTrigger value="under_review">In review</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
              <TabsTrigger value="dismissed">Dismissed</TabsTrigger>
            </TabsList>
            <TabsContent value={reportFilter} className="space-y-4">
              {isPending ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              ) : contentReports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">No reports found</h3>
                  <p className="text-sm text-muted-foreground">There are no reports in this state.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Case</TableHead>
                        <TableHead>AI output</TableHead>
                        <TableHead className="hidden md:table-cell w-[140px]">Status</TableHead>
                        <TableHead className="text-right w-[160px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contentReports.map((report) => {
                        const ai = report.ai_metadata;
                        const canQuickResolve =
                          report.status === 'pending' || report.status === 'under_review' || report.status === null;
                        return (
                          <TableRow key={report.id} className="text-sm">
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <span className="font-semibold capitalize">
                                  {report.content_type === 'project' ? 'Project' : 'Profile'} report
                                </span>
                                <p className="text-xs text-muted-foreground">
                                  #{report.content_id || '—'} · Submitted {formatSafeDate(report.created_at)}
                                </p>
                                {report.reporter && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <User className="h-3.5 w-3.5" />
                                    <span>
                                      {report.reporter.full_name || report.reporter.username || report.reporter.email}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {ai ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 text-sm font-medium">
                                    <Bot className="h-4 w-4 text-muted-foreground" />
                                    {ai.verdict || 'Pending triage'}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Confidence {formatConfidencePercent(ai.confidence)} · Recommended {formatRecommendedAction(ai.suggestedStatus)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">Priority {ai.priority || 'normal'}</p>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">Awaiting AI assessment</p>
                              )}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-right md:text-left">
                              <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                                <span className="text-sm font-semibold text-foreground">
                                  {(report.status || 'pending').replace(/_/g, ' ')}
                                </span>
                                <span>Priority {report.priority || 'normal'}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => setSelectedReport(report)}
                                      aria-label="View report details"
                                    >
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">View</TooltipContent>
                                </Tooltip>
                                {canQuickResolve && (
                                  <>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          onClick={() =>
                                            handleReportStatusChange(report.id, 'resolved', REPORT_RESOLVE_NOTE)
                                          }
                                          aria-label="Resolve report"
                                          disabled={isPending}
                                        >
                                          <CheckCircle className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">Resolve</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          onClick={() => handleReportStatusChange(report.id, 'under_review')}
                                          aria-label="Mark for review"
                                          disabled={isPending}
                                        >
                                          <Clock className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">Review</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          onClick={() =>
                                            handleReportStatusChange(report.id, 'dismissed', REPORT_DISMISS_NOTE)
                                          }
                                          aria-label="Dismiss report"
                                          disabled={isPending}
                                        >
                                          <XCircle className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">Dismiss</TooltipContent>
                                    </Tooltip>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedFlag)} onOpenChange={(open) => !open && setSelectedFlag(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Flag details</DialogTitle>
            <DialogDescription>
              Review the flagged content, see AI context, and take action.
            </DialogDescription>
          </DialogHeader>
          {selectedFlag && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getSeverityColor(selectedFlag.severity)}>
                  {selectedFlag.severity?.toUpperCase() || 'UNKNOWN'}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {formatSafeDate(selectedFlag.created_at, 'PPP p')}
                </span>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/30 p-4">
                <p className="text-sm font-semibold">Why it was flagged</p>
                <p className="text-sm text-muted-foreground">{selectedFlag.reason || 'No reason provided'}</p>
              </div>
              {selectedFlag.categories && Object.keys(selectedFlag.categories).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(selectedFlag.categories).map(([key, value]) => {
                    if (!value) return null;
                    return (
                      <Badge key={key} variant="outline" className="text-[11px] uppercase">
                        {key.replace(/_/g, ' ')}
                      </Badge>
                    );
                  })}
                </div>
              )}
              {selectedFlag.profiles && (
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/50 p-3 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>
                    {selectedFlag.profiles.full_name || selectedFlag.profiles.username || selectedFlag.profiles.email}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleFlagStatusUpdate(selectedFlag.id, 'blocked', 'Blocked via detail modal')}
                  disabled={isPending}
                >
                  Block content
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleFlagStatusUpdate(selectedFlag.id, 'confirmed', 'Confirmed via detail modal')}
                  disabled={isPending}
                >
                  Confirm violation
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleFlagStatusUpdate(selectedFlag.id, 'dismissed', 'Dismissed as false positive')}
                  disabled={isPending}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedReport)} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Report details</DialogTitle>
            <DialogDescription>Deep dive into the user report + AI recommendations.</DialogDescription>
          </DialogHeader>
          {selectedReport && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getStatusVariant(selectedReport.status)}>
                  {selectedReport.status || 'pending'}
                </Badge>
                <Badge variant={getPriorityVariant(selectedReport.priority)}>
                  {selectedReport.priority || 'normal'} priority
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Submitted {formatSafeDate(selectedReport.created_at, 'PPP p')}
                </span>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/30 p-4 space-y-2">
                <div>
                  <p className="text-sm font-semibold">Reason</p>
                  <p className="text-sm text-muted-foreground">{selectedReport.reason || 'No reason provided'}</p>
                </div>
                {selectedReport.description && (
                  <div>
                    <p className="text-sm font-semibold">Reporter notes</p>
                    <p className="text-sm text-muted-foreground">{selectedReport.description}</p>
                  </div>
                )}
              </div>
              {selectedReport.reporter && (
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/50 p-3 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>
                    {selectedReport.reporter.full_name || selectedReport.reporter.username || selectedReport.reporter.email}
                  </span>
                </div>
              )}
              {selectedReportAi && (
                <div className="space-y-3 rounded-md border border-dashed border-border/70 bg-muted/15 p-4">
                  <div>
                    <p className="text-xs uppercase text-muted-foreground tracking-wide">AI verdict</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedReportAi.verdict || 'Pending AI verdict'}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Confidence {formatConfidencePercent(selectedReportAi.confidence)}
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-3 text-sm sm:grid-cols-3">
                    <div className="rounded-md bg-background/80 p-3">
                      <p className="text-xs uppercase text-muted-foreground">Recommended action</p>
                      <p className="font-semibold">{formatRecommendedAction(selectedReportAi.suggestedStatus)}</p>
                    </div>
                    <div className="rounded-md bg-background/80 p-3">
                      <p className="text-xs uppercase text-muted-foreground">Priority</p>
                      <p className="font-semibold capitalize">{selectedReportAi.priority || 'normal'}</p>
                    </div>
                    <div className="rounded-md bg-background/80 p-3">
                      <p className="text-xs uppercase text-muted-foreground">Triaged</p>
                      <p className="font-semibold">{formatSafeDate(selectedReportAi.triagedAt)}</p>
                    </div>
                  </div>
                  {selectedReportAi.tags && selectedReportAi.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      {selectedReportAi.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-[10px] capitalize">
                          {tag.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {selectedReportAi.reasoning && (
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">AI resolution thoughts</p>
                      <div className="mt-1 rounded-md bg-background/80 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                        {selectedReportAi.reasoning}
                      </div>
                    </div>
                  )}
                  {selectedReportAiJson && (
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">AI output (JSON)</p>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-background/60 p-3 text-xs text-muted-foreground">
                        {JSON.stringify(selectedReportAiJson, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
              {selectedReport.content_snapshot && (
                <div className="rounded-md border border-border/70 bg-background/50 p-3">
                  <p className="text-sm font-semibold">Content snapshot</p>
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/40 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(selectedReport.content_snapshot, null, 2)}
                  </pre>
                </div>
              )}
              {selectedReport.resolution_notes && (
                <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
                  <p className="font-semibold">Resolution notes</p>
                  <p>{selectedReport.resolution_notes}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
                <Button
                  size="sm"
                  onClick={() => handleReportStatusChange(selectedReport.id, 'resolved', REPORT_RESOLVE_NOTE)}
                  disabled={isPending}
                >
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReportStatusChange(selectedReport.id, 'under_review')}
                  disabled={isPending}
                >
                  Keep reviewing
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleReportStatusChange(selectedReport.id, 'dismissed', REPORT_DISMISS_NOTE)}
                  disabled={isPending}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </TooltipProvider>
  );
}

function formatSafeDate(value?: string | null, pattern = 'PPp') {
  if (!value) {
    return 'Unknown';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }
  return format(parsed, pattern);
}

function formatConfidencePercent(value?: number) {
  if (value === undefined || value === null) {
    return '—';
  }
  const normalized = value > 1 ? value : value * 100;
  return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`;
}

function formatRecommendedAction(value?: string | null) {
  if (!value) {
    return 'manual review';
  }
  const friendly = value.replace(/_/g, ' ');
  return friendly.charAt(0).toUpperCase() + friendly.slice(1);
}
