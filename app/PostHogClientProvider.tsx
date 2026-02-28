// app/PostHogClientProvider.tsx
"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import PostHogPageView from "./PostHogPageView";

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
