"use server";

import { createClient } from "@/utils/supabase/server";

// Get admin dashboard metrics
export async function getAdminDashboardMetrics(organizationId: string) {
  const supabase = await createClient();

  try {
    // First get all project IDs for this organization
    const { data: orgProjects } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", organizationId);
    
    const projectIds = orgProjects?.map(p => p.id) || [];
    
    if (projectIds.length === 0) {
      return {
        totalVolunteers: 0,
        totalHours: 0,
        activeProjects: 0,
        pendingVerificationHours: 0,
      };
    }

    // Get total volunteers (unique users with approved signups)
    const { data: volunteersData } = await supabase
      .from("project_signups")
      .select("user_id")
      .in("project_id", projectIds)
      .eq("status", "approved");

    // Get total volunteer hours (verified)
    const { data: certificatesData } = await supabase
      .from("certificates")
      .select("hours")
      .in("project_id", projectIds)
      .eq("hours_verified", true);

    // Get active projects count
    const { data: activeProjectsData } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", organizationId)
      .in("status", ["upcoming", "in-progress"]);

    // Get pending verification hours
    const { data: pendingData } = await supabase
      .from("certificates")
      .select("hours")
      .in("project_id", projectIds)
      .eq("hours_verified", false);

    // Count unique volunteers
    const uniqueVolunteers = new Set(volunteersData?.map(v => v.user_id) || []).size;
    const totalHours = certificatesData?.reduce((sum, cert) => sum + (cert.hours || 0), 0) || 0;
    const pendingHours = pendingData?.reduce((sum, cert) => sum + (cert.hours || 0), 0) || 0;

    return {
      totalVolunteers: uniqueVolunteers,
      totalHours,
      activeProjects: activeProjectsData?.length || 0,
      pendingVerificationHours: pendingHours,
    };
  } catch (error) {
    console.error("Error fetching dashboard metrics:", error);
    return {
      totalVolunteers: 0,
      totalHours: 0,
      activeProjects: 0,
      pendingVerificationHours: 0,
    };
  }
}

// Get top volunteers for an organization
export async function getTopVolunteers(
  organizationId: string,
  limit: number = 10,
  sortBy: "hours" | "events" | "recent" = "hours"
) {
  const supabase = await createClient();

  try {
    // First get all project IDs for this organization
    const { data: orgProjects } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", organizationId);
    
    const projectIds = orgProjects?.map(p => p.id) || [];
    
    if (projectIds.length === 0) {
      return [];
    }

    // Get all certificates for org projects with user info
    const { data: certificates } = await supabase
      .from("certificates")
      .select(`
        id,
        hours,
        hours_verified,
        created_at,
        user_id,
        project_id,
        profiles!inner(
          id,
          full_name,
          avatar_url,
          email
        )
      `)
      .in("project_id", projectIds);

    // Get all approved signups for org projects
    const { data: signups } = await supabase
      .from("project_signups")
      .select("user_id, project_id, created_at")
      .in("project_id", projectIds)
      .eq("status", "approved");

    // Aggregate by user
    const userMap = new Map<string, {
      id: string;
      name: string;
      avatar: string | null;
      email: string;
      totalHours: number;
      verifiedHours: number;
      eventsAttended: number;
      certificatesEarned: number;
      lastEventDate: Date | null;
    }>();

    // Process certificates
    for (const cert of certificates || []) {
      const profile = cert.profiles as { id: string; full_name: string | null; avatar_url: string | null; email: string | null } | null;
      if (!profile) continue;
      
      const existing = userMap.get(cert.user_id) || {
        id: profile.id,
        name: profile.full_name || "Unknown",
        avatar: profile.avatar_url,
        email: profile.email || "",
        totalHours: 0,
        verifiedHours: 0,
        eventsAttended: 0,
        certificatesEarned: 0,
        lastEventDate: null,
      };
      
      existing.totalHours += cert.hours || 0;
      if (cert.hours_verified) {
        existing.verifiedHours += cert.hours || 0;
      }
      existing.certificatesEarned += 1;
      
      userMap.set(cert.user_id, existing);
    }

    // Process signups for event count and last date
    for (const signup of signups || []) {
      const existing = userMap.get(signup.user_id);
      if (existing) {
        existing.eventsAttended += 1;
        const signupDate = new Date(signup.created_at);
        if (!existing.lastEventDate || signupDate > existing.lastEventDate) {
          existing.lastEventDate = signupDate;
        }
      }
    }

    // Convert to array and sort
    const processedVolunteers = Array.from(userMap.values())
      .map(v => ({
        ...v,
        totalHours: parseFloat(v.totalHours.toFixed(2)),
        verifiedHours: parseFloat(v.verifiedHours.toFixed(2)),
      }))
      .sort((a, b) => {
        if (sortBy === "hours") return b.totalHours - a.totalHours;
        if (sortBy === "events") return b.eventsAttended - a.eventsAttended;
        if (sortBy === "recent")
          return (
            (b.lastEventDate?.getTime() || 0) -
            (a.lastEventDate?.getTime() || 0)
          );
        return 0;
      })
      .slice(0, limit);

    return processedVolunteers;
  } catch (error) {
    console.error("Error fetching top volunteers:", error);
    return [];
  }
}

// Get organization projects with stats
export async function getOrgProjectsWithStats(organizationId: string) {
  const supabase = await createClient();

  try {
    const { data: projects } = await supabase
      .from("projects")
      .select(
        `
        id,
        title,
        status,
        visibility,
        verification_method,
        created_at,
        event_type,
        location,
        project_signups(
          id,
          status,
          project_id
        ),
        certificates(
          id,
          hours,
          hours_verified
        )
      `
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    const projectStats = (projects || []).map((project: {
      id: string;
      title: string;
      status: string;
      visibility: string;
      verification_method: string;
      event_type: string;
      location: string | null;
      created_at: string;
      project_signups: Array<{ id: string; status: string; project_id: string }>;
      certificates: Array<{ id: string; hours: number; hours_verified: boolean }>;
    }) => {
      const totalSignups = project.project_signups.length;
      const approvedSignups = project.project_signups.filter(
        (ps) => ps.status === "approved"
      ).length;
      const participationRate =
        totalSignups > 0 ? (approvedSignups / totalSignups) * 100 : 0;

      const totalHours = project.certificates.reduce(
        (sum: number, cert) => sum + (cert.hours || 0),
        0
      );
      const hoursVerified = project.certificates
        .filter((cert) => cert.hours_verified)
        .reduce((sum: number, cert) => sum + (cert.hours || 0), 0);
      const hoursPending = totalHours - hoursVerified;

      return {
        id: project.id,
        title: project.title,
        status: project.status,
        visibility: project.visibility,
        verificationMethod: project.verification_method,
        eventType: project.event_type,
        location: project.location,
        createdAt: project.created_at,
        totalSignups,
        approvedSignups,
        participationRate: parseFloat(participationRate.toFixed(1)),
        totalHours: parseFloat(totalHours.toFixed(2)),
        hoursVerified: parseFloat(hoursVerified.toFixed(2)),
        hoursPending: parseFloat(hoursPending.toFixed(2)),
      };
    });

    return projectStats;
  } catch (error) {
    console.error("Error fetching project stats:", error);
    return [];
  }
}

// Log admin action - REMOVED (using dynamic calculation instead)
// Get recent activity for organization - REMOVED (using dynamic calculation instead)


// Get member directory
export async function getOrganizationMembers(organizationId: string) {
  const supabase = await createClient();

  try {
    const { data: members } = await supabase
      .from("organization_members")
      .select(
        `
        id,
        role,
        joined_at,
        status,
        last_activity_at,
        can_verify_hours,
        profiles(
          id,
          full_name,
          avatar_url,
          email
        )
      `
      )
      .eq("organization_id", organizationId)
      .eq("is_visible", true)
      .order("role", { ascending: false });


    return (((members || []) as unknown) as Array<{
      id: string;
      role: string;
      joined_at: string;
      status: string;
      last_activity_at: string | null;
      can_verify_hours: boolean;
      profiles: { id: string; full_name: string; email: string; avatar_url: string | null } | null;
    }>).map((member) => ({
      id: member.id,
      userId: member.profiles?.id,
      name: member.profiles?.full_name,
      email: member.profiles?.email,
      avatar: member.profiles?.avatar_url,
      role: member.role,
      status: member.status,
      joinedAt: member.joined_at,
      lastActivityAt: member.last_activity_at,
      canVerifyHours: member.can_verify_hours,
    }));
  } catch (error) {
    console.error("Error fetching organization members:", error);
    return [];
  }
}
