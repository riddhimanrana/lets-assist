import posthog from "posthog-js";
import { applyInitialTheme } from "@/lib/theme/apply-initial-theme";

applyInitialTheme();

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
if (posthogToken) {
  posthog.init(posthogToken, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2026-01-30",
  });
}
