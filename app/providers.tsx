// app/providers.jsx
"use client";
import { lazy, Suspense } from "react";
const PostHogClientProvider = lazy(() => import("./PostHogClientProvider"));

interface PostHogProviderProps {
  children: React.ReactNode;
}

export function PostHogProvider({ children }: PostHogProviderProps) {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  // If no PostHog key is configured, don't render the provider or initialize PostHog.
  if (!posthogKey) {
    console.log("[PostHog] Skipping initialization: NEXT_PUBLIC_POSTHOG_KEY not set");
    return <>{children}</>;
  }

  // Lazy-load the client-side PostHog wrapper so the library (and its
  // requests to `/ingest/*`) aren't loaded when analytics is disabled.
  return (
    <Suspense fallback={children}>
      <PostHogClientProvider>{children}</PostHogClientProvider>
    </Suspense>
  );
}
