export type InvitationDuration = "1_week" | "1_month";

export type InvitationDeliveryStatus = "pending" | "sent" | "failed" | "skipped";

export const DEFAULT_INVITATION_DURATION: InvitationDuration = "1_month";

const DURATION_DAYS: Record<InvitationDuration, number> = {
  "1_week": 7,
  "1_month": 30,
};

export function normalizeInvitationDuration(value: unknown): InvitationDuration {
  if (value === "1_week" || value === "1_month") {
    return value as InvitationDuration;
  }
  return DEFAULT_INVITATION_DURATION;
}

export function getInvitationDurationDays(duration: InvitationDuration): number {
  return DURATION_DAYS[duration];
}

export function getInvitationDurationLabel(duration: InvitationDuration): string {
  return duration === "1_month" ? "1 month" : "1 week";
}

export function getInvitationExpirationDetails(duration: InvitationDuration): {
  expiresAtDate: Date;
  expiresAtIso: string;
  expiresAtDisplay: string;
} {
  const expiresAtDate = new Date();
  expiresAtDate.setDate(expiresAtDate.getDate() + getInvitationDurationDays(duration));

  return {
    expiresAtDate,
    expiresAtIso: expiresAtDate.toISOString(),
    expiresAtDisplay: expiresAtDate.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
}

export function getInvitationBaseUrl(): string {
  const explicitSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "").trim();
  if (explicitSiteUrl) {
    return explicitSiteUrl.replace(/\/$/, "");
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (supabaseUrl.startsWith("http://127.0.0.1") || supabaseUrl.startsWith("http://localhost")) {
    return "http://localhost:3000";
  }

  const vercelUrl = (process.env.VERCEL_URL || "").trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }

  return "https://lets-assist.com";
}
