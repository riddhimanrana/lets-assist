"use server";

import { createClient } from "@/utils/supabase/server";
import { format } from "date-fns";

interface CertificateExportData {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  event_start: string;
  event_end: string;
  volunteer_email: string | null;
  organization_name: string | null;
  project_id: string | null;
  schedule_id: string | null;
  issued_at: string;
  signup_id: string | null;
  volunteer_name: string | null;
  project_location: string | null;
  projects?: {
    project_timezone?: string;
  };
}

// Helper function to calculate hours between two timestamps
function calculateHours(startTime: string, endTime: string): number {
  try {
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (end < start) return 0;
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 10) / 10; // Round to 1 decimal place
  } catch (e) {
    console.error("Error calculating hours:", e);
    return 0;
  }
}

export async function exportCertificates(
  userEmail: string,
  startDate?: Date,
  endDate?: Date
): Promise<{ success: boolean; csv?: string; filename?: string; error?: string }> {
  try {
    const supabase = await createClient();

    // Build the query with date filtering
    let query = supabase
      .from("certificates")
      .select(`
        *,
        projects!inner(
          project_timezone
        )
      `)
      .eq("volunteer_email", userEmail)
      .order("issued_at", { ascending: false });

    // Apply date filters if provided
    if (startDate) {
      query = query.gte("issued_at", startDate.toISOString());
    }
    if (endDate) {
      query = query.lt("issued_at", endDate.toISOString());
    }

    const { data: certificates, error } = await query;

    if (error) {
      console.error("Error fetching certificates:", error);
      return { success: false, error: "Failed to fetch certificates" };
    }

    if (!certificates || certificates.length === 0) {
      return { success: false, error: "No certificates found for the selected date range" };
    }

    // CSV Headers
    const headers = [
      "Certificate ID",
      "Project Title",
      "Organization Name",
      "Project Organizer Name",
      "Certification Status",
      "Event Start Date",
      "Event End Date",
      "Duration (Hours)",
      "Project Location",
      "Issued Date"
    ];

    // Convert data to CSV rows
    const rows = certificates.map((cert: CertificateExportData) => {
      const hours = calculateHours(cert.event_start, cert.event_end);
      
      return [
        cert.id,
        cert.project_title || "N/A",
        cert.organization_name || "N/A",
        cert.creator_name || "N/A",
        cert.is_certified ? "Certified" : "Participated",
        (() => {
          const timezone = cert.projects?.project_timezone || 'America/Los_Angeles';
          const dateStr = format(new Date(cert.event_start), "yyyy-MM-dd HH:mm");
          try {
            const tzAbbr = new Intl.DateTimeFormat('en-US', { 
              timeZone: timezone, 
              timeZoneName: 'short' 
            }).formatToParts(new Date(cert.event_start)).find(part => part.type === 'timeZoneName')?.value;
            return tzAbbr ? `${dateStr} ${tzAbbr}` : dateStr;
          } catch {
            return dateStr;
          }
        })(),
        (() => {
          const timezone = cert.projects?.project_timezone || 'America/Los_Angeles';
          const dateStr = format(new Date(cert.event_end), "yyyy-MM-dd HH:mm");
          try {
            const tzAbbr = new Intl.DateTimeFormat('en-US', { 
              timeZone: timezone, 
              timeZoneName: 'short' 
            }).formatToParts(new Date(cert.event_end)).find(part => part.type === 'timeZoneName')?.value;
            return tzAbbr ? `${dateStr} ${tzAbbr}` : dateStr;
          } catch {
            return dateStr;
          }
        })(),
        hours.toString(),
        cert.project_location || "N/A",
        format(new Date(cert.issued_at), "yyyy-MM-dd HH:mm")
      ];
    });

    // Calculate summary statistics
    const totalHours = certificates.reduce((sum, cert) => {
      return sum + calculateHours(cert.event_start, cert.event_end);
    }, 0);
    
    const totalCertified = certificates.filter(cert => cert.is_certified).length;
    const totalParticipated = certificates.filter(cert => !cert.is_certified).length;
    const uniqueOrganizations = [...new Set(certificates.map(cert => cert.organization_name).filter(Boolean))];
    const uniqueProjects = [...new Set(certificates.map(cert => cert.project_id).filter(Boolean))];

    // Add summary section
    const summaryRows = [
      [], // Empty row for spacing
      ["=== SUMMARY ==="],
      [],
      ["Total Certificates:", certificates.length.toString()],
      ["Total Hours:", totalHours.toFixed(1)],
      ["Certified:", totalCertified.toString()],
      ["Participated:", totalParticipated.toString()],
      ["Unique Organizations:", uniqueOrganizations.length.toString()],
      ["Unique Projects:", uniqueProjects.length.toString()],
      [],
      ["=== DEFINITIONS ==="],
      [],
      ["Certified:", "Successfully completed all requirements and earned official certification"],
      ["Participated:", "Attended and participated in the volunteer activity"],
      ["Organization Name:", "The formal organization hosting the volunteer opportunity (N/A for independent projects)"],
      ["Project Organizer Name:", "The individual who created and manages the volunteer project"],
      [],
      ["=== DATE RANGE ==="],
      []
    ];

    // Add date range info
    if (startDate && endDate) {
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(new Date(endDate.getTime() - 24 * 60 * 60 * 1000), "yyyy-MM-dd");
      summaryRows.push([`From ${startStr} to ${endStr}`]);
    } else if (startDate) {
      summaryRows.push([`From ${format(startDate, "yyyy-MM-dd")} onwards`]);
    } else if (endDate) {
      summaryRows.push([`Until ${format(new Date(endDate.getTime() - 24 * 60 * 60 * 1000), "yyyy-MM-dd")}`]);
    } else {
      summaryRows.push(["All time (lifetime data)"]);
    }

    summaryRows.push([]);
    summaryRows.push([`Generated on: ${format(new Date(), "yyyy-MM-dd HH:mm:ss")}`]);

    // Create CSV content
    const csvContent = [headers, ...rows, ...summaryRows]
      .map(row => row.map(field => `"${field.toString().replace(/"/g, '""')}"`).join(","))
      .join("\n");

    // Generate filename with date range
    let filename = "certificates";
    if (startDate && endDate) {
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(new Date(endDate.getTime() - 24 * 60 * 60 * 1000), "yyyy-MM-dd"); // Subtract 1 day for display
      filename += `_${startStr}_to_${endStr}`;
    } else if (startDate) {
      filename += `_from_${format(startDate, "yyyy-MM-dd")}`;
    } else if (endDate) {
      filename += `_until_${format(new Date(endDate.getTime() - 24 * 60 * 60 * 1000), "yyyy-MM-dd")}`;
    } else {
      filename += "_lifetime";
    }
    filename += `_${format(new Date(), "yyyy-MM-dd")}.csv`;

    return {
      success: true,
      csv: csvContent,
      filename
    };
  } catch (error) {
    console.error("Error exporting certificates:", error);
    return { success: false, error: "Failed to export certificates" };
  }
}
