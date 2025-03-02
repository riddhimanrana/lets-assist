"use client";

import { createClient } from "@/utils/supabase/client";
import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BugReport {
  id: number;
  created_at: string;
  email: string;
  issue: string;
  status: "pending" | "in_progress" | "resolved";
  user_id: string | null;
}

export default function BugReports() {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [selectedReport, setSelectedReport] = useState<BugReport | null>(null);
  const { toast } = useToast();

  const fetchReports = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("bug_reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setReports(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const updateStatus = async (id: number, newStatus: string) => {
    setUpdatingId(id);
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("bug_reports")
        .update({ status: newStatus })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Status updated",
        description: "Bug report status has been updated successfully.",
      });

      // Refresh the list
      fetchReports();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update status. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const statusOptions = [
    { value: "pending", label: "Pending" },
    { value: "in_progress", label: "In Progress" },
    { value: "resolved", label: "Resolved" },
  ];

  if (loading) {
    return (
      <div className="container mx-auto py-10">
        <Card className="p-6">
          <Skeleton className="h-8 w-48 mb-6" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-10">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Bug Reports</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchReports()}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
        <Table>
          <TableCaption>A list of all reported bugs</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Issue</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((report) => (
              <TableRow
                key={report.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setSelectedReport(report)}
              >
                <TableCell>
                  {new Date(report.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>{report.email}</TableCell>
                <TableCell className="max-w-md">
                  <div className="truncate">{report.issue}</div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={
                      report.status === "pending"
                        ? "bg-yellow-500/10 text-yellow-500"
                        : report.status === "in_progress"
                          ? "bg-blue-500/10 text-blue-500"
                          : "bg-green-500/10 text-green-500"
                    }
                  >
                    {report.status}
                  </Badge>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {updatingId === report.id ? (
                    <Button variant="ghost" size="sm" disabled>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    </Button>
                  ) : (
                    <Select
                      defaultValue={report.status}
                      onValueChange={(value) => updateStatus(report.id, value)}
                    >
                      <SelectTrigger className="w-[130px]">
                        <SelectValue placeholder="Update status" />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={!!selectedReport}
        onOpenChange={() => setSelectedReport(null)}
      >
        {selectedReport && (
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Bug Report Details</DialogTitle>
              <DialogDescription>
                Submitted on{" "}
                {new Date(selectedReport.created_at).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div>
                <h3 className="text-sm font-medium mb-1">Reported by</h3>
                <p className="text-sm">{selectedReport.email}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-1">Status</h3>
                <Badge
                  variant="secondary"
                  className={
                    selectedReport.status === "pending"
                      ? "bg-yellow-500/10 text-yellow-500"
                      : selectedReport.status === "in_progress"
                        ? "bg-blue-500/10 text-blue-500"
                        : "bg-green-500/10 text-green-500"
                  }
                >
                  {selectedReport.status}
                </Badge>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-1">Issue Description</h3>
                <p className="text-sm whitespace-pre-wrap">
                  {selectedReport.issue}
                </p>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
