'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  AlertTriangle, 
  ShieldAlert, 
  Clock, 
  CheckCircle, 
  XCircle,
  Eye,
  User,
  Calendar,
  Flag,
  MessageSquare
} from 'lucide-react';
import { getFlaggedContent, updateFlaggedContentStatus, getContentReports, updateContentReportStatus } from './actions';
import { format } from 'date-fns';
import { toast } from 'sonner';

type FlaggedContent = any;
type ContentReport = any;
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
  const [stats, setStats] = useState(initialStats);
  const [flaggedContent, setFlaggedContent] = useState(initialFlagged);
  const [contentReports, setContentReports] = useState(initialReports);
  const [reportsStats, setReportsStats] = useState(initialReportsStats);
  const [selectedTab, setSelectedTab] = useState('pending');
  const [isPending, startTransition] = useTransition();
  const [selectedItem, setSelectedItem] = useState<FlaggedContent | null>(null);
  const [selectedReport, setSelectedReport] = useState<ContentReport | null>(null);

  const loadFlaggedContent = async (status: string) => {
    startTransition(async () => {
      const result = await getFlaggedContent(status as any);
      if (result.data) {
        setFlaggedContent(result.data);
      }
    });
  };
  
  const loadContentReports = async (status: string) => {
    startTransition(async () => {
      const result = await getContentReports(status as any);
      if (result.data) {
        setContentReports(result.data);
      }
    });
  };

  const handleStatusUpdate = async (
    id: string,
    status: 'pending' | 'blocked' | 'confirmed' | 'dismissed',
    notes?: string
  ) => {
    startTransition(async () => {
      const result = await updateFlaggedContentStatus(id, status, notes);
      
      if (result.error) {
        toast.error('Failed to update status');
        return;
      }
      
      toast.success('Status updated successfully');
      
      // Reload current tab
      await loadFlaggedContent(selectedTab);
      setSelectedItem(null);
    });
  };
  
  const handleReportStatusUpdate = async (
    id: string,
    status: 'pending' | 'under_review' | 'resolved' | 'dismissed' | 'escalated',
    notes?: string
  ) => {
    startTransition(async () => {
      const result = await updateContentReportStatus(id, status, notes);
      
      if (result.error) {
        toast.error('Failed to update report status');
        return;
      }
      
      toast.success('Report status updated successfully');
      
      // Reload current tab
      await loadContentReports(selectedTab);
      setSelectedReport(null);
    });
  };

  const getSeverityColor = (severity: string): "secondary" | "destructive" | "default" => {
    switch (severity) {
      case 'critical':
        return 'destructive';
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      default:
        return 'secondary';
    }
  };

  const getContentTypeIcon = (type: string) => {
    return type === 'image' ? '🖼️' : '📝';
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-8 p-4 md:p-6">
      {/* Stats Overview */}
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
            <p className="text-xs text-muted-foreground">High/Critical severity</p>
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

      {/* Flagged Content Table */}
      <Card>
        <CardHeader>
          <CardTitle>Flagged Content</CardTitle>
          <CardDescription>
            Review and manage content flagged by the moderation system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={selectedTab} onValueChange={(v) => {
            setSelectedTab(v);
            loadFlaggedContent(v);
          }}>
            <TabsList>
              <TabsTrigger value="pending">
                Pending ({stats.pending})
              </TabsTrigger>
              <TabsTrigger value="blocked">Blocked</TabsTrigger>
              <TabsTrigger value="confirmed">Confirmed</TabsTrigger>
              <TabsTrigger value="dismissed">Dismissed</TabsTrigger>
            </TabsList>

            <TabsContent value={selectedTab} className="space-y-4">
              {isPending ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              ) : flaggedContent.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">No items found</h3>
                  <p className="text-sm text-muted-foreground">
                    There are no flagged items with this status
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {flaggedContent.map((item) => (
                    <Card key={item.id} className="overflow-hidden">
                      <div className="flex flex-col gap-4 p-6 md:flex-row md:items-start">
                        {/* Type Icon */}
                        <div className="text-4xl">
                          {getContentTypeIcon(item.content_type)}
                        </div>

                        {/* Content Details */}
                        <div className="flex-1 space-y-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={getSeverityColor(item.severity)}>
                                  {item.severity?.toUpperCase()}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                  {format(new Date(item.created_at), 'PPp')}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {item.content_type === 'image' ? 'Image Content' : 'Text Content'}
                              </p>
                            </div>
                          </div>

                          {/* Reason */}
                          <div className="rounded-lg bg-muted/50 p-3">
                            <p className="text-sm font-medium">Flagged for:</p>
                            <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
                          </div>

                          {/* Categories */}
                          {item.categories && Object.keys(item.categories).length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(item.categories).map(([key, value]) =>
                                value ? (
                                  <Badge key={key} variant="outline" className="text-xs">
                                    {key.replace('_', ' ')}
                                  </Badge>
                                ) : null
                              )}
                            </div>
                          )}

                          {/* User Info */}
                          {item.profiles && (
                            <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/50 p-2 text-sm text-muted-foreground">
                              <User className="h-4 w-4" />
                              <span>
                                {item.profiles.full_name || item.profiles.username || item.profiles.email}
                              </span>
                            </div>
                          )}

                          {/* Actions */}
                          {selectedTab === 'pending' && (
                            <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleStatusUpdate(item.id, 'blocked', 'Blocked for policy violation')}
                                disabled={isPending}
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                Block
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleStatusUpdate(item.id, 'confirmed', 'Confirmed violation')}
                                disabled={isPending}
                              >
                                <AlertTriangle className="mr-2 h-4 w-4" />
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleStatusUpdate(item.id, 'dismissed', 'False positive')}
                                disabled={isPending}
                              >
                                <CheckCircle className="mr-2 h-4 w-4" />
                                Dismiss
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setSelectedItem(item)}
                              >
                                <Eye className="mr-2 h-4 w-4" />
                                Details
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Content Reports Table */}
      <Card>
        <CardHeader>
          <CardTitle>User Reports</CardTitle>
          <CardDescription>
            Review and manage reports submitted by users
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={selectedTab} onValueChange={(v) => {
            setSelectedTab(v);
            loadContentReports(v);
          }}>
            <TabsList>
              <TabsTrigger value="pending">
                Pending ({reportsStats.pending})
              </TabsTrigger>
              <TabsTrigger value="under_review">Under Review</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
              <TabsTrigger value="dismissed">Dismissed</TabsTrigger>
            </TabsList>

            <TabsContent value={selectedTab} className="space-y-4">
              {isPending ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              ) : contentReports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">No reports found</h3>
                  <p className="text-sm text-muted-foreground">
                    There are no reports with this status
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {contentReports.map((report) => (
                    <Card key={report.id} className="overflow-hidden">
                      <div className="flex flex-col gap-4 p-6 md:flex-row md:items-start">
                        {/* Type Icon */}
                        <div className="text-3xl">
                          {report.content_type === 'project' ? '📋' : '👤'}
                        </div>

                        {/* Main Content */}
                        <div className="flex-1 min-w-0">
                          {/* Header */}
                          <div className="mb-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold break-words">
                                {report.content_type === 'project' 
                                  ? `Project Report` 
                                  : `User Report`}
                              </h3>
                              <p className="text-xs text-muted-foreground mt-1">
                                ID: {report.content_id}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={
                                report.priority === 'high' ? 'destructive' :
                                report.priority === 'medium' ? 'secondary' :
                                'outline'
                              }>
                                {report.priority || 'normal'} priority
                              </Badge>
                              <Badge variant={
                                report.status === 'pending' ? 'secondary' :
                                report.status === 'under_review' ? 'outline' :
                                report.status === 'resolved' ? 'default' :
                                'secondary'
                              }>
                                {report.status}
                              </Badge>
                            </div>
                          </div>

                          {/* Reason */}
                          <div className="rounded-lg bg-muted/50 p-3 mb-3">
                            <p className="text-sm font-medium">Report Reason:</p>
                            <p className="mt-1 text-sm text-muted-foreground">{report.reason}</p>
                          </div>

                          {/* Description */}
                          {report.description && (
                            <div className="rounded-lg bg-muted/50 p-3 mb-3">
                              <p className="text-sm font-medium">Description:</p>
                              <p className="mt-1 text-sm text-muted-foreground">{report.description}</p>
                            </div>
                          )}

                          {/* Reporter Info */}
                          {report.reporter && (
                            <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/50 p-2 text-sm text-muted-foreground mb-3">
                              <User className="h-4 w-4" />
                              <span>
                                Reported by: {report.reporter.full_name || report.reporter.username || report.reporter.email}
                              </span>
                            </div>
                          )}

                          {/* Created Date */}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                            <Calendar className="h-4 w-4" />
                            {format(new Date(report.created_at), 'MMM d, yyyy h:mm a')}
                          </div>

                          {/* Resolution Notes */}
                          {report.resolution_notes && (
                            <div className="rounded-lg bg-muted/30 p-3 border border-border/50 mb-3">
                              <p className="text-sm font-medium">Resolution Notes:</p>
                              <p className="mt-1 text-sm">{report.resolution_notes}</p>
                            </div>
                          )}

                          {/* Actions */}
                          {selectedTab === 'pending' && (
                            <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
                              <Button
                                size="sm"
                                onClick={() => {
                                  const notes = prompt('Enter resolution notes:');
                                  if (notes) {
                                    startTransition(async () => {
                                      const result = await updateContentReportStatus(report.id, 'resolved', notes);
                                      if (result.error) {
                                        toast.error('Failed to resolve report');
                                      } else {
                                        toast.success('Report resolved');
                                        await loadContentReports(selectedTab);
                                      }
                                    });
                                  }
                                }}
                                disabled={isPending}
                              >
                                <CheckCircle className="mr-2 h-4 w-4" />
                                Resolve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  startTransition(async () => {
                                    const result = await updateContentReportStatus(report.id, 'under_review');
                                    if (result.error) {
                                      toast.error('Failed to update status');
                                    } else {
                                      toast.success('Status updated');
                                      await loadContentReports(selectedTab);
                                    }
                                  });
                                }}
                                disabled={isPending}
                              >
                                <AlertTriangle className="mr-2 h-4 w-4" />
                                Review
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  startTransition(async () => {
                                    const result = await updateContentReportStatus(report.id, 'dismissed', 'No action needed');
                                    if (result.error) {
                                      toast.error('Failed to dismiss report');
                                    } else {
                                      toast.success('Report dismissed');
                                      await loadContentReports(selectedTab);
                                    }
                                  });
                                }}
                                disabled={isPending}
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                Dismiss
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
