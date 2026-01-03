"use client";

import { useState, useTransition, useEffect } from "react";
import { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Download, FileSpreadsheet } from "lucide-react";
import { exportCertificates } from "./certificate-export-actions";
import { toast } from "@/hooks/use-toast";

interface CertificateExportProps {
  userEmail: string;
  totalCertificates: number;
}

export function CertificateExport({ userEmail, totalCertificates }: CertificateExportProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [isPending, startTransition] = useTransition();
  const [, setFilteredCount] = useState<number>(totalCertificates);

  const handleExport = () => {
    if (!userEmail) {
      toast({
        title: "Export failed",
        description: "User email is required for export",
        variant: "destructive",
      });
      return;
    }

    startTransition(async () => {
      try {
        const result = await exportCertificates(
          userEmail,
          dateRange?.from,
          dateRange?.to
        );

        if (result.success && result.csv && result.filename) {
          // Create and download the CSV file
          const blob = new Blob([result.csv], { type: "text/csv" });
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = result.filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);

          toast({
            title: "Export successful",
            description: `Certificates exported to ${result.filename}`,
          });
        } else {
          toast({
            title: "Export failed",
            description: result.error || "Failed to export certificates",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Export error:", error);
        toast({
          title: "Export failed",
          description: "An error occurred while exporting certificates",
          variant: "destructive",
        });
      }
    });
  };

  const getDateRangeText = () => {
    if (!dateRange?.from) return "lifetime";
    if (!dateRange?.to) return `from ${dateRange.from.toLocaleDateString()}`;
    
    // Subtract 1 day from 'to' date for display since we add 1 day internally
    const displayToDate = new Date(dateRange.to);
    displayToDate.setDate(displayToDate.getDate() - 1);
    
    return `${dateRange.from.toLocaleDateString()} - ${displayToDate.toLocaleDateString()}`;
  };

  // Update filtered count when date range changes
  useEffect(() => {
    if (!dateRange?.from) {
      setFilteredCount(totalCertificates);
    } else {
      // For now, show total certificates. 
      // In a real implementation, you might want to fetch the count separately
      setFilteredCount(totalCertificates);
    }
  }, [dateRange, totalCertificates]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Export Certificates
        </CardTitle>
        <CardDescription>
          Export your certificates for a specific time period or all-time
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">
            Select Date Range
          </label>
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            showQuickSelect
            className="w-full"
          />
        </div>
        
        <div className="flex items-center justify-between pt-2">
          <div className="text-sm text-muted-foreground">
            Export certificates ({getDateRangeText()})
          </div>
          <Button 
            onClick={handleExport}
            disabled={isPending}
            size="sm"
          >
            <Download className="h-4 w-4 mr-2" />
            {isPending ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
