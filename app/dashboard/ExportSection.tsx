"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { 
  Download, 
  Calendar, 
  CheckCircle,
  AlertCircle,
  CircleCheck,
  UserCheck,
} from "lucide-react";
import { format, subMonths } from "date-fns";
import { toast } from "sonner";

interface ExportSectionProps {
  userEmail: string;
  verifiedCount?: number;
  unverifiedCount?: number;
  totalCertificates?: number;
  certificatesData?: any[];
}

interface ExportData {
  id: string;
  projectTitle: string;
  organizationName: string;
  volunteerName: string;
  volunteerEmail: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: string;
  location: string;
  supervisorContact: string;
  isVerified: boolean;
  type: string;
}

export function ExportSection({ 
  userEmail, 
  verifiedCount = 0, 
  unverifiedCount = 0,
  totalCertificates = 0,
  certificatesData = []
}: ExportSectionProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  
  const [includeVerified, setIncludeVerified] = useState(true);
  const [includeUnverified, setIncludeUnverified] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Convert certificates data to export format
  const convertCertificateToExportData = (cert: any): ExportData => {
    const isVerified = (cert.type || 'verified') === 'verified';
    return {
      id: cert.id,
      projectTitle: cert.project_title || cert.title || "Unknown Project",
      organizationName: cert.organization_name || cert.creator_name || "Unknown Organization",
      volunteerName: cert.volunteer_name || "Unknown Volunteer",
      volunteerEmail: cert.volunteer_email || userEmail,
      date: cert.event_start ? format(new Date(cert.event_start), "yyyy-MM-dd") : "Unknown Date",
      startTime: cert.event_start ? format(new Date(cert.event_start), "h:mm a") : "Unknown",
      endTime: cert.event_end ? format(new Date(cert.event_end), "h:mm a") : "Unknown",
      duration: cert.hours ? cert.hours.toString() : "0",
      location: cert.project_location || "Unknown Location",
      supervisorContact: cert.creator_name || "Unknown Supervisor",
      isVerified: isVerified,
      type: isVerified ? "Verified" : "Self-Reported"
    };
  };

  // Convert all certificates data to export format
  const allExportData = useMemo(() => {
    return certificatesData.map(convertCertificateToExportData);
  }, [certificatesData, userEmail]);

  // Calculate actual counts from processed data
  const actualVerifiedCount = allExportData.filter(item => item.isVerified).length;
  const actualUnverifiedCount = allExportData.filter(item => !item.isVerified).length;

  // Filter data based on date range and type selection
  const filteredData = useMemo(() => {
    // If no date range is selected, show all data
    if (!dateRange?.from || !dateRange?.to) {
      return allExportData.filter(item => {
        const typeIncluded = (item.isVerified && includeVerified) || 
                            (!item.isVerified && includeUnverified);
        return typeIncluded;
      });
    }
    
    return allExportData.filter(item => {
      const itemDate = new Date(item.date);
      const inDateRange = itemDate >= dateRange.from! && itemDate <= dateRange.to!;
      const typeIncluded = (item.isVerified && includeVerified) || 
                          (!item.isVerified && includeUnverified);
      return inDateRange && typeIncluded;
    });
  }, [allExportData, dateRange, includeVerified, includeUnverified]);

  const handleExport = async () => {
    if (filteredData.length === 0) {
      toast.error("No data found for the selected criteria");
      return;
    }

    setIsExporting(true);
    
    try {
      // Build CSV with all columns
      const headers = [
        "Volunteer Name",
        "Email", 
        "Project Title",
        "Organization",
        "Date",
        "Start Time",
        "End Time", 
        "Duration (Hours)",
        "Location",
        "Supervisor Contact",
        "Type",
        "Verified"
      ];

      const rows = filteredData.map(item => [
        item.volunteerName,
        item.volunteerEmail,
        item.projectTitle,
        item.organizationName,
        item.date,
        item.startTime,
        item.endTime,
        item.duration,
        item.location,
        item.supervisorContact,
        item.type,
        item.isVerified ? "Yes" : "No"
      ]);

      // Generate CSV
      const csvContent = [headers, ...rows]
        .map(row => row.map(field => `"${field}"`).join(","))
        .join("\n");

      // Download file
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      
      // Generate filename based on date range or default to "all-time"
      let filename;
      if (dateRange?.from && dateRange?.to) {
        const fromDate = format(dateRange.from, "yyyy-MM-dd");
        const toDate = format(dateRange.to, "yyyy-MM-dd");
        filename = `volunteer-hours-${fromDate}-to-${toDate}.csv`;
      } else {
        const currentDate = format(new Date(), "yyyy-MM-dd");
        filename = `volunteer-hours-all-time-${currentDate}.csv`;
      }
      link.download = filename;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(`Successfully exported ${filteredData.length} entries`);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Date Range Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Date Range
          </CardTitle>
          <CardDescription>
            Select a time period for your export, or leave blank for all-time data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            className="w-full"
            showQuickSelect={true}
          />
        </CardContent>
      </Card>

      {/* Data Types */}
      <Card>
        <CardHeader>
          <CardTitle>Data Types</CardTitle>
          <CardDescription>
            Choose which types of volunteer hours to include
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="verified"
              checked={includeVerified}
              onCheckedChange={(checked) => setIncludeVerified(!!checked)}
            />
            <Label htmlFor="verified" className="flex items-center gap-2">
              <CircleCheck className="h-4 w-4 text-chart-5" />
              Verified Hours
              <Badge variant="secondary">{actualVerifiedCount}</Badge>
            </Label>
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox
              id="unverified"
              checked={includeUnverified}
              onCheckedChange={(checked) => setIncludeUnverified(!!checked)}
            />
            <Label htmlFor="unverified" className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-chart-4" />
              Self-Reported Hours
              <Badge variant="secondary">{actualUnverifiedCount}</Badge>
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Preview Table */}
      <Card>
        <CardHeader>
          <CardTitle>Export Preview</CardTitle>
          <CardDescription>
            Preview of data that will be exported ({filteredData.length} entries)
            {!dateRange?.from || !dateRange?.to ? " - All time data" : ` - ${dateRange.from ? format(dateRange.from, "MMM d") : ""} to ${dateRange.to ? format(new Date(dateRange.to.getTime() - 24 * 60 * 60 * 1000), "MMM d") : ""}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredData.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="border-b">
                      <th className="text-left p-3 font-medium">Project</th>
                      <th className="text-left p-3 font-medium">Organization</th>
                      <th className="text-left p-3 font-medium">Date</th>
                      <th className="text-left p-3 font-medium">Duration</th>
                      <th className="text-left p-3 font-medium">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredData.map((item, index) => (
                      <tr key={item.id} className={index % 2 === 0 ? "bg-background" : "bg-muted/25"}>
                        <td className="p-3">{item.projectTitle}</td>
                        <td className="p-3">{item.organizationName}</td>
                        <td className="p-3">{item.date}</td>
                        <td className="p-3">{item.duration}h</td>
                        <td className="p-3">
                          <Badge variant={item.isVerified ? "default" : "secondary"}>
                            {item.type}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No data found for the selected date range and filters
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export Button */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="font-medium">Ready to Export</p>
              <p className="text-sm text-muted-foreground">
                {filteredData.length} entries selected for CSV export
              </p>
            </div>
            <Button 
              onClick={handleExport}
              disabled={isExporting || filteredData.length === 0}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
