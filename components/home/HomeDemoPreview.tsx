"use client";

import { useState } from "react";

import { SectionHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  SegmentedControl,
  SegmentedItem,
} from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";

import {
  ProjectFeedEmpty,
  type ProjectFeedEmptyState,
} from "./ProjectFeedEmpty";

type PreviewState = ProjectFeedEmptyState | "loading";

const PREVIEW_STATES: ReadonlyArray<{ value: PreviewState; label: string }> = [
  { value: "empty", label: "Empty" },
  { value: "filtered", label: "Filtered" },
  { value: "restricted", label: "Restricted" },
  { value: "error", label: "Error" },
  { value: "loading", label: "Loading" },
];

function FeedLoadingPreview() {
  return (
    <div
      role="status"
      aria-label="Loading projects"
      className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4"
    >
      {["first", "second", "third"].map((slot) => (
        <Card key={slot} aria-hidden="true">
          <CardHeader>
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 shrink-0 rounded-lg" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-9 w-36" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * A local switcher for the feed's empty, filtered, restricted, error, and
 * loading looks. It holds one piece of React state and requests nothing.
 */
export function HomeDemoPreview() {
  const [state, setState] = useState<PreviewState>("empty");

  return (
    <section data-slot="home-demo-preview" className="grid min-w-0 gap-3">
      <SectionHeader
        title="Feed states"
        description="Switch between the looks the project feed can take. This selector is local to the preview and loads nothing."
      />
      <SegmentedControl role="group" aria-label="Feed state to preview">
        {PREVIEW_STATES.map(({ value, label }) => (
          <SegmentedItem
            key={value}
            active={state === value}
            aria-pressed={state === value}
            onClick={() => setState(value)}
          >
            {label}
          </SegmentedItem>
        ))}
      </SegmentedControl>
      {state === "loading" ? (
        <FeedLoadingPreview />
      ) : (
        <ProjectFeedEmpty
          className="p-6 sm:p-12"
          state={state}
          onClear={() => setState("empty")}
          onRetry={() => setState("loading")}
        />
      )}
    </section>
  );
}
