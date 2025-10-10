"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, X, Trash2, Lightbulb, AlertTriangle, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { updateTrustedMemberStatus, deleteFeedback } from "./actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type FeedbackType = "issue" | "idea" | "other";

interface Profile {
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface Feedback {
  id: string;
  user_id: string;
  section: FeedbackType;
  email: string;
  title: string;
  feedback: string;
  created_at: string;
  profiles: Profile | null;
}

interface TrustedMemberApplication {
  id: string;
  user_id?: string;
  name: string;
  email: string;
  reason: string;
  status: boolean | null;
  created_at: string;
  profiles: Profile | null;
}

interface AdminClientProps {
  feedback: Feedback[];
  applications: TrustedMemberApplication[];
}

export function AdminClient({ feedback: initialFeedback, applications: initialApplications }: AdminClientProps) {
  const [feedback, setFeedback] = useState(initialFeedback);
  const [applications, setApplications] = useState(initialApplications);
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [feedbackToDelete, setFeedbackToDelete] = useState<string | null>(null);

  const handleApprove = async (userId: string) => {
    setLoadingStates((prev) => ({ ...prev, [userId]: true }));
    
    const result = await updateTrustedMemberStatus(userId, true);
    
    if (result.error) {
      toast.error("Error", {
        description: result.error,
      });
    } else {
      toast.success("Approved", {
        description: "Trusted member application approved successfully.",
      });
      
      // Update local state
      setApplications((prev) =>
        prev.map((app) =>
          app.id === userId ? { ...app, status: true } : app
        )
      );
    }
    
    setLoadingStates((prev) => ({ ...prev, [userId]: false }));
  };

  const handleDeny = async (userId: string) => {
    setLoadingStates((prev) => ({ ...prev, [userId]: true }));
    
    const result = await updateTrustedMemberStatus(userId, false);
    
    if (result.error) {
      toast.error("Error", {
        description: result.error,
      });
    } else {
      toast.success("Denied", {
        description: "Trusted member application denied.",
      });
      
      // Update local state
      setApplications((prev) =>
        prev.map((app) =>
          app.id === userId ? { ...app, status: false } : app
        )
      );
    }
    
    setLoadingStates((prev) => ({ ...prev, [userId]: false }));
  };

  const handleDeleteFeedback = async () => {
    if (!feedbackToDelete) return;
    
    setLoadingStates((prev) => ({ ...prev, [feedbackToDelete]: true }));
    
    const result = await deleteFeedback(feedbackToDelete);
    
    if (result.error) {
      toast.error("Error", {
        description: result.error,
      });
    } else {
      toast.success("Deleted", {
        description: "Feedback deleted successfully.",
      });
      
      // Update local state
      setFeedback((prev) => prev.filter((f) => f.id !== feedbackToDelete));
    }
    
    setLoadingStates((prev) => ({ ...prev, [feedbackToDelete]: false }));
    setDeleteDialogOpen(false);
    setFeedbackToDelete(null);
  };

  const getFeedbackIcon = (type: FeedbackType) => {
    switch (type) {
      case "issue":
        return <AlertTriangle className="h-4 w-4" />;
      case "idea":
        return <Lightbulb className="h-4 w-4" />;
      default:
        return <MoreHorizontal className="h-4 w-4" />;
    }
  };

  const getFeedbackBadgeColor = (type: FeedbackType) => {
    switch (type) {
      case "issue":
        return "destructive";
      case "idea":
        return "default";
      default:
        return "secondary";
    }
  };

  const getStatusBadge = (status: boolean | null) => {
    if (status === null) {
      return <Badge variant="secondary">Pending</Badge>;
    } else if (status === true) {
      return <Badge variant="default" className="bg-chart-5 hover:bg-chart-5/90">Approved</Badge>;
    } else {
      return <Badge variant="destructive">Denied</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Manage feedback and trusted member applications
        </p>
      </div>

      <Tabs defaultValue="feedback" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="feedback">
            Feedback ({feedback.length})
          </TabsTrigger>
          <TabsTrigger value="trusted-members">
            Trusted Members ({applications.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feedback" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>User Feedback</CardTitle>
              <CardDescription>
                All feedback submitted by users
              </CardDescription>
            </CardHeader>
            <CardContent>
              {feedback.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No feedback submitted yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Feedback</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feedback.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={item.profiles?.avatar_url || ""} />
                              <AvatarFallback>
                                {item.profiles?.full_name?.[0] || "U"}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">
                                {item.profiles?.full_name || "Unknown"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {item.email}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={getFeedbackBadgeColor(item.section)}
                            className="flex items-center gap-1 w-fit"
                          >
                            {getFeedbackIcon(item.section)}
                            {item.section}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium max-w-xs truncate">
                          {item.title}
                        </TableCell>
                        <TableCell className="max-w-md">
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {item.feedback}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(item.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setFeedbackToDelete(item.id);
                              setDeleteDialogOpen(true);
                            }}
                            disabled={loadingStates[item.id]}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trusted-members" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Trusted Member Applications</CardTitle>
              <CardDescription>
                Review and manage trusted member requests
              </CardDescription>
            </CardHeader>
            <CardContent>
              {applications.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No applications submitted yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Applicant</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {applications.map((app) => (
                      <TableRow key={app.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={app.profiles?.avatar_url || ""} />
                              <AvatarFallback>
                                {app.profiles?.full_name?.[0] || app.name[0]}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">
                                {app.profiles?.full_name || app.name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {app.email}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md">
                          <p className="text-sm text-muted-foreground line-clamp-3">
                            {app.reason}
                          </p>
                        </TableCell>
                        <TableCell>{getStatusBadge(app.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(app.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleApprove(app.id)}
                              disabled={
                                loadingStates[app.id] || app.status === true
                              }
                              className="bg-chart-5 hover:bg-chart-5/90"
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDeny(app.id)}
                              disabled={
                                loadingStates[app.id] || app.status === false
                              }
                            >
                              <X className="h-4 w-4 mr-1" />
                              Deny
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete this
              feedback entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFeedback}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
