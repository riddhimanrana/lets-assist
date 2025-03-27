import { Project, ProjectStatus } from "@/types";
import { differenceInHours, parseISO, isAfter, isBefore } from "date-fns";

export const getProjectEventDate = (project: Project): Date => {
  switch (project.event_type) {
    case "oneTime":
      return parseISO(project.schedule.oneTime!.date);
    case "multiDay":
      // Get the earliest date for multi-day events
      return parseISO(project.schedule.multiDay![0].date);
    case "sameDayMultiArea":
      return parseISO(project.schedule.sameDayMultiArea!.date);
    default:
      throw new Error("Invalid event type");
  }
};

export const getProjectEndDate = (project: Project): Date => {
  switch (project.event_type) {
    case "oneTime":
      const date = parseISO(project.schedule.oneTime!.date);
      const [hours, minutes] = project.schedule.oneTime!.endTime.split(':').map(Number);
      return new Date(date.setHours(hours, minutes));
    case "multiDay":
      // Get the last date for multi-day events
      const lastDay = project.schedule.multiDay![project.schedule.multiDay!.length - 1];
      const lastDate = parseISO(lastDay.date);
      const [lastHours, lastMinutes] = lastDay.slots[lastDay.slots.length - 1].endTime.split(':').map(Number);
      return new Date(lastDate.setHours(lastHours, lastMinutes));
    case "sameDayMultiArea":
      const eventDate = parseISO(project.schedule.sameDayMultiArea!.date);
      const [endHours, endMinutes] = project.schedule.sameDayMultiArea!.overallEnd.split(':').map(Number);
      return new Date(eventDate.setHours(endHours, endMinutes));
    default:
      throw new Error("Invalid event type");
  }
};

export const getProjectStatus = (project: Project): ProjectStatus => {
  // If project is already marked as completed or cancelled, return that status
  if (project.status === "completed" || project.status === "cancelled") {
    return project.status;
  }

  const now = new Date();
  const startDate = getProjectEventDate(project);
  const endDate = getProjectEndDate(project);

  // Check if the project is in progress
  if (isAfter(now, startDate) && isBefore(now, endDate)) {
    return "in-progress";
  }

  // If the project has ended but not marked as completed
  if (isAfter(now, endDate)) {
    return "completed";
  }

  // If none of the above, the project hasn't started yet
  return "upcoming";
};

export const canCancelProject = (project: Project): boolean => {
  // Can't cancel already cancelled or completed projects
  if (project.status === "cancelled" || project.status === "completed") {
    return false;
  }

  const eventDate = getProjectEventDate(project);
  const hours = differenceInHours(eventDate, new Date());
  
  // Can only cancel if within 24 hours of event
  return hours <= 24;
};

export const isProjectVisible = (
  project: Project, 
  userId?: string, 
  userOrganizations?: { organization_id: string; role: string }[]
): boolean => {
  // Public projects (is_private=false) are always visible
  if (!project.is_private) {
    return true;
  }

  // Private projects (is_private=true) require organization membership check
  if (project.is_private && project.organization_id) {
    // Must have user and their organizations to check
    if (!userId || !userOrganizations) {
      return false;
    }

    // Check if user is part of the organization
    return userOrganizations.some(org => 
      org.organization_id === project.organization_id
    );
  }

  return false;
};

export const canManageProject = (
  project: Project,
  userId?: string,
  userOrganizations?: { organization_id: string; role: string }[]
): boolean => {
  // Must have a user ID to manage projects
  if (!userId) {
    return false;
  }

  // Project creator can always manage their project
  if (project.creator_id === userId) {
    return true;
  }

  // For organization projects, check if user is admin/staff
  if (project.organization_id && userOrganizations) {
    const orgMembership = userOrganizations.find(
      org => org.organization_id === project.organization_id
    );
    
    if (orgMembership && (orgMembership.role === "admin" || orgMembership.role === "staff")) {
      return true;
    }
  }

  return false;
};

// Add StatusBadgeConfig helper function for consistent status badge appearance
export const getStatusBadgeConfig = (status: string) => {
  const statusConfig: Record<string, {
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: any;
    className: string;
  }> = {
    upcoming: {
      variant: "secondary" as const,
      icon: "Clock",
      className: "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20",
    },
    "in-progress": {
      variant: "default" as const,
      icon: "ClockIcon",
      className: "bg-green-500/10 text-green-500 hover:bg-green-500/20",
    },
    completed: {
      variant: "outline" as const,
      icon: "CheckCircle2",
      className: "bg-green-500/10 text-green-500 hover:bg-green-500/20",
    },
    cancelled: {
      variant: "destructive" as const,
      icon: "XCircle",
      className: "bg-destructive/10 text-destructive hover:bg-destructive/20",
    },
  };

  // Use the config for the status if it exists, otherwise use default
  return statusConfig[status] || {
    variant: "outline" as const,
    icon: "AlertCircle",
    className: "bg-muted/50 text-muted-foreground hover:bg-muted",
  };
};

// Format status text for display (e.g., "in-progress" → "In progress")
export const formatStatusText = (status: string): string => {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ");
};
