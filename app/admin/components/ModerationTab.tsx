"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Loader2, CheckCircle, Eye, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { updateFlaggedContentStatus } from "../moderation/actions";
import { ReportDetailView } from "./ReportDetailView";

interface ContentReport {
  id: string;
  reason: string;
  priority: string;
  content_type: string;
  description: string;
  content_details?: {
    title?: string;
    full_name?: string;
  };
  creator_details?: {
    avatar_url?: string;
    full_name: string;
    username: string;
  };
}

interface FlaggedContent {
  id: string;
  content_id?: string;
  is_ai_flagged?: boolean;
  flag_type: string;
  confidence_score: number;
  content_type: string;
  reason?: string;
  flag_details?: {
    reasoning?: string;
    full_analysis?: Record<string, unknown>;
  };
}

interface ModerationTabProps {
  flaggedContent: FlaggedContent[];
  contentReports: ContentReport[];
}

export function ModerationTab({ flaggedContent, contentReports }: ModerationTabProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [selectedFlag, setSelectedFlag] = useState<FlaggedContent | null>(null);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [manualNotes, setManualNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const runAiScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/cron/ai-moderation');
      const data = await res.json();
      if (data.success) {
        toast.success(`Scan complete. ${data.moderated} items flagged.`);
        window.location.reload();
      } else {
        toast.error("Scan failed");
      }
    } catch {
      toast.error("Error running scan");
    } finally {
      setIsScanning(false);
    }
  };

  const handleReview = (flag: FlaggedContent) => {
    setSelectedFlag(flag);
    setManualNotes("");
    setReviewDialogOpen(true);
  };

  const handleAction = async (action: 'dismissed' | 'blocked') => {
    if (!selectedFlag) return;
    setIsSubmitting(true);
    try {
      const res = await updateFlaggedContentStatus(selectedFlag.id, action, manualNotes);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success(action === 'dismissed' ? "Flag dismissed" : "Content blocked");
        setReviewDialogOpen(false);
        window.location.reload();
      }
    } catch {
      toast.error("Failed to update status");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Moderation Queue</h2>
          <p className="text-muted-foreground">Review flagged content and user reports</p>
        </div>
        <Button onClick={runAiScan} disabled={isScanning}>
          {isScanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
          Run AI Scan
        </Button>
      </div>

      <Tabs defaultValue="ai-flags" className="w-full">
        <TabsList>
          <TabsTrigger value="ai-flags">AI Flags</TabsTrigger>
          <TabsTrigger value="reports">User Reports</TabsTrigger>
        </TabsList>
        
        <TabsContent value="ai-flags" className="space-y-4">
          {flaggedContent.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle className="h-12 w-12 text-primary mb-4" />
                <h3 className="text-lg font-medium">All Clear</h3>
                <p className="text-muted-foreground">No content currently flagged by AI.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {flaggedContent.map((flag) => (
                <Card key={flag.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive" className="uppercase">
                            {flag.flag_type}
                          </Badge>
                          <Badge variant="outline">
                            {(flag.confidence_score * 100).toFixed(0)}% Confidence
                          </Badge>
                        </div>
                        <h4 className="font-medium mt-2">
                          Flagged {flag.content_type}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {flag.reason}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleReview(flag)}>
                          <Eye className="mr-2 h-4 w-4" />
                          Review
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          {selectedReport ? (
            <div className="space-y-4">
              <Button 
                variant="outline" 
                onClick={() => setSelectedReport(null)}
              >
                ← Back to List
              </Button>
              <ReportDetailView 
                reportId={selectedReport}
                onActionTaken={() => {
                  toast.success("Action completed. Refreshing...");
                  setTimeout(() => window.location.reload(), 1500);
                }}
              />
            </div>
          ) : contentReports.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle className="h-12 w-12 text-primary mb-4" />
                <h3 className="text-lg font-medium">No Reports</h3>
                <p className="text-muted-foreground">No user reports to review.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4">
                {contentReports.map((report) => (
                  <Card 
                    key={report.id}
                    className="cursor-pointer hover:border-primary transition-colors"
                    onClick={() => setSelectedReport(report.id)}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge 
                              variant={
                                report.priority === 'critical' ? 'destructive' : 
                                report.priority === 'high' ? 'secondary' :
                                'outline'
                              }
                            >
                              {report.priority}
                            </Badge>
                            <Badge variant="outline">
                              {report.content_type}
                            </Badge>
                          </div>
                          <h4 className="font-medium">{report.reason}</h4>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {report.description}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Badge variant="outline">{report.priority}</Badge>
                          <Eye className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI Moderation Review</DialogTitle>
            <DialogDescription>
              Review the AI's analysis and reasoning.
            </DialogDescription>
          </DialogHeader>
          
          {selectedFlag && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Flag Type</h4>
                  <Badge variant="destructive">{selectedFlag.flag_type}</Badge>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Confidence</h4>
                  <span className="text-sm font-medium">{(selectedFlag.confidence_score * 100).toFixed(1)}%</span>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">AI Reasoning (Chain of Thought)</h4>
                <Card className="bg-muted/50">
                  <CardContent className="p-4 text-sm leading-relaxed">
                    {selectedFlag.flag_details?.reasoning || selectedFlag.reason || "No detailed reasoning available."}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Manual Evaluation</h4>
                <Textarea 
                  placeholder="Add your notes or reasoning for the decision..."
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => handleAction('dismissed')} disabled={isSubmitting}>
              <ShieldCheck className="mr-2 h-4 w-4 text-green-600" />
              Dismiss (Safe)
            </Button>
            <Button variant="destructive" onClick={() => handleAction('blocked')} disabled={isSubmitting}>
              <ShieldAlert className="mr-2 h-4 w-4" />
              Block Content
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
