import posthog from "posthog-js";
import { applyInitialTheme } from "@/lib/theme/apply-initial-theme";

applyInitialTheme();

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  defaults: "2026-01-30",
});
