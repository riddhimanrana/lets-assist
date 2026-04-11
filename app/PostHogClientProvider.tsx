// app/PostHogClientProvider.tsx
"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import PostHogPageView from "./PostHogPageView";

let hasInitializedPostHog = false;

interface Props {
  children: React.ReactNode;
}

export default function PostHogClientProvider({ children }: Props) {
  useEffect(() => {
    // Allow disabling analytics via URL param, useful for debugging signup flows
    if (window.location.search.includes("disable_analytics")) {
      console.log("[PostHog] Disabled via URL param");
      return;
    }

    // React 18/19 dev mode and Suspense/lazy remounts can invoke this effect
    // more than once in the same browser session. PostHog already treats
    // repeated init() calls as a no-op, but it still logs a warning. Guard the
    // singleton explicitly so we only initialize once per session.
    if (hasInitializedPostHog) {
      return;
    }

    hasInitializedPostHog = true;

    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || "", {
      api_host: "/ingest",
      ui_host: "https://us.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: true,
    });
  }, []);

  return (
    <PHProvider client={posthog}>
      <PostHogPageView />
      {children}
    </PHProvider>
  );
}
