export const SYSTEM_BANNER_TYPES = [
  "info",
  "success",
  "warning",
  "outage",
] as const;

export const SYSTEM_BANNER_SCOPES = ["sitewide", "landing"] as const;
export const SYSTEM_BANNER_TEXT_ALIGNS = ["left", "center", "right"] as const;

export type SystemBannerType = (typeof SYSTEM_BANNER_TYPES)[number];
export type SystemBannerScope = (typeof SYSTEM_BANNER_SCOPES)[number];
export type SystemBannerTextAlign = (typeof SYSTEM_BANNER_TEXT_ALIGNS)[number];

export interface SystemBanner {
  id: string;
  title: string | null;
  message: string;
  banner_type: SystemBannerType;
  target_scope: SystemBannerScope;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  cta_label: string | null;
  cta_url: string | null;
  dismissible: boolean;
  show_icon: boolean;
  text_align: SystemBannerTextAlign;
  created_at: string;
  updated_at: string;
}

export interface ActiveSystemBannersResponse {
  sitewide: SystemBanner | null;
  landing: SystemBanner | null;
}
