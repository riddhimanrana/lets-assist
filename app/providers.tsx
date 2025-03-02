// app/providers.jsx
"use client";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import PostHogPageView from "./PostHogPageView";

interface PostHogProviderProps {
  children: React.ReactNode;
}

export function PostHogProvider({ children }: PostHogProviderProps) {
  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || "", {
      api_host: "/ingest",
      ui_host: "https://us.posthog.com",
      person_profiles: "identified_only", // or 'always' to create profiles for anonymous users as well
      capture_pageview: true, // Enable automatic pageview capture
    });
  }, []);

  return (
    <PHProvider client={posthog}>
      <PostHogPageView />
      {children}
    </PHProvider>
  );
}
