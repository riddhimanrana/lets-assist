"use client";
import { safeConsole } from "@/lib/safe-console";

import { certificateHours } from "@/lib/projects/certificate-duration";

import React, { useState, useMemo } from "react";
import { DownloadIcon, useAnimatedIcon } from "@/components/icons/animated";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateRange } from "@daypicker/react";
import { format } from "date-fns";
import { toast } from "sonner";

interface ExportSectionProps {
  userEmail: string;
  verifiedCount?: number;
  unverifiedCount?: number;
  totalCertificates?: number;
  certificatesData?: CertificateRecord[];
}

type CertificateRecord = {
  id: string;
  project_title?: string | null;
  title?: string | null;
  organization_name?: string | null;
  creator_name?: string | null;
  volunteer_name?: string | null;
  volunteer_email?: string | null;
  event_start?: string | null;
  event_end?: string | null;
  credited_minutes?: number | null;
  hours?: number | string | null;
  project_location?: string | null;
  is_certified?: boolean | null;
  check_in_method?: string | null;
  issued_at?: string | null;
  type?: string | null;
  projects?: { project_timezone?: string | null } | null;
};

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
  certificationStatus: string;
  checkInMethod: string;
  issuedDate: string;
}

export function ExportSection({
  userEmail,
  verifiedCount: _verifiedCount = 0,
  unverifiedCount: _unverifiedCount = 0,
  totalCertificates: _totalCertificates = 0,
  certificatesData = [],
}: ExportSectionProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const [includeVerified, setIncludeVerified] = useState(true);
  const [includeUnverified, setIncludeUnverified] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const exportIcon = useAnimatedIcon();

  // Convert certificates data to export format
  const convertCertificateToExportData = (
    cert: CertificateRecord,
  ): ExportData => {
    const isVerified = (cert.type || "platform") === "platform";
    return {
      id: cert.id,
      projectTitle: cert.project_title || cert.title || "Unknown Project",
      organizationName:
        cert.organization_name || cert.creator_name || "Unknown Organization",
      volunteerName: cert.volunteer_name || "Unknown Volunteer",
      volunteerEmail: cert.volunteer_email || userEmail,
      date: cert.event_start
        ? format(new Date(cert.event_start), "yyyy-MM-dd")
        : "Unknown Date",
      startTime: cert.event_start
        ? (() => {
            const timezone =
              cert.projects?.project_timezone || "America/Los_Angeles";
            const timeStr = format(new Date(cert.event_start), "h:mm a");
            try {
              const tzAbbr = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                timeZoneName: "short",
              })
                .formatToParts(new Date(cert.event_start))
                .find((part) => part.type === "timeZoneName")?.value;
              return tzAbbr ? `${timeStr} ${tzAbbr}` : timeStr;
            } catch {
              return timeStr;
            }
          })()
        : "Unknown",
      endTime: cert.event_end
        ? (() => {
            const timezone =
              cert.projects?.project_timezone || "America/Los_Angeles";
            const timeStr = format(new Date(cert.event_end), "h:mm a");
            try {
              const tzAbbr = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                timeZoneName: "short",
              })
                .formatToParts(new Date(cert.event_end))
                .find((part) => part.type === "timeZoneName")?.value;
              return tzAbbr ? `${timeStr} ${tzAbbr}` : timeStr;
            } catch {
              return timeStr;
            }
          })()
        : "Unknown",
      duration: certificateHours(cert, () =>
        Number(cert.hours || 0),
      ).toString(),
      location: cert.project_location || "Unknown Location",
      supervisorContact: cert.creator_name || "Unknown Supervisor",
      isVerified: isVerified,
      type: isVerified ? "platform" : "self-reported", // Use lowercase to match DB values
      certificationStatus: cert.is_certified ? "Certified" : "Participated",
      checkInMethod: cert.check_in_method || "Unknown",
      issuedDate: cert.issued_at
        ? format(new Date(cert.issued_at), "yyyy-MM-dd")
        : "Unknown Date",
    };
  };

  // Convert all certificates data to export format
  const allExportData = useMemo(() => {
    return certificatesData.map(convertCertificateToExportData);
  }, [certificatesData, userEmail]);

  // Calculate actual counts from processed data
  const actualVerifiedCount = allExportData.filter(
    (item) => item.isVerified,
  ).length;
  const actualUnverifiedCount = allExportData.filter(
    (item) => !item.isVerified,
  ).length;

  // Filter data based on date range and type selection
  const filteredData = useMemo(() => {
    // If no date range is selected, show all data
    if (!dateRange?.from || !dateRange?.to) {
      return allExportData.filter((item) => {
        const typeIncluded =
          (item.isVerified && includeVerified) ||
          (!item.isVerified && includeUnverified);
        return typeIncluded;
      });
    }

    return allExportData.filter((item) => {
      const itemDate = new Date(item.date);
      const inDateRange =
        itemDate >= dateRange.from! && itemDate <= dateRange.to!;
      const typeIncluded =
        (item.isVerified && includeVerified) ||
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
      // Build CSV with columns that match the verification modal expectations
      const headers = [
        "Certificate ID",
        "Project Title",
        "Organization Name",
        "Project Organizer Name",
        "Certification Status",
        "Certificate Type",
        "Event Start Date",
        "Event End Date",
        "Duration",
        "Location",
        "Check In Method",
        "Volunteer Name",
        "Volunteer Email",
        "Issued Date",
      ];

      const rows = filteredData.map((item) => [
        item.id, // Certificate ID
        item.projectTitle, // Project Title
        item.organizationName, // Organization Name
        item.supervisorContact, // Project Organizer Name
        item.certificationStatus, // Certification Status
        item.type, // Certificate Type
        item.date + " " + item.startTime, // Event Start Date with time
        item.date + " " + item.endTime, // Event End Date with time
        item.duration, // Duration
        item.location, // Location
        item.checkInMethod, // Check In Method
        item.volunteerName, // Volunteer Name
        item.volunteerEmail, // Volunteer Email
        item.issuedDate, // Issued Date
      ]);

      // Generate CSV
      const csvContent = [headers, ...rows]
        .map((row) => row.map((field) => `"${field}"`).join(","))
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
      safeConsole.error("Export failed:", error);
      toast.error("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="grid gap-6">
      <SettingsSection
        title="Date range"
        description="Select a time period for your export, or leave blank for all-time data"
      >
        <DateRangePicker
          value={dateRange}
          onChange={setDateRange}
          className="w-full"
          showQuickSelect={true}
        />
      </SettingsSection>

      <SettingsSection
        title="Data types"
        description="Choose which types of volunteer hours to include"
      >
        <div className="flex items-center gap-2">
          <Checkbox
            id="verified"
            checked={includeVerified}
            onCheckedChange={(checked) => setIncludeVerified(!!checked)}
          />
          <Label htmlFor="verified" className="flex items-center gap-2">
            Verified hours
            <Badge variant="secondary">{actualVerifiedCount}</Badge>
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="unverified"
            checked={includeUnverified}
            onCheckedChange={(checked) => setIncludeUnverified(!!checked)}
          />
          <Label htmlFor="unverified" className="flex items-center gap-2">
            Self-reported hours
            <Badge variant="secondary">{actualUnverifiedCount}</Badge>
          </Label>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Export preview"
        description={
          <>
            Preview of data that will be exported ({filteredData.length}{" "}
            entries)
            {!dateRange?.from || !dateRange?.to
              ? " - All time data"
              : ` - ${dateRange.from ? format(dateRange.from, "MMM d") : ""} to ${dateRange.to ? format(new Date(dateRange.to.getTime() - 24 * 60 * 60 * 1000), "MMM d") : ""}`}
          </>
        }
        footerHint={`${filteredData.length} entries selected for CSV export`}
        footer={
          <Button
            onClick={handleExport}
            disabled={isExporting || filteredData.length === 0}
            {...exportIcon.triggerProps}
          >
            <DownloadIcon
              ref={exportIcon.ref}
              size={16}
              data-icon="inline-start"
              aria-hidden="true"
            />
            {isExporting ? "Exporting..." : "Export CSV"}
          </Button>
        }
      >
        {filteredData.length > 0 ? (
          <div className="max-h-96 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Certificate ID</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">
                      {item.id}
                    </TableCell>
                    <TableCell>{item.projectTitle}</TableCell>
                    <TableCell>{item.organizationName}</TableCell>
                    <TableCell>{item.date}</TableCell>
                    <TableCell>{item.duration}h</TableCell>
                    <TableCell>
                      <Badge
                        variant={item.isVerified ? "secondary" : "outline"}
                      >
                        {item.isVerified ? "Verified" : "Self-reported"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground py-8 text-center">
            No data found for the selected date range and filters
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
