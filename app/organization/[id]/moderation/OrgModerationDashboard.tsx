'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  AlertTriangle, 
  ShieldAlert, 
  Clock, 
  CheckCircle,
  User,
  Calendar,
} from 'lucide-react';
import { getOrgFlaggedContent } from './actions';
import { format } from 'date-fns';


type FlaggedContent = any;
type ModerationStats = {
  total: number;
  pending: number;
  blocked: number;
  critical: number;
  recentWeek: number;
};

export default function OrgModerationDashboard({
  organizationId,
  initialStats,
  initialFlagged,
}: {
  organizationId: string;
  initialStats: ModerationStats;
  initialFlagged: FlaggedContent[];
}) {
  const [stats] = useState(initialStats);
  const [flaggedContent, setFlaggedContent] = useState(initialFlagged);
  const [selectedTab, setSelectedTab] = useState('pending_review');
  const [isPending, startTransition] = useTransition();

  const loadFlaggedContent = async (status: string) => {
    startTransition(async () => {
      const result = await getOrgFlaggedContent(organizationId, status as any);
      if (result.data) {
        setFlaggedContent(result.data);
      }
    });
  };

  const getSeverityColor = (severity: string): "secondary" | "destructive" | "default" => {
    switch (severity) {
      case 'critical':
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
    <div className="space-y-8">
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
            Review content flagged within your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={selectedTab} onValueChange={(v) => {
            setSelectedTab(v);
            loadFlaggedContent(v);
          }}>
            <TabsList>
              <TabsTrigger value="pending_review">
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
                      <div className="flex items-start gap-4 p-6">
                        {/* Type Icon */}
                        <div className="text-4xl">
                          {getContentTypeIcon(item.content_type)}
                        </div>

                        {/* Content Details */}
                        <div className="flex-1 space-y-2">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <Badge variant={getSeverityColor(item.severity)}>
                                  {item.severity?.toUpperCase()}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                  {format(new Date(item.created_at), 'PPp')}
                                </span>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.content_type === 'image' ? 'Image Content' : 'Text Content'}
                              </p>
                            </div>
                          </div>

                          {/* Reason */}
                          <div>
                            <p className="text-sm font-medium">Flagged for:</p>
                            <p className="text-sm text-muted-foreground">{item.reason}</p>
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
                            <div className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
                              <User className="h-4 w-4" />
                              <span>
                                {item.profiles.full_name || item.profiles.username || item.profiles.email}
                              </span>
                            </div>
                          )}

                          {/* Info Note */}
                          <div className="rounded-md bg-muted p-3 text-sm">
                            <p className="font-medium">Note:</p>
                            <p className="text-muted-foreground">
                              Only platform administrators can take action on flagged content.
                              This dashboard is for monitoring and reporting purposes.
                            </p>
                          </div>
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
