import type { DateRange } from "@daypicker/react";

export type MemberProfile = {
  full_name?: string | null;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
};

export type OrganizationMember = {
  id: string;
  user_id: string;
  role: "admin" | "staff" | "member";
  joined_at: string;
  profiles?: MemberProfile | MemberProfile[] | null;
};

export type MemberHoursSummary = {
  totalHours: number;
  eventCount: number;
  lastEventDate?: string;
};

export type MemberHoursMap = Record<string, MemberHoursSummary>;

/** Staff-only directory fields, keyed by membership id. */
export type MemberDirectoryEntry = {
  email: string | null;
  status: string | null;
  lastActivityAt: string | null;
};

export type MemberDirectoryMap = Record<string, MemberDirectoryEntry>;

export type MemberRoleFilter = "all" | OrganizationMember["role"];
export type MemberStatusFilter = "all" | "active" | "inactive";

export type MemberHoursPeriod = DateRange | undefined;

export const MEMBER_ROLE_LABELS: Record<OrganizationMember["role"], string> = {
  admin: "Admin",
  staff: "Staff",
  member: "Member",
};

export const getMemberProfile = (
  member: Pick<OrganizationMember, "profiles">,
): MemberProfile | null =>
  Array.isArray(member.profiles)
    ? (member.profiles[0] ?? null)
    : (member.profiles ?? null);

export const getMemberName = (member: Pick<OrganizationMember, "profiles">) =>
  getMemberProfile(member)?.full_name || "Unknown User";

/** Formats decimal hours as "Xh Ym". */
export function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
