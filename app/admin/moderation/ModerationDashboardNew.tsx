'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import {
  ShieldAlert,
  Clock,
  CheckCircle,
  XCircle,
  User,
  Calendar,
  Bot,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Loader2,
  CheckCheck,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  getFlaggedContent,
  updateFlaggedContentStatus,
  getContentReports,
  updateContentReportStatus,
  runAiReviewForProject,
  takeFlaggedContentAction,
  takeModeratorAction,
} from './actions';
import { format } from 'date-fns';
import { toast } from 'sonner';
import Link from 'next/link';
import { DataTable } from './data-table';
import { getReportColumns, getFlaggedColumns } from './columns';

// Types
type AiReasoningStep = {
  step: number;
  title: string;
  analysis: string;
  conclusion: string;
};

type AiConfidenceBreakdown = {
  evidenceStrength: number;
  severityAssessment: number;
  contextClarity: number;
};

type AiMetadata = {
  triagedAt?: string | null;
  verdict?: string;
  shortSummary?: string;
  reasoning?: string;
  reasoningSteps?: AiReasoningStep[];
  confidence?: number;
  confidenceBreakdown?: AiConfidenceBreakdown;
  priority?: string | null;
  suggestedStatus?: string | null;
  recommendedAction?: string | null;
  actionJustification?: string;
  tags?: string[];
  toolsUsed?: string[];
};

type ContentDetails = {
  id?: string;
  title?: string | null;
  name?: string | null;
  creator_id?: string | null;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
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
    id?: string;
    full_name?: string | null;
    username?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  } | null;
  reporter_id?: string | null;
  user_id?: string | null;
  ai_metadata?: AiMetadata | null;
  content_snapshot?: Record<string, unknown> | null;
  content_details?: ContentDetails | null;
  creator_details?: ContentDetails | null;
};

type FlaggedContent = {
  id: string;
  content_id?: string;
  content_type?: string;
  status?: string | null;
  flag_type?: string | null;
  confidence_score?: number | string | null;
  flag_details?: {
    verdict?: string;
    shortSummary?: string;
    reasoning?: string;
    reasoningSteps?: AiReasoningStep[];
    toolsUsed?: string[];
  } | null;
  severity?: string;
  reason?: string;
  categories?: Record<string, boolean> | null;
  content_details?: ContentDetails | null;
  creator_details?: ContentDetails | null;
  created_at?: string | null;
};

type FlaggedFilter = 'pending' | 'blocked' | 'confirmed' | 'dismissed';
type ReportsFilter = 'pending' | 'under_review' | 'resolved' | 'dismissed';

type ModerationStats = {
  total: number;
  pending: number;
  pendingFlags: number;
  pendingReports: number;
  resolved: number;
  aiApproved: number;
  automationLast24h: number;
  automationTotal: number;
  lastAutomationAt?: string | null;
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

// SSE Event Types
type ScanEvent = {
  type: 'start' | 'progress' | 'analyzing' | 'result' | 'complete' | 'error';
  data: {
    totalReports?: number;
    totalProjects?: number;
    totalItems?: number;
    processed?: number;
    total?: number;
    percentComplete?: number;
    itemType?: 'report' | 'project';
    itemId?: string;
    itemTitle?: string;
    reporterName?: string;
    current?: number;
    success?: boolean;
    flagged?: boolean;
    result?: AiMetadata | Record<string, unknown>;
    error?: string;
    message?: string;
    reportsProcessed?: number;
    projectsProcessed?: number;
  };
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

  const [isFlaggedLoading, setIsFlaggedLoading] = useState(false);
  const [isReportsLoading, setIsReportsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const [selectedFlag, setSelectedFlag] = useState<FlaggedContent | null>(null);
  const [selectedReport, setSelectedReport] = useState<ContentReport | null>(null);

  // AI Scan streaming state
  const [isScanActive, setIsScanActive] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    current: number;
    total: number;
    percentComplete: number;
    currentItem?: string;
    currentItemType?: string;
    reportsProcessed: number;
    projectsProcessed: number;
  } | null>(null);
  const [scanResults, setScanResults] = useState<Array<{
    itemType: string;
    itemId: string;
    success: boolean;
    flagged?: boolean;
    result?: AiMetadata | Record<string, unknown>;
    error?: string;
  }>>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const automationLastRunLabel = stats.lastAutomationAt
    ? formatSafeDate(stats.lastAutomationAt, 'PPP p')
    : 'No automation run recorded yet';

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const loadFlaggedContent = async (status: FlaggedFilter) => {
    setIsFlaggedLoading(true);
    try {
      const result = await getFlaggedContent(status);
      if (result.data) {
        setFlaggedContent(result.data);
      }
    } finally {
      setIsFlaggedLoading(false);
    }
  };

  const loadContentReports = async (status: ReportsFilter) => {
    setIsReportsLoading(true);
    try {
      const result = await getContentReports(status);
      if (result.data) {
        setContentReports(result.data);
      }
    } finally {
      setIsReportsLoading(false);
    }
  };

  const handleFlagStatusUpdate = async (id: string, status: FlaggedFilter, notes?: string) => {
    setIsActionLoading(true);
    try {
      const result = await updateFlaggedContentStatus(id, status, notes);
      if (result.error) {
        toast.error('Failed to update status');
        return;
      }
      toast.success('Status updated successfully');
      await loadFlaggedContent(flaggedFilter);
      setSelectedFlag(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleReportStatusChange = async (
    id: string,
    status: ReportsFilter,
    notes?: string
  ) => {
    setIsActionLoading(true);
    try {
      const result = await updateContentReportStatus(id, status, notes);
      if (result.error) {
        toast.error(`Failed to update report: ${result.error}`);
        return;
      }
      toast.success('Report updated');
      await loadContentReports(reportFilter);
      setSelectedReport(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRunAiReviewForFlag = async (flag: FlaggedContent) => {
    if (!flag.content_id || flag.content_type !== 'project') {
      toast.error('AI review is only available for projects');
      return;
    }

    setIsActionLoading(true);
    try {
      const result = await runAiReviewForProject(flag.content_id);
      if (result.error) {
        toast.error(`AI review failed: ${result.error}`);
        return;
      }
      if (result.data?.flagged) {
        toast.success('AI review flagged the project');
      } else {
        toast.info('AI review found no violations');
      }
      await loadFlaggedContent(flaggedFilter);
      setSelectedFlag(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleManualReportAction = async (
    reportId: string,
    action: 'warn_user' | 'remove_content' | 'block_content',
    reason?: string
  ) => {
    setIsActionLoading(true);
    try {
      const result = await takeModeratorAction(reportId, action, reason);
      if (result.error) {
        toast.error(`Failed to apply action: ${result.error}`);
        return;
      }
      toast.success('Moderation action applied');
      await loadContentReports(reportFilter);
      setSelectedReport(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Start AI Scan with Server-Sent Events
  const handleRunAiScan = useCallback(() => {
    if (isScanActive) return;

    setIsScanActive(true);
    setScanProgress(null);
    setScanResults([]);

    const eventSource = new EventSource('/api/admin/moderation/scan-stream');
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const parsed: ScanEvent = JSON.parse(event.data);

        switch (parsed.type) {
          case 'start':
            setScanProgress({
              current: 0,
              total: parsed.data.totalItems || 0,
              percentComplete: 0,
              reportsProcessed: 0,
              projectsProcessed: 0,
            });
            toast.info(`Starting AI scan: ${parsed.data.totalReports} reports, ${parsed.data.totalProjects} projects`);
            break;

          case 'analyzing':
            setScanProgress(prev => prev ? {
              ...prev,
              currentItem: parsed.data.itemTitle,
              currentItemType: parsed.data.itemType,
              current: parsed.data.current || prev.current,
            } : null);
            break;

          case 'progress':
            setScanProgress(prev => prev ? {
              ...prev,
              current: parsed.data.processed || 0,
              percentComplete: parsed.data.percentComplete || 0,
            } : null);
            break;

          case 'result':
            setScanResults(prev => [...prev, {
              itemType: parsed.data.itemType || 'unknown',
              itemId: parsed.data.itemId || '',
              success: parsed.data.success || false,
              flagged: parsed.data.flagged,
              result: parsed.data.result as AiMetadata | Record<string, unknown>,
              error: parsed.data.error,
            }]);
            if (parsed.data.itemType === 'report') {
              setScanProgress(prev => prev ? { ...prev, reportsProcessed: prev.reportsProcessed + 1 } : null);
            } else {
              setScanProgress(prev => prev ? { ...prev, projectsProcessed: prev.projectsProcessed + 1 } : null);
            }
            break;

          case 'complete':
            toast.success(parsed.data.message || 'AI scan completed');
            eventSource.close();
            eventSourceRef.current = null;
            // Refresh data
            loadContentReports(reportFilter);
            loadFlaggedContent(flaggedFilter);
            // Keep dialog open briefly to show completion
            setTimeout(() => {
              setIsScanActive(false);
              setScanProgress(null);
            }, 2000);
            break;

          case 'error':
            toast.error(parsed.data.message || 'AI scan failed');
            eventSource.close();
            eventSourceRef.current = null;
            setIsScanActive(false);
            break;
        }
      } catch (e) {
        console.error('Failed to parse SSE event:', e);
      }
    };

    eventSource.onerror = () => {
      toast.error('Connection to AI scan lost');
      eventSource.close();
      eventSourceRef.current = null;
      setIsScanActive(false);
    };
  }, [isScanActive, reportFilter, flaggedFilter]);

  const handleReportAiApproval = async (report: ContentReport) => {
    if (!report.ai_metadata) {
      toast.error('No AI recommendation available');
      return;
    }
    const suggestedStatus = report.ai_metadata.suggestedStatus;
    const validStatuses: ReportsFilter[] = ['pending', 'under_review', 'resolved', 'dismissed'];
    const action = validStatuses.includes(suggestedStatus as ReportsFilter)
      ? (suggestedStatus as ReportsFilter)
      : 'under_review';
    await handleReportStatusChange(report.id, action, 'Approved AI recommendation');
  };

  const reportColumns = useMemo(() => getReportColumns(
    setSelectedReport
  ), [setSelectedReport]);

  const flaggedColumns = useMemo(() => getFlaggedColumns(
    setSelectedFlag
  ), [setSelectedFlag]);

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
      case 'critical':
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

  const getFlagContentUrl = (flag: FlaggedContent) => {
    if (!flag.content_id) return null;
    if (flag.content_type === 'project') {
      return `/projects/${flag.content_id}`;
    }
    if (flag.content_type === 'profile') {
      const profileSlug = flag.content_details?.username || flag.content_id;
      return `/profile/${profileSlug}`;
    }
    if (flag.content_type === 'organization') {
      const orgSlug = flag.content_details?.username || flag.content_id;
      return `/organization/${orgSlug}`;
    }
    return null;
  };

  return (
    <TooltipProvider>
      <div className="container mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        {/* Unified Header Row */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Content Moderation</h1>
              <p className="text-muted-foreground mt-1">
                Clear review workflow for queue triage, AI approvals, and automated moderation runs.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleRunAiScan}
                disabled={isScanActive}
                className={cn(isScanActive && "animate-pulse")}
              >
                {isScanActive ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {isScanActive ? 'Scanning...' : 'Run AI Scan Now'}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Auto-run: every 24 hours</Badge>
              <span className="text-muted-foreground">Last automation run: {automationLastRunLabel}</span>
            </div>
          </div>

          {/* Operations Snapshot */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="shadow-sm border-l-4 border-l-amber-500">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Needs Review</CardTitle>
                <Clock className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.pending}</div>
                <p className="text-xs text-muted-foreground">
                  {stats.pendingReports} reports · {stats.pendingFlags} AI flags · {stats.critical} critical
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Resolved Cases</CardTitle>
                <CheckCircle className="h-4 w-4 text-emerald-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.resolved}</div>
                <p className="text-xs text-muted-foreground">Reports and flags closed by moderation decisions</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">AI Approved Actions</CardTitle>
                <CheckCheck className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.aiApproved}</div>
                <p className="text-xs text-muted-foreground">Times moderators accepted AI recommendations</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Automation Output (24h)</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.automationLast24h}</div>
                <p className="text-xs text-muted-foreground">AI-generated triage/flags ({stats.automationTotal} all time)</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* AI Scan Progress Dialog */}
        <Dialog open={isScanActive} onOpenChange={(open) => !open && !scanProgress && setIsScanActive(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Moderation Scan
              </DialogTitle>
              <DialogDescription>
                Analyzing content with step-by-step reasoning...
              </DialogDescription>
            </DialogHeader>

            {scanProgress && (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Progress</span>
                    <span className="font-medium">{scanProgress.percentComplete}%</span>
                  </div>
                  <Progress value={scanProgress.percentComplete} className="h-2" />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-muted-foreground">Reports Processed</p>
                    <p className="text-lg font-semibold">{scanProgress.reportsProcessed}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-muted-foreground">Projects Scanned</p>
                    <p className="text-lg font-semibold">{scanProgress.projectsProcessed}</p>
                  </div>
                </div>

                {scanProgress.currentItem && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-xs font-medium text-primary uppercase">
                        Analyzing {scanProgress.currentItemType}
                      </span>
                    </div>
                    <p className="text-sm font-medium truncate">{scanProgress.currentItem}</p>
                  </div>
                )}

                {scanResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {scanResults.slice(-5).map((result, i) => {
                      const verdict = (result.result as { verdict?: string })?.verdict;
                      const isProject = result.itemType === 'project';
                      const statusLabel = isProject
                        ? result.flagged
                          ? 'Flagged'
                          : 'Clean'
                        : 'Triaged';
                      const statusVariant = isProject && result.flagged ? 'destructive' : 'secondary';

                      return (
                        <div
                          key={`${result.itemId}-${i}`}
                          className={`text-xs p-2 rounded flex items-center gap-2 ${result.success
                            ? 'bg-primary/10 text-primary'
                            : 'bg-destructive/10 text-destructive'
                            }`}
                        >
                          {result.success ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          <span className="capitalize">{result.itemType}</span>
                          <Badge variant={statusVariant} className="text-[10px] capitalize">
                            {statusLabel}
                          </Badge>
                          {verdict && (
                            <span className="ml-auto max-w-37.5 truncate">{verdict}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Main Content Tabs */}
        <Tabs defaultValue="reports" className="space-y-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2">
            <TabsTrigger value="reports" className="gap-2">
              <User className="h-4 w-4" />
              Reports Queue ({stats.pendingReports})
            </TabsTrigger>
            <TabsTrigger value="flagged" className="gap-2">
              <ShieldAlert className="h-4 w-4" />
              AI Flags Queue ({stats.pendingFlags})
            </TabsTrigger>
          </TabsList>

          {/* User Reports Tab */}
          <TabsContent value="reports">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">User Reports</CardTitle>
                    <CardDescription>
                      Manual reports with AI analysis. {reportsStats.resolved} reports resolved so far.
                    </CardDescription>
                  </div>
                </div>
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
                  <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-2">
                    <TabsTrigger value="pending">Pending ({stats.pendingReports})</TabsTrigger>
                    <TabsTrigger value="under_review">In Review</TabsTrigger>
                    <TabsTrigger value="resolved">Resolved</TabsTrigger>
                    <TabsTrigger value="dismissed">Dismissed</TabsTrigger>
                  </TabsList>

                  <TabsContent value={reportFilter}>
                    {isReportsLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : contentReports.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-lg bg-muted/20">
                        <CheckCircle className="mb-4 h-12 w-12 text-muted-foreground/50" />
                        <h3 className="text-xl font-semibold">All caught up!</h3>
                        <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                          There are no reports in the <span className="font-medium text-foreground">{reportFilter}</span> queue right now.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-card shadow-sm overflow-hidden">
                        {/* @ts-ignore - structural typing match mostly fine, ignoring distinct type definition mismatch for now */}
                        <DataTable
                          columns={reportColumns}
                          data={contentReports}
                          searchKey="reason"
                        />
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Flagged Content Tab */}
          <TabsContent value="flagged">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">AI Flagged Content</CardTitle>
                <CardDescription>Automatically detected policy violations</CardDescription>
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
                  <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-2">
                    <TabsTrigger value="pending">Pending ({stats.pendingFlags})</TabsTrigger>
                    <TabsTrigger value="blocked">Blocked</TabsTrigger>
                    <TabsTrigger value="confirmed">Confirmed</TabsTrigger>
                    <TabsTrigger value="dismissed">Dismissed</TabsTrigger>
                  </TabsList>

                  <TabsContent value={flaggedFilter}>
                    {isFlaggedLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : flaggedContent.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-lg bg-muted/20">
                        <CheckCircle className="mb-4 h-12 w-12 text-muted-foreground/50" />
                        <h3 className="text-xl font-semibold">Clean Slate!</h3>
                        <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                          No flagged content found in the <span className="font-medium text-foreground">{flaggedFilter}</span> queue.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-card shadow-sm overflow-hidden">
                        {/* @ts-ignore */}
                        <DataTable
                          columns={flaggedColumns}
                          data={flaggedContent}
                          searchKey="content_details"
                        />
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Flagged Content Detail Dialog */}
        <Dialog open={Boolean(selectedFlag)} onOpenChange={(open) => !open && setSelectedFlag(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Flag Details</DialogTitle>
              <DialogDescription>
                Review the flagged content and take action.
              </DialogDescription>
            </DialogHeader>
            {selectedFlag && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={getFlagStatusVariant(selectedFlag.status)}>
                    {formatFlagStatus(selectedFlag.status)}
                  </Badge>
                  <Badge variant={getSeverityColor(selectedFlag.severity)}>
                    {selectedFlag.severity?.toUpperCase() || 'UNKNOWN'}
                  </Badge>
                  {selectedFlag.flag_type && (
                    <Badge variant="secondary" className="uppercase text-[10px]">
                      {selectedFlag.flag_type.replace(/_/g, ' ')}
                    </Badge>
                  )}
                  {selectedFlag.confidence_score !== undefined && selectedFlag.confidence_score !== null && (
                    <Badge variant="outline" className="text-[10px]">
                      {formatConfidencePercent(Number(selectedFlag.confidence_score))} confidence
                    </Badge>
                  )}
                  <span className="text-sm text-muted-foreground ml-auto">
                    {formatSafeDate(selectedFlag.created_at, 'PPP p')}
                  </span>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-md border bg-muted/30 p-4">
                    <p className="text-sm font-semibold mb-1">Reason for Flag</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedFlag.flag_details?.shortSummary || selectedFlag.reason || 'No reason provided'}
                    </p>
                  </div>

                  {selectedFlag.flag_details?.reasoning && (
                    <div className="rounded-md border bg-background p-4">
                      <p className="text-xs uppercase text-muted-foreground mb-1">AI Verdict</p>
                      <p className="text-sm font-medium text-foreground">
                        {selectedFlag.flag_details.verdict || selectedFlag.flag_details.reasoning}
                      </p>
                    </div>
                  )}
                </div>

                {selectedFlag.flag_details?.reasoningSteps &&
                  selectedFlag.flag_details.reasoningSteps.length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full justify-between")}>
                        <span className="flex items-center gap-2">
                          <ChevronRight className="h-4 w-4 transition-transform in-data-[state=open]:rotate-90" />
                          Reasoning Steps ({selectedFlag.flag_details.reasoningSteps.length})
                        </span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2 space-y-2">
                        {selectedFlag.flag_details.reasoningSteps.map((step, idx) => (
                          <div key={idx} className="rounded-lg bg-muted/20 p-3 border-l-2 border-primary/30 text-sm">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-[10px] h-5">Step {step.step}</Badge>
                              <span className="font-medium">{step.title}</span>
                            </div>
                            <p className="text-muted-foreground mb-1.5">{step.analysis}</p>
                            <p className="font-medium text-primary text-xs">→ {step.conclusion}</p>
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                <div className="flex flex-wrap gap-2 border-t pt-4 justify-end">
                  {getFlagContentUrl(selectedFlag) && (
                    <Link
                      href={getFlagContentUrl(selectedFlag)!}
                      target="_blank"
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View Content
                    </Link>
                  )}

                  {selectedFlag.content_type === 'project' && selectedFlag.content_id && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleRunAiReviewForFlag(selectedFlag)}
                      disabled={isActionLoading}
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      Re-run AI
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleFlagStatusUpdate(selectedFlag.id, 'dismissed', 'Dismissed as false positive')}
                    disabled={isActionLoading}
                  >
                    Dismiss
                  </Button>

                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      takeFlaggedContentAction(
                        selectedFlag.id,
                        'block_content',
                        'Blocked via moderation review'
                      )
                    }
                    disabled={isActionLoading}
                  >
                    Block Content
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Report Detail Sheet */}
        <Dialog open={Boolean(selectedReport)} onOpenChange={(open) => !open && setSelectedReport(null)}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader className="mb-6">
              <DialogTitle className="flex items-center gap-2">
                Report Details
                {selectedReport?.ai_metadata?.triagedAt && (
                  <Badge variant="outline" className="ml-2 text-xs font-normal">
                    <Bot className="h-3 w-3 mr-1" />
                    AI Analyzed
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                {selectedReport?.reason || 'Review report and take action'}
              </DialogDescription>
            </DialogHeader>

            {selectedReport && (
              <div className="space-y-6">
                {/* Status & Priority */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={getStatusVariant(selectedReport.status)}>
                    {selectedReport.status?.replace('_', ' ') || 'pending'}
                  </Badge>
                  <Badge variant={getPriorityVariant(selectedReport.priority)}>
                    {selectedReport.priority || 'normal'} priority
                  </Badge>
                  <span className="text-sm text-muted-foreground ml-auto">
                    {formatSafeDate(selectedReport.created_at, 'PPP p')}
                  </span>
                </div>

                {/* Reporter Info - Clickable */}
                {selectedReport.reporter && (
                  <div className="rounded-lg border bg-card p-4">
                    <p className="text-xs uppercase text-muted-foreground mb-2 font-semibold tracking-wider">Reported By</p>
                    <Link
                      href={`/profile/${selectedReport.reporter.username || selectedReport.reporter.id}`}
                      className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={selectedReport.reporter.avatar_url || undefined} />
                        <AvatarFallback>
                          {(selectedReport.reporter.full_name?.[0] || selectedReport.reporter.username?.[0] || 'U').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">
                          {selectedReport.reporter.full_name || selectedReport.reporter.username || 'Unknown'}
                        </p>
                        {selectedReport.reporter.username && (
                          <p className="text-xs text-muted-foreground">@{selectedReport.reporter.username}</p>
                        )}
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </div>
                )}

                {/* Reported Content - Clickable */}
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-xs uppercase text-muted-foreground mb-2 font-semibold tracking-wider">Reported Content</p>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Badge variant={selectedReport.content_type === 'project' ? 'default' : 'secondary'}>
                        {selectedReport.content_type === 'project' ? '📋 Project' : '👤 Profile'}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <Link
                          href={selectedReport.content_type === 'project'
                            ? `/projects/${selectedReport.content_id}`
                            : `/profile/${selectedReport.creator_details?.username || selectedReport.content_id}`}
                          className="font-medium text-sm hover:underline flex items-center gap-1"
                        >
                          {selectedReport.content_type === 'project'
                            ? (selectedReport.content_details?.title || 'Untitled Project')
                            : (selectedReport.creator_details?.full_name || 'Unknown User')}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Report Reason & Description */}
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">Reason</p>
                    <p className="text-sm text-muted-foreground">{selectedReport.reason || 'No reason provided'}</p>
                  </div>
                  {selectedReport.description && (
                    <div>
                      <p className="text-sm font-semibold">Reporter Notes</p>
                      <p className="text-sm text-muted-foreground">{selectedReport.description}</p>
                    </div>
                  )}
                </div>

                {/* AI Analysis Section - Expandable */}
                {selectedReport.ai_metadata?.triagedAt && (
                  <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <Bot className="h-5 w-5 text-primary" />
                      <span className="font-semibold">AI Analysis</span>
                      <Badge variant="outline" className="ml-auto text-xs">
                        {formatConfidencePercent(selectedReport.ai_metadata.confidence)} confident
                      </Badge>
                    </div>

                    {/* Verdict */}
                    <div className="rounded-md bg-background p-3">
                      <p className="text-xs uppercase text-muted-foreground mb-1">Verdict</p>
                      <p className="font-medium">{selectedReport.ai_metadata.verdict}</p>
                    </div>

                    {/* Short Summary */}
                    {selectedReport.ai_metadata.shortSummary && (
                      <div className="rounded-md bg-background p-3">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Summary</p>
                        <p className="text-sm text-muted-foreground">{selectedReport.ai_metadata.shortSummary}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md bg-background p-3">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Recommended Action</p>
                        <Badge variant="secondary" className="capitalize">
                          {formatAiRecommendation(
                            selectedReport.ai_metadata.recommendedAction,
                            selectedReport.ai_metadata.suggestedStatus
                          )}
                        </Badge>
                      </div>
                      <div className="rounded-md bg-background p-3">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Priority</p>
                        <Badge variant={getPriorityVariant(selectedReport.ai_metadata.priority)} className="capitalize">
                          {selectedReport.ai_metadata.priority || 'Normal'}
                        </Badge>
                      </div>
                    </div>

                    {/* Reasoning Steps - Expandable */}
                    {selectedReport.ai_metadata.reasoningSteps && selectedReport.ai_metadata.reasoningSteps.length > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full justify-between")}>
                          <span className="flex items-center gap-2">
                            <ChevronRight className="h-4 w-4 transition-transform in-data-[state=open]:rotate-90" />
                            Reasoning Steps
                          </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2 space-y-2">
                          {selectedReport.ai_metadata.reasoningSteps.map((step, idx) => (
                            <div key={idx} className="rounded-md bg-background p-3 border-l-2 border-primary/30 text-sm">
                              <p className="font-medium text-xs mb-1">{step.title}</p>
                              <p className="text-muted-foreground">{step.analysis}</p>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 border-t pt-4 justify-end">
                  {selectedReport.ai_metadata?.suggestedStatus && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleReportAiApproval(selectedReport)}
                      disabled={isActionLoading}
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      Approve AI Suggestion
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleReportStatusChange(selectedReport.id, 'dismissed', REPORT_DISMISS_NOTE)}
                    disabled={isActionLoading}
                  >
                    Dismiss
                  </Button>

                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      handleManualReportAction(
                        selectedReport.id,
                        'block_content',
                        'Blocked via moderation review'
                      )
                    }
                    disabled={isActionLoading}
                  >
                    Block Content
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => handleReportStatusChange(selectedReport.id, 'resolved', REPORT_RESOLVE_NOTE)}
                    disabled={isActionLoading}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Resolve Case
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

// Helper functions
function formatSafeDate(value?: string | null, pattern = 'PPp') {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return format(parsed, pattern);
}

function formatConfidencePercent(value?: number) {
  if (value === undefined || value === null) return '—';
  const normalized = value > 1 ? value : value * 100;
  return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`;
}

function formatAiRecommendation(recommendedAction?: string | null, suggestedStatus?: string | null) {
  if (recommendedAction) {
    switch (recommendedAction) {
      case 'remove_content':
        return 'Remove content + notify owner';
      case 'block_content':
        return 'Block content + notify owner';
      case 'warn_user':
        return 'Warn owner';
      case 'escalate_to_legal':
        return 'Escalate to legal';
      case 'none':
        return 'Manual review';
      default:
        return recommendedAction.replace(/_/g, ' ');
    }
  }

  if (suggestedStatus) {
    return suggestedStatus.replace(/_/g, ' ');
  }

  return 'Manual review';
}

function formatFlagStatus(status?: string | null) {
  switch ((status || 'pending').toLowerCase()) {
    case 'blocked':
      return 'Blocked';
    case 'confirmed':
      return 'Confirmed';
    case 'dismissed':
      return 'Dismissed';
    default:
      return 'Pending review';
  }
}

function getFlagStatusVariant(status?: string | null): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch ((status || 'pending').toLowerCase()) {
    case 'blocked':
      return 'destructive';
    case 'confirmed':
      return 'default';
    case 'dismissed':
      return 'outline';
    default:
      return 'secondary';
  }
}
