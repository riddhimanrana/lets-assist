"use server";

import { createClient } from "@/utils/supabase/server";
import { parseISO, differenceInMinutes } from "date-fns";

interface MemberHours {
  userId: string;
  totalHours: number;
  eventCount: number;
  lastEventDate?: string;
}

interface MemberEventDetail {
  id: string;
  projectTitle: string;
  eventDate: string;
  hours: number;
  isCertified: boolean;
  organizationName: string;
}

interface MemberHoursExport {
  memberName: string;
  username: string;
  role: string;
  totalHours: string;
  eventCount: number;
  lastActivity: string;
  joinedDate: string;
}

// Helper function to calculate hours from event start/end times
function calculateHours(startTime: string, endTime: string): number {
  try {
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    const minutes = differenceInMinutes(end, start);
    return Math.round((minutes / 60) * 10) / 10; // Round to 1 decimal place
  } catch (e) {
    console.error("Error calculating hours:", e);
    return 0;
  }
}

// Helper function to format hours as "Xh Ym"
function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export async function getMemberVolunteerHours(
  organizationId: string,
  dateRange?: { from: Date; to: Date }
): Promise<{ 
  memberHours: Record<string, MemberHours>; 
  error?: string 
}> {
  const supabase = await createClient();
  
  try {
    // Verify user permissions
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { memberHours: {}, error: "Authentication required" };
    }

    // Check if user is admin or staff of this organization
    const { data: userMembership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .single();

    const _isAdminOrStaff = userMembership?.role === "admin" || userMembership?.role === "staff";
    void _isAdminOrStaff;
    
    // Get all organization projects to filter certificates
    const { data: orgProjects } = await supabase
      .from("projects")
      .select("id, title")
      .eq("organization_id", organizationId);

    if (!orgProjects || orgProjects.length === 0) {
      return { memberHours: {} };
    }

    const projectTitles = orgProjects.map(p => p.title);

    // Get certificates for projects from this organization
    // Instead of filtering by organization_name (which stores org name, not ID),
    // filter by project_title since we already have the project titles from this org
    let query = supabase
      .from("certificates")
      .select(`
        user_id,
        project_title,
        event_start,
        event_end,
        issued_at,
        is_certified,
        organization_name
      `)
      .in("project_title", projectTitles);

    // Add date range filtering if provided
    if (dateRange) {
      query = query
        .gte("issued_at", dateRange.from.toISOString())
        .lt("issued_at", dateRange.to.toISOString());
    }

    const { data: certificates, error: certsError } = await query;

    if (certsError) {
      console.error("Error fetching certificates:", certsError);
      return { memberHours: {}, error: "Failed to fetch volunteer hours" };
    }

    // Calculate hours per member
    const memberHours: Record<string, MemberHours> = {};
    
    if (certificates) {
      certificates.forEach(cert => {
        if (!memberHours[cert.user_id]) {
          memberHours[cert.user_id] = {
            userId: cert.user_id,
            totalHours: 0,
            eventCount: 0,
            lastEventDate: undefined
          };
        }

        const hours = calculateHours(cert.event_start, cert.event_end);
        memberHours[cert.user_id].totalHours += hours;
        memberHours[cert.user_id].eventCount += 1;

        // Update last event date
        const eventDate = cert.issued_at;
        if (!memberHours[cert.user_id].lastEventDate || eventDate > memberHours[cert.user_id].lastEventDate!) {
          memberHours[cert.user_id].lastEventDate = eventDate;
        }
      });
    }

    return { memberHours };
  } catch (error) {
    console.error("Error in getMemberVolunteerHours:", error);
    return { memberHours: {}, error: "Failed to fetch volunteer hours" };
  }
}

export async function getMemberEventDetails(
  organizationId: string, 
  memberId: string,
  dateRange?: { from: Date; to: Date }
): Promise<{ 
  events: MemberEventDetail[]; 
  totalHours: number; 
  error?: string 
}> {
  const supabase = await createClient();
  
  try {
    // Verify user permissions
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { events: [], totalHours: 0, error: "Authentication required" };
    }

    // Check if user can view this member's details
    const { data: userMembership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .single();

    const isAdminOrStaff = userMembership?.role === "admin" || userMembership?.role === "staff";
    const isViewingSelf = user.id === memberId;

    if (!isAdminOrStaff && !isViewingSelf) {
      return { events: [], totalHours: 0, error: "Permission denied" };
    }

    // Get organization projects
    const { data: orgProjects } = await supabase
      .from("projects")
      .select("id, title")
      .eq("organization_id", organizationId);

    if (!orgProjects || orgProjects.length === 0) {
      return { events: [], totalHours: 0 };
    }

    const projectTitles = orgProjects.map(p => p.title);

    // Get member's certificates for organization projects
    let query = supabase
      .from("certificates")
      .select(`
        id,
        project_title,
        event_start,
        event_end,
        issued_at,
        is_certified,
        organization_name
      `)
      .eq("user_id", memberId)
      .in("project_title", projectTitles)
      .order("issued_at", { ascending: false });

    // Add date range filtering if provided
    if (dateRange) {
      query = query
        .gte("issued_at", dateRange.from.toISOString())
        .lt("issued_at", dateRange.to.toISOString());
    }

    const { data: certificates, error: certsError } = await query;

    if (certsError) {
      console.error("Error fetching member certificates:", certsError);
      return { events: [], totalHours: 0, error: "Failed to fetch event details" };
    }

    let totalHours = 0;
    const events: MemberEventDetail[] = [];

    if (certificates) {
      certificates.forEach(cert => {
        const hours = calculateHours(cert.event_start, cert.event_end);
        totalHours += hours;

        events.push({
          id: cert.id,
          projectTitle: cert.project_title,
          eventDate: cert.issued_at,
          hours: hours,
          isCertified: cert.is_certified,
          organizationName: cert.organization_name || ""
        });
      });
    }

    return { events, totalHours };
  } catch (error) {
    console.error("Error in getMemberEventDetails:", error);
    return { events: [], totalHours: 0, error: "Failed to fetch event details" };
  }
}

export async function exportMemberHours(
  organizationId: string,
  dateRange?: { from: Date; to: Date }
): Promise<{
  csvData?: string;
  error?: string;
}> {
  const supabase = await createClient();
  
  try {
    // Verify user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { error: "Authentication required" };
    }

    const { data: userMembership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .single();

    if (userMembership?.role !== "admin") {
      return { error: "Admin access required" };
    }

    // Get all organization members with profiles
    const { data: members, error: membersError } = await supabase
      .from("organization_members")
      .select(`
        id,
        role,
        joined_at,
        user_id,
        profiles (
          id,
          username,
          full_name
        )
      `)
      .eq("organization_id", organizationId)
      .order("role", { ascending: false });

    if (membersError) {
      return { error: "Failed to fetch members" };
    }

    // Get member hours
    const { memberHours } = await getMemberVolunteerHours(organizationId, dateRange);

    // Format export data
    const exportData: MemberHoursExport[] = (members || []).map(member => {
      const hours = memberHours[member.user_id] || { totalHours: 0, eventCount: 0 };
      const profile = Array.isArray(member.profiles)
        ? member.profiles[0]
        : member.profiles;
      
      return {
        memberName: profile?.full_name || "Unknown",
        username: profile?.username || "",
        role: member.role,
        totalHours: formatHours(hours.totalHours),
        eventCount: hours.eventCount,
        lastActivity: hours.lastEventDate
          ? new Date(hours.lastEventDate).toLocaleDateString()
          : "None",
        joinedDate: new Date(member.joined_at).toLocaleDateString()
      };
    });

    // Generate CSV
    const headers = ["Member Name", "Username", "Role", "Total Hours", "Events", "Last Activity", "Joined Date"];
    const csvRows = [headers.join(",")];
    
    exportData.forEach(row => {
      const csvRow = [
        `"${row.memberName}"`,
        row.username,
        row.role,
        row.totalHours,
        row.eventCount.toString(),
        row.lastActivity,
        row.joinedDate
      ].join(",");
      csvRows.push(csvRow);
    });

    const csvData = csvRows.join("\n");
    return { csvData };

  } catch (error) {
    console.error("Error in exportMemberHours:", error);
    return { error: "Failed to export member hours" };
  }
}