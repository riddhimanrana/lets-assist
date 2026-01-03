"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { 
  Download, 
  FileText, 
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Settings,
  CalendarDays,
  Check
} from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";


interface DateRangeExportProps {
  userEmail: string;
  verifiedCount?: number;
  unverifiedCount?: number;
  totalCertificates?: number;
}

interface ExportOptions {
  includeVerified: boolean;
  includeUnverified: boolean;
  separateByType: boolean;
  format: "csv" | "pdf";
  dateRange: "all" | "semester" | "academic_year" | "custom";
  customDateRange?: DateRange;
}

const dateRangePresets = [
  { value: "all", label: "All Time", description: "Export all volunteer hours" },
  { value: "semester", label: "Current Semester", description: "August - December 2024" },
  { value: "academic_year", label: "Academic Year", description: "August 2024 - May 2025" },
  { value: "summer", label: "Summer Period", description: "May - August 2024" },
  { value: "custom", label: "Custom Range", description: "Select specific dates" }
];

export function DateRangeExport({ 
  userEmail: _userEmail, 
  verifiedCount = 0, 
  unverifiedCount = 0, 
  totalCertificates: _totalCertificates = 0 
}: DateRangeExportProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    includeVerified: true,
    includeUnverified: true,
    separateByType: true,
    format: "csv",
    dateRange: "all",
  });

  const totalHours = verifiedCount + unverifiedCount;

  const handleExport = async () => {
    if (!exportOptions.includeVerified && !exportOptions.includeUnverified) {
      toast.error("Please select at least one type of hours to export");
      return;
    }

    setIsExporting(true);
    
    try {
      // TODO: Replace with actual export API call
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call
      
      const exportType = [];
      if (exportOptions.includeVerified) exportType.push("verified");
      if (exportOptions.includeUnverified) exportType.push("self-reported");
      
      toast.success("Export completed successfully!", {
        description: `Downloaded ${exportType.join(" and ")} hours as ${exportOptions.format.toUpperCase()}`,
      });
      
      setIsOpen(false);
    } catch (error) {
      toast.error("Export failed", {
        description: "Please try again or contact support if the problem persists.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const getDateRangeDescription = () => {
    const preset = dateRangePresets.find(p => p.value === exportOptions.dateRange);
    if (preset && exportOptions.dateRange !== "custom") {
      return preset.description;
    }
    if (exportOptions.dateRange === "custom" && exportOptions.customDateRange?.from && exportOptions.customDateRange?.to) {
      return `${format(exportOptions.customDateRange.from, "MMM d, yyyy")} - ${format(exportOptions.customDateRange.to, "MMM d, yyyy")}`;
    }
    return "Select date range";
  };

  const getExportSummary = () => {
    const types = [];
    if (exportOptions.includeVerified) types.push(`${verifiedCount} verified`);
    if (exportOptions.includeUnverified) types.push(`${unverifiedCount} self-reported`);
    return types.join(" + ");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          Export Hours
        </CardTitle>
        <CardDescription>
          Download your volunteer hours for school programs, applications, or personal records
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick Export */}
        <div className="space-y-3">
          <h4 className="font-medium">Quick Export</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button 
              variant="outline" 
              className="justify-start gap-2 h-auto p-3"
              onClick={() => {
                // TODO: Quick export all hours as CSV
                toast.success("Exporting all hours as CSV...");
              }}
            >
              <FileSpreadsheet className="h-4 w-4" />
              <div className="text-left">
                <div className="font-medium">All Hours (CSV)</div>
                <div className="text-xs text-muted-foreground">
                  {totalHours} total hours
                </div>
              </div>
            </Button>
            
            <Button 
              variant="outline" 
              className="justify-start gap-2 h-auto p-3"
              onClick={() => {
                // TODO: Quick export verified only as CSV
                toast.success("Exporting verified hours as CSV...");
              }}
            >
              <CheckCircle className="h-4 w-4 text-green-600" />
              <div className="text-left">
                <div className="font-medium">Verified Only (CSV)</div>
                <div className="text-xs text-muted-foreground">
                  {verifiedCount} verified hours
                </div>
              </div>
            </Button>
          </div>
        </div>

        {/* Advanced Export */}
        <div className="pt-4 border-t">
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="w-full gap-2">
                <Settings className="h-4 w-4" />
                Advanced Export Options
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  Export Volunteer Hours
                </DialogTitle>
                <DialogDescription>
                  Customize your export with specific date ranges and hour types
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                {/* Hour Types Selection */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">What to Include</Label>
                  <div className="space-y-3">
                    <Button
                      variant={exportOptions.includeVerified ? "default" : "outline"}
                      className="w-full justify-start gap-2 h-auto p-3"
                      onClick={() => 
                        setExportOptions(prev => ({ ...prev, includeVerified: !prev.includeVerified }))
                      }
                    >
                      <div className="flex items-center gap-2">
                        {exportOptions.includeVerified && <Check className="h-4 w-4" />}
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span>Let&apos;s Assist Verified Hours</span>
                        <Badge variant="outline">{verifiedCount}</Badge>
                      </div>
                    </Button>
                    
                    <Button
                      variant={exportOptions.includeUnverified ? "default" : "outline"}
                      className="w-full justify-start gap-2 h-auto p-3"
                      onClick={() => 
                        setExportOptions(prev => ({ ...prev, includeUnverified: !prev.includeUnverified }))
                      }
                    >
                      <div className="flex items-center gap-2">
                        {exportOptions.includeUnverified && <Check className="h-4 w-4" />}
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                        <span>Self-Reported Hours</span>
                        <Badge variant="secondary">{unverifiedCount}</Badge>
                      </div>
                    </Button>
                  </div>
                </div>

                {/* Date Range Selection */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Date Range</Label>
                  <Select
                    value={exportOptions.dateRange}
                    onValueChange={(value: ExportOptions["dateRange"]) =>
                      setExportOptions(prev => ({ ...prev, dateRange: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {dateRangePresets.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          <div>
                            <div className="font-medium">{preset.label}</div>
                            <div className="text-xs text-muted-foreground">{preset.description}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Custom Date Range */}
                  {exportOptions.dateRange === "custom" && (
                    <div className="space-y-2">
                      <Label htmlFor="dateRange" className="text-sm">Custom Date Range</Label>
                      <DateRangePicker
                        value={exportOptions.customDateRange}
                        onChange={(dateRange) => 
                          setExportOptions(prev => ({ ...prev, customDateRange: dateRange }))
                        }
                        placeholder="Select date range for export"
                        showQuickSelect={true}
                      />
                    </div>
                  )}
                </div>

                {/* Format and Options */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Export Format</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant={exportOptions.format === "csv" ? "default" : "outline"}
                      className="justify-start gap-2 h-auto p-3"
                      onClick={() => setExportOptions(prev => ({ ...prev, format: "csv" }))}
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      <div className="text-left">
                        <div className="font-medium">CSV</div>
                        <div className="text-xs text-muted-foreground">Spreadsheet format</div>
                      </div>
                    </Button>
                    
                    <Button
                      variant={exportOptions.format === "pdf" ? "default" : "outline"}
                      className="justify-start gap-2 h-auto p-3"
                      onClick={() => setExportOptions(prev => ({ ...prev, format: "pdf" }))}
                    >
                      <FileText className="h-4 w-4" />
                      <div className="text-left">
                        <div className="font-medium">PDF</div>
                        <div className="text-xs text-muted-foreground">Document format</div>
                      </div>
                    </Button>
                  </div>
                </div>

                {/* Additional Options */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Additional Options</Label>
                  <Button
                    variant={exportOptions.separateByType ? "default" : "outline"}
                    className="w-full justify-start gap-2"
                    onClick={() => 
                      setExportOptions(prev => ({ ...prev, separateByType: !prev.separateByType }))
                    }
                  >
                    {exportOptions.separateByType && <Check className="h-4 w-4" />}
                    <span>Separate verified and self-reported hours in export</span>
                  </Button>
                </div>

                {/* Export Summary */}
                <div className="bg-muted/50 p-4 rounded-lg">
                  <h4 className="font-medium mb-2">Export Summary</h4>
                  <div className="space-y-1 text-sm">
                    <div>Hours: {getExportSummary()}</div>
                    <div>Date Range: {getDateRangeDescription()}</div>
                    <div>Format: {exportOptions.format.toUpperCase()}</div>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleExport} disabled={isExporting}>
                  {isExporting ? "Exporting..." : "Export Hours"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* CSF Program Helper */}
        <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <CalendarDays className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-blue-900 dark:text-blue-100">CSF Program Students</h4>
              <p className="text-sm text-blue-800 dark:text-blue-200 mt-1">
                Use &quot;Academic Year&quot; or &quot;Semester&quot; date ranges for easy CSF hour reporting. 
                Both verified and self-reported hours will be clearly labeled.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
