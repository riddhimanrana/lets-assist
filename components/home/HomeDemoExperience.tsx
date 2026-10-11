"use client";

import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";

import { prefersReducedMotion } from "@/components/icons/animated/use-animated-icon";
import { SectionHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { HomeDemoProjects } from "./HomeDemoProjects";
import { HomeGreeting } from "./HomeGreeting";
import {
  HOME_DEMO_COUNTERS,
  HOME_DEMO_NOTICE,
  HOME_DEMO_SAMPLE_PROFILE,
  HOME_DEMO_TICK_MS,
  HOME_DEMO_MAX_TICK,
  demoCounterValue,
  formatDemoCount,
  shouldRunDemoCounters,
} from "./home-demo-data";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Sample numbers that tick up every few seconds. The server and the first
 * client render show the same starting values. The numbers swap in place with
 * no animation and no live region, pause while the tab is hidden, and stay at
 * their starting values for reduced-motion visitors.
 */
function HomeDemoCounters() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia(REDUCED_MOTION_QUERY)
        : null;
    let timer: number | undefined;
    let currentTick = 0;

    const sync = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      if (
        currentTick >= HOME_DEMO_MAX_TICK ||
        !shouldRunDemoCounters({
          hidden: document.hidden,
          reducedMotion: prefersReducedMotion(),
        })
      )
        return;
      timer = window.setInterval(() => {
        currentTick++;
        setTick(currentTick);
        if (currentTick >= HOME_DEMO_MAX_TICK && timer !== undefined) {
          window.clearInterval(timer);
          timer = undefined;
        }
      }, HOME_DEMO_TICK_MS);
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    media?.addEventListener?.("change", sync);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      media?.removeEventListener?.("change", sync);
    };
  }, []);

  return (
    <StatStrip
      items={HOME_DEMO_COUNTERS.map((counter) => ({
        label: (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {counter.label}
            <Badge variant="neutral">Demo</Badge>
          </span>
        ),
        value: (
          <span data-demo-counter={counter.id}>
            {formatDemoCount(demoCounterValue(counter, tick))}
          </span>
        ),
        helper: counter.helper,
      }))}
    />
  );
}

/**
 * The fictional home demo: a permanent notice, sample counters, and sample
 * projects. It reads no data and links nowhere. Render it only when the
 * server has checked `isHomeDemoEnabled`.
 *
 * `showGreeting` adds its own greeting heading for places with no page header.
 * `sampleProfile` is for the preview route only: it greets the made-up sample
 * person and labels them as such, ignoring `name`.
 */
export function HomeDemoExperience({
  name,
  showGreeting = true,
  sampleProfile = false,
  now,
  timeZone,
  className,
}: {
  name?: string | null;
  showGreeting?: boolean;
  sampleProfile?: boolean;
  now?: Date | number;
  timeZone?: string;
  className?: string;
}) {
  return (
    <section
      data-slot="home-demo"
      aria-label="Demo with fictional content"
      className={cn("grid min-w-0 gap-6", className)}
    >
      {showGreeting ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-lg font-semibold tracking-tight break-words">
            <HomeGreeting
              name={sampleProfile ? HOME_DEMO_SAMPLE_PROFILE.name : name}
              now={now}
              timeZone={timeZone}
            />
          </h2>
          {sampleProfile ? (
            <Badge variant="outline">{HOME_DEMO_SAMPLE_PROFILE.label}</Badge>
          ) : null}
        </div>
      ) : null}

      <Alert variant="info" role="note" data-demo-notice="permanent">
        <FlaskConical aria-hidden="true" />
        <AlertTitle>{HOME_DEMO_NOTICE.title}</AlertTitle>
        <AlertDescription>{HOME_DEMO_NOTICE.description}</AlertDescription>
      </Alert>

      <div className="grid gap-3">
        <SectionHeader
          title="Sample community numbers"
          description="Made-up numbers that tick up every few seconds. They do not count real people or projects."
        />
        <HomeDemoCounters />
      </div>

      <div className="grid gap-3">
        <SectionHeader
          title="Sample projects"
          description="Six fictional examples from around the US. Preview one to see what a listing could include."
        />
        <HomeDemoProjects />
      </div>
    </section>
  );
}
