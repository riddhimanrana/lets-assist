import posthog from "posthog-js";
import {
  ANALYTICS_PRIVACY_CONFIG,
  shouldInitializeAnalytics,
} from "./lib/analytics-privacy";

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
if (
  posthogToken &&
  typeof window !== "undefined" &&
  shouldInitializeAnalytics(
    window.location,
    process.env.NODE_ENV,
    process.env.NEXT_PUBLIC_VERCEL_ENV,
  )
) {
  posthog.init(posthogToken, {
    ...ANALYTICS_PRIVACY_CONFIG,
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
}
