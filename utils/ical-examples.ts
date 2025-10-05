/**
 * Example usage of iCal generation utility
 * This file demonstrates how to use the calendar integration
 */

import {
  generateProjectICalFile,
  downloadICalFile,
  generateICalFilename,
} from "@/utils/ical";
import { Project } from "@/types";

// Example: One-time event
export function downloadOneTimeEventICal(project: Project) {
  const icalContent = generateProjectICalFile(
    project,
    undefined, // No specific schedule ID needed for one-time events
    "John Doe", // Organizer name
    "john@example.com" // Organizer email
  );

  const filename = generateICalFilename(project);
  downloadICalFile(icalContent, filename);
}

// Example: Multi-day event (specific slot)
export function downloadMultiDayEventICal(
  project: Project,
  scheduleId: string // e.g., "2025-10-15-0" for first slot on Oct 15
) {
  const icalContent = generateProjectICalFile(
    project,
    scheduleId,
    "Jane Smith",
    "jane@example.com"
  );

  const filename = generateICalFilename(project, scheduleId);
  downloadICalFile(icalContent, filename);
}

// Example: Same-day multi-area event (specific role)
export function downloadSameDayRoleEventICal(
  project: Project,
  roleName: string // e.g., "Registration Desk"
) {
  const icalContent = generateProjectICalFile(
    project,
    roleName,
    "Event Coordinator",
    "coordinator@example.com"
  );

  const filename = generateICalFilename(project, roleName);
  downloadICalFile(icalContent, filename);
}

// Example: Generate iCal content without downloading (for email attachments)
export function generateICalForEmail(project: Project, scheduleId?: string): string {
  return generateProjectICalFile(
    project,
    scheduleId,
    project.profiles.full_name || "Let's Assist",
    project.profiles.email || "noreply@letsassist.app"
  );
}

/**
 * Usage in components:
 * 
 * // In a React component
 * import { downloadOneTimeEventICal } from '@/utils/ical-examples';
 * 
 * const handleDownloadICal = () => {
 *   downloadOneTimeEventICal(project);
 *   toast.success('Calendar event downloaded!');
 * };
 * 
 * <Button onClick={handleDownloadICal}>
 *   <Download className="mr-2 h-4 w-4" />
 *   Download iCal
 * </Button>
 */
