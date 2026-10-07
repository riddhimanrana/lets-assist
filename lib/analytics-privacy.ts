import type { CaptureResult, PostHogConfig } from "posthog-js";

const PRODUCTION_HOSTS = new Set(["lets-assist.com", "www.lets-assist.com"]);
const PUBLIC_PATHS = new Set([
  "/",
  "/home",
  "/organization",
  "/faq",
  "/help",
  "/contact",
  "/privacy",
  "/terms",
]);
const UUID =
  /^(?:\$device:)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Unknown and private routes have no analytics contract and are not captured. */
export function publicAnalyticsUrl(input: unknown): URL | null {
  if (typeof input !== "string" || input.length > 8192) return null;
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !PRODUCTION_HOSTS.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      return null;

    const pathname = url.pathname.replace(/\/$/, "") || "/";
    let route: string;
    if (PUBLIC_PATHS.has(pathname)) route = pathname;
    else if (/^\/projects\/[a-f0-9-]{36}$/i.test(pathname))
      route = "/projects/[id]";
    else if (/^\/profile\/[^/]+$/.test(pathname)) route = "/profile/[username]";
    else return null;

    return new URL(route, "https://lets-assist.com");
  } catch {
    return null;
  }
}

export function shouldInitializeAnalytics(
  location: Pick<Location, "hostname" | "protocol">,
  nodeEnvironment: string | undefined,
  vercelEnvironment: string | undefined,
) {
  return (
    nodeEnvironment === "production" &&
    (!vercelEnvironment || vercelEnvironment === "production") &&
    location.protocol === "https:" &&
    PRODUCTION_HOSTS.has(location.hostname)
  );
}

/** Build a new allowlisted payload; never copy arbitrary event or person fields. */
export function sanitizeAnalyticsEvent(
  event: CaptureResult | null,
): CaptureResult | null {
  if (!event || event.event !== "$pageview" || !UUID.test(event.uuid))
    return null;
  const url = publicAnalyticsUrl(event.properties.$current_url);
  const distinctId: unknown = event.properties.distinct_id;
  if (!url || typeof distinctId !== "string" || !UUID.test(distinctId))
    return null;

  const properties: CaptureResult["properties"] = {
    distinct_id: distinctId,
    $current_url: url.href,
    $pathname: url.pathname,
    $host: url.host,
    $process_person_profile: false,
    $geoip_disable: true,
    $lib: "web",
  };
  for (const key of ["$session_id", "$window_id", "$device_id"] as const) {
    const value: unknown = event.properties[key];
    if (typeof value === "string" && UUID.test(value)) properties[key] = value;
  }
  for (const key of [
    "$viewport_height",
    "$viewport_width",
    "$screen_height",
    "$screen_width",
  ] as const) {
    const value: unknown = event.properties[key];
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 32768
    ) {
      properties[key] = Math.round(value);
    }
  }
  const version: unknown = event.properties.$lib_version;
  if (
    typeof version === "string" &&
    /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)
  ) {
    properties.$lib_version = version;
  }
  return {
    uuid: event.uuid,
    event: "$pageview",
    properties,
    ...(event.timestamp instanceof Date &&
    Number.isFinite(event.timestamp.getTime())
      ? { timestamp: event.timestamp }
      : {}),
  };
}

export const ANALYTICS_PRIVACY_CONFIG = {
  defaults: "2026-01-30",
  autocapture: false,
  capture_pageview: "history_change",
  capture_pageleave: false,
  capture_exceptions: false,
  capture_performance: false,
  capture_heatmaps: false,
  capture_dead_clicks: false,
  rageclick: false,
  disable_session_recording: true,
  enable_recording_console_log: false,
  disable_surveys: true,
  disable_product_tours: true,
  disable_external_dependency_loading: true,
  advanced_disable_flags: true,
  person_profiles: "never",
  persistence: "memory",
  save_referrer: false,
  save_campaign_params: false,
  mask_all_text: true,
  mask_all_element_attributes: true,
  respect_dnt: true,
  ip: false,
  before_send: sanitizeAnalyticsEvent,
} satisfies Partial<PostHogConfig>;
