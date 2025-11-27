'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
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
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Loader2,
  ArrowLeft,
  Link as LinkIcon,
  Wrench,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
} from './actions';
import { format } from 'date-fns';
import { toast } from 'sonner';
import Link from 'next/link';

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
  recommendedAction?: string;
  actionJustification?: string;
  tags?: string[];
  toolsUsed?: string[];
};

type ContentDetails = {
  id?: string;
  title?: string | null;
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
    result?: AiMetadata;
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
    result?: AiMetadata;
    error?: string;
  }>>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

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
              result: parsed.data.result as AiMetadata,
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

  return (
    <TooltipProvider delayDuration={80}>
      <div className="container mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        {/* Unified Header Row */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">Content Moderation</h1>
            <p className="text-sm text-muted-foreground">
              Review flagged content and user reports with AI-powered analysis.
            </p>
          </div>
          
          {/* Stats in header */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <div className="text-sm">
                <span className="font-semibold">{stats.total}</span>
                <span className="text-muted-foreground ml-1">flagged</span>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <div className="text-sm">
                <span className="font-semibold">{stats.pending}</span>
                <span className="text-muted-foreground ml-1">pending</span>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              <div className="text-sm">
                <span className="font-semibold">{stats.critical}</span>
                <span className="text-muted-foreground ml-1">critical</span>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div className="text-sm">
                <span className="font-semibold">{stats.recentWeek}</span>
                <span className="text-muted-foreground ml-1">this week</span>
              </div>
            </div>
            <Button 
              onClick={handleRunAiScan} 
              disabled={isScanActive}
              className="ml-2"
            >
              {isScanActive ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Run AI Scan
            </Button>
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
                    {scanResults.slice(-5).map((result, i) => (
                      <div 
                        key={`${result.itemId}-${i}`}
                        className={`text-xs p-2 rounded flex items-center gap-2 ${
                          result.success 
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' 
                            : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                        }`}
                      >
                        {result.success ? (
                          <CheckCircle className="h-3 w-3" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        <span className="capitalize">{result.itemType}</span>
                        {result.result?.verdict && (
                          <span className="ml-auto truncate max-w-[150px]">{result.result.verdict}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Main Content Tabs */}
        <Tabs defaultValue="reports" className="space-y-4">
          <TabsList>
            <TabsTrigger value="reports" className="gap-2">
              <User className="h-4 w-4" />
              User Reports ({reportsStats.pending})
            </TabsTrigger>
            <TabsTrigger value="flagged" className="gap-2">
              <ShieldAlert className="h-4 w-4" />
              AI Flagged ({stats.pending})
            </TabsTrigger>
          </TabsList>

          {/* User Reports Tab */}
          <TabsContent value="reports">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">User Reports</CardTitle>
                    <CardDescription>Manual reports with AI analysis and recommendations</CardDescription>
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
                  <TabsList className="mb-4">
                    <TabsTrigger value="pending">Pending ({reportsStats.pending})</TabsTrigger>
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
                              <TableHead>AI Analysis</TableHead>
                              <TableHead className="hidden md:table-cell w-[120px]">Status</TableHead>
                              <TableHead className="text-right w-[120px]">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {contentReports.map((report) => {
                              const ai = report.ai_metadata;
                              const canQuickResolve = ['pending', 'under_review', null].includes(report.status ?? null);
                              
                              const reporteeName = report.content_type === 'project'
                                ? (report.content_details?.title || report.creator_details?.full_name || 'Unknown project')
                                : (report.creator_details?.full_name || report.creator_details?.username || 'Unknown user');
                              
                              return (
                                <TableRow 
                                  key={report.id} 
                                  className="cursor-pointer hover:bg-muted/50"
                                  onClick={() => setSelectedReport(report)}
                                >
                                  <TableCell>
                                    <div className="flex flex-col gap-1.5">
                                      <Badge 
                                        variant={report.content_type === 'project' ? 'default' : 'secondary'} 
                                        className="w-fit text-[11px]"
                                      >
                                        {report.content_type === 'project' ? '📋 Project' : '👤 Profile'}
                                      </Badge>
                                      <span className="font-medium text-sm">{reporteeName}</span>
                                      <p className="text-xs text-muted-foreground">
                                        {formatSafeDate(report.created_at)}
                                      </p>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {ai?.triagedAt ? (
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <Bot className="h-4 w-4 text-emerald-500 shrink-0" />
                                          <span className="font-medium text-sm line-clamp-1">
                                            {ai.verdict || 'Analyzed'}
                                          </span>
                                        </div>
                                        {ai.shortSummary && (
                                          <p className="text-xs text-muted-foreground line-clamp-2">
                                            {ai.shortSummary}
                                          </p>
                                        )}
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                          <Badge variant="outline" className="text-[10px] capitalize">
                                            {ai.recommendedAction?.replace(/_/g, ' ') || ai.suggestedStatus?.replace(/_/g, ' ') || 'review'}
                                          </Badge>
                                          <span>•</span>
                                          <span>{formatConfidencePercent(ai.confidence)} confident</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2 text-muted-foreground">
                                        <Clock className="h-4 w-4" />
                                        <span className="text-xs">Awaiting AI scan</span>
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="hidden md:table-cell">
                                    <div className="flex flex-col gap-1.5">
                                      <div className="flex items-center gap-1.5">
                                        {getStatusIcon(report.status)}
                                        <span className="text-sm font-medium capitalize">
                                          {(report.status || 'pending').replace(/_/g, ' ')}
                                        </span>
                                      </div>
                                      <Badge variant={getPriorityVariant(report.priority)} className="w-fit text-[10px]">
                                        {report.priority || 'normal'}
                                      </Badge>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center justify-end gap-1">
                                      {ai?.suggestedStatus && canQuickResolve && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                              onClick={() => handleReportAiApproval(report)}
                                              disabled={isActionLoading}
                                            >
                                              <Sparkles className="h-4 w-4" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent side="top">Approve AI</TooltipContent>
                                        </Tooltip>
                                      )}
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => setSelectedReport(report)}
                                          >
                                            <Eye className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">View Details</TooltipContent>
                                      </Tooltip>
                                      {canQuickResolve && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="text-muted-foreground hover:text-destructive"
                                              onClick={() => handleReportStatusChange(report.id, 'dismissed', REPORT_DISMISS_NOTE)}
                                              disabled={isActionLoading}
                                            >
                                              <XCircle className="h-4 w-4" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent side="top">Dismiss</TooltipContent>
                                        </Tooltip>
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
                  <TabsList className="mb-4">
                    <TabsTrigger value="pending">Pending ({stats.pending})</TabsTrigger>
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
                              <TableRow key={item.id}>
                                <TableCell>
                                  <div className="flex flex-col gap-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant="outline" className="capitalize">
                                        {item.content_type || 'Content'}
                                      </Badge>
                                      <span className="text-xs text-muted-foreground">
                                        {formatSafeDate(item.created_at)}
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
                                  <Badge variant={getSeverityColor(item.severity)} className="text-[11px]">
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
                                        >
                                          <Eye className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>View</TooltipContent>
                                    </Tooltip>
                                    {flaggedFilter === 'pending' && (
                                      <>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              onClick={() => handleFlagStatusUpdate(item.id, 'blocked', 'Blocked for policy violation')}
                                              disabled={isActionLoading}
                                            >
                                              <ShieldX className="h-4 w-4" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Block</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              onClick={() => handleFlagStatusUpdate(item.id, 'confirmed', 'Confirmed violation')}
                                              disabled={isActionLoading}
                                            >
                                              <CheckCircle className="h-4 w-4" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Confirm</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              onClick={() => handleFlagStatusUpdate(item.id, 'dismissed', 'False positive')}
                                              disabled={isActionLoading}
                                            >
                                              <XCircle className="h-4 w-4" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Dismiss</TooltipContent>
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
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={getSeverityColor(selectedFlag.severity)}>
                    {selectedFlag.severity?.toUpperCase() || 'UNKNOWN'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatSafeDate(selectedFlag.created_at, 'PPP p')}
                  </span>
                </div>
                <div className="rounded-md border bg-muted/30 p-4">
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
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleFlagStatusUpdate(selectedFlag.id, 'blocked', 'Blocked via modal')}
                    disabled={isActionLoading}
                  >
                    Block content
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleFlagStatusUpdate(selectedFlag.id, 'confirmed', 'Confirmed via modal')}
                    disabled={isActionLoading}
                  >
                    Confirm violation
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleFlagStatusUpdate(selectedFlag.id, 'dismissed', 'Dismissed as false positive')}
                    disabled={isActionLoading}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Report Detail Sheet */}
        <Sheet open={Boolean(selectedReport)} onOpenChange={(open) => !open && setSelectedReport(null)}>
          <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
            <SheetHeader className="mb-6">
              <SheetTitle className="flex items-center gap-2">
                Report Details
                {selectedReport?.ai_metadata?.triagedAt && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    <Bot className="h-3 w-3 mr-1" />
                    AI Analyzed
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                {selectedReport?.reason || 'Review report and take action'}
              </SheetDescription>
            </SheetHeader>
            
            {selectedReport && (
              <div className="space-y-6">
                {/* Status & Priority */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={getStatusVariant(selectedReport.status)}>
                    {selectedReport.status || 'pending'}
                  </Badge>
                  <Badge variant={getPriorityVariant(selectedReport.priority)}>
                    {selectedReport.priority || 'normal'} priority
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatSafeDate(selectedReport.created_at, 'PPP p')}
                  </span>
                </div>

                {/* Reporter Info - Clickable */}
                {selectedReport.reporter && (
                  <div className="rounded-lg border bg-card p-4">
                    <p className="text-xs uppercase text-muted-foreground mb-2">Reported By</p>
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
                  <p className="text-xs uppercase text-muted-foreground mb-2">Reported Content</p>
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
                    
                    {/* Content Creator - Clickable */}
                    {selectedReport.creator_details && (
                      <Link 
                        href={`/profile/${selectedReport.creator_details.username || selectedReport.creator_details.id}`}
                        className="flex items-center gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={selectedReport.creator_details.avatar_url || undefined} />
                          <AvatarFallback className="text-xs">
                            {(selectedReport.creator_details.full_name?.[0] || 'U').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-muted-foreground">Created by</span>
                        <span className="text-xs font-medium">
                          {selectedReport.creator_details.full_name || selectedReport.creator_details.username}
                        </span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground ml-auto" />
                      </Link>
                    )}
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

                    {/* Recommendations */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md bg-background p-3">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Recommended Action</p>
                        <Badge variant="secondary" className="capitalize">
                          {selectedReport.ai_metadata.recommendedAction?.replace(/_/g, ' ') || 'Review'}
                        </Badge>
                      </div>
                      <div className="rounded-md bg-background p-3">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Priority</p>
                        <Badge variant={getPriorityVariant(selectedReport.ai_metadata.priority)} className="capitalize">
                          {selectedReport.ai_metadata.priority || 'Normal'}
                        </Badge>
                      </div>
                    </div>

                    {/* Action Justification */}
                    {selectedReport.ai_metadata.actionJustification && (
                      <div className="rounded-md bg-background p-3">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Action Justification</p>
                        <p className="text-sm">{selectedReport.ai_metadata.actionJustification}</p>
                      </div>
                    )}

                    {/* Tags */}
                    {selectedReport.ai_metadata.tags && selectedReport.ai_metadata.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedReport.ai_metadata.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px] capitalize">
                            {tag.replace(/_/g, ' ')}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Confidence Breakdown */}
                    {selectedReport.ai_metadata.confidenceBreakdown && (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full justify-between">
                            Confidence Breakdown
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2 space-y-2">
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-md bg-background p-2">
                              <p className="text-xs text-muted-foreground">Evidence</p>
                              <p className="font-semibold">
                                {Math.round(selectedReport.ai_metadata.confidenceBreakdown.evidenceStrength * 100)}%
                              </p>
                            </div>
                            <div className="rounded-md bg-background p-2">
                              <p className="text-xs text-muted-foreground">Severity</p>
                              <p className="font-semibold">
                                {Math.round(selectedReport.ai_metadata.confidenceBreakdown.severityAssessment * 100)}%
                              </p>
                            </div>
                            <div className="rounded-md bg-background p-2">
                              <p className="text-xs text-muted-foreground">Clarity</p>
                              <p className="font-semibold">
                                {Math.round(selectedReport.ai_metadata.confidenceBreakdown.contextClarity * 100)}%
                              </p>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Reasoning Steps - Expandable */}
                    {selectedReport.ai_metadata.reasoningSteps && selectedReport.ai_metadata.reasoningSteps.length > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full justify-between">
                            <span className="flex items-center gap-2">
                              <ChevronRight className="h-4 w-4 transition-transform [[data-state=open]_&]:rotate-90" />
                              Reasoning Steps ({selectedReport.ai_metadata.reasoningSteps.length})
                            </span>
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2 space-y-2">
                          {selectedReport.ai_metadata.reasoningSteps.map((step, idx) => (
                            <div key={idx} className="rounded-md bg-background p-3 border-l-2 border-primary/30">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-[10px]">Step {step.step}</Badge>
                                <span className="font-medium text-sm">{step.title}</span>
                              </div>
                              <p className="text-xs text-muted-foreground mb-1">{step.analysis}</p>
                              <p className="text-xs font-medium text-primary">→ {step.conclusion}</p>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Tools Used */}
                    {selectedReport.ai_metadata.toolsUsed && selectedReport.ai_metadata.toolsUsed.length > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full justify-between">
                            <span className="flex items-center gap-2">
                              <Wrench className="h-4 w-4" />
                              Tools Used ({selectedReport.ai_metadata.toolsUsed.length})
                            </span>
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                          <div className="flex flex-wrap gap-1">
                            {selectedReport.ai_metadata.toolsUsed.map((tool, idx) => (
                              <Badge key={idx} variant="secondary" className="text-[10px]">
                                {tool.replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 border-t pt-4">
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
                    onClick={() => handleReportStatusChange(selectedReport.id, 'resolved', REPORT_RESOLVE_NOTE)}
                    disabled={isActionLoading}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Resolve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReportStatusChange(selectedReport.id, 'under_review')}
                    disabled={isActionLoading}
                  >
                    Keep Reviewing
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleReportStatusChange(selectedReport.id, 'dismissed', REPORT_DISMISS_NOTE)}
                    disabled={isActionLoading}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>
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

function getStatusIcon(status?: string | null) {
  switch ((status || 'pending').toLowerCase()) {
    case 'resolved':
      return <CheckCircle className="h-4 w-4 text-emerald-500" />;
    case 'dismissed':
      return <XCircle className="h-4 w-4 text-muted-foreground" />;
    case 'under_review':
      return <Eye className="h-4 w-4 text-blue-500" />;
    default:
      return <Clock className="h-4 w-4 text-amber-500" />;
  }
}
