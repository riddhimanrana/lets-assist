import { normalizeRedirectPath } from "@/app/signup/redirect-utils";

export type StaffInviteStatus =
  | "success"
  | "invalid_token"
  | "expired_token"
  | "org_not_found"
  | "error";

export interface StaffInviteOutcome {
  status: StaffInviteStatus;
  orgUsername: string;
  orgName?: string | null;
}

export type StaffInviteToastPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center";

interface StaffInviteRedirectOptions {
  fallbackPath?: string | null;
  toastPosition?: StaffInviteToastPosition;
}

export function getStaffInviteOrgLabel(
  invite: Pick<StaffInviteOutcome, "orgUsername" | "orgName">,
): string {
  const normalizedOrgName = invite.orgName?.trim();

  if (normalizedOrgName) {
    return normalizedOrgName;
  }

  return invite.orgUsername;
}

export function getStaffInviteToastContent(
  status: StaffInviteStatus,
  orgLabel: string,
) {
  switch (status) {
    case "success":
      return {
        title: "Staff invite applied",
        description: `You were added to "${orgLabel}" as staff.`,
      };
    case "invalid_token":
      return {
        title: "Invite could not be applied",
        description: `The invite link for "${orgLabel}" is no longer valid.`,
      };
    case "expired_token":
      return {
        title: "Invite expired",
        description: `The staff invite for "${orgLabel}" has expired.`,
      };
    case "org_not_found":
      return {
        title: "Invite could not be applied",
        description: `The organization "${orgLabel}" could not be found.`,
      };
    case "error":
    default:
      return {
        title: "Invite processing issue",
        description: `You signed in, but we could not process your invite for "${orgLabel}".`,
      };
  }
}

export function buildStaffInviteRedirectPath(
  outcome: StaffInviteOutcome,
  options: StaffInviteRedirectOptions = {},
): string {
  const normalizedFallbackPath =
    normalizeRedirectPath(options.fallbackPath) ?? "/organization";

  const targetPath =
    outcome.status === "org_not_found"
      ? normalizedFallbackPath
      : `/organization/${outcome.orgUsername}`;

  const redirectUrl = new URL(targetPath, "https://lets-assist.local");

  redirectUrl.searchParams.set("invite_status", outcome.status);
  redirectUrl.searchParams.set("invite_org", getStaffInviteOrgLabel(outcome));

  if (options.toastPosition) {
    redirectUrl.searchParams.set(
      "invite_toast_position",
      options.toastPosition,
    );
  }

  return `${redirectUrl.pathname}${redirectUrl.search}`;
}