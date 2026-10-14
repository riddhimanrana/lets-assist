import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { AnimatedText } from "./AnimatedText";

const orgFeatures = [
  {
    title: "Slots and one link",
    desc: "Set up the shifts, limit the spots in each one, and share a single sign-up page with your group.",
  },
  {
    title: "Check-in at the door",
    desc: "Volunteers scan the session's QR code when they arrive, so attendance stays with the event.",
  },
  {
    title: "Hours in one place",
    desc: "Review attendance, verify service hours, and export a record when your group needs it.",
  },
];

const createHref = "/signup?redirect=%2Fprojects%2Fcreate";

// The heading, features and links have no browser dependencies, so they are
// in the first response. `children` is the slot for the client-only demo.
export function OrgToolingIntro({ children }: { children: ReactNode }) {
  return (
    <section id="org-tooling" className="py-16 sm:py-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 flex items-center justify-center gap-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <span aria-hidden="true" className="h-px w-12 bg-border sm:w-20" />
            Organization
            <span aria-hidden="true" className="h-px w-12 bg-border sm:w-20" />
          </div>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            <AnimatedText
              text="Run the whole project from one place"
              mode="words"
            />
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            From the sign-up page to the hours report, keep the details your
            volunteers and organizers need in one workspace.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-2xl text-center">
          <Badge
            variant="outline"
            className="border-primary/40 bg-primary/10 text-primary"
          >
            Interactive example · Sample organization
          </Badge>
        </div>
        {children}

        <div className="mt-12 grid gap-0 border-y md:grid-cols-3">
          {orgFeatures.map((feature, index) => (
            <div
              key={feature.title}
              className="flex gap-4 border-b py-6 last:border-b-0 md:border-b-0 md:border-r md:px-6 md:first:pl-0 md:last:border-r-0 md:last:pr-0"
            >
              <span
                aria-hidden="true"
                className="text-sm font-semibold tabular-nums text-primary"
              >
                0{index + 1}
              </span>
              <div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {feature.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>Works with</span>
            <Image
              src="/resources/google-sheets-logo-2026.png"
              alt="Google Sheets"
              width={24}
              height={24}
              className="size-6 object-contain"
            />
            <Image
              src="/resources/google-calendar-logo-2026.png"
              alt="Google Calendar"
              width={24}
              height={24}
              className="size-6 object-contain"
            />
            <span>Sheets and Calendar</span>
          </div>
          <Link
            href={createHref}
            className={buttonVariants({
              size: "lg",
              className: "w-full gap-2 sm:w-auto",
            })}
          >
            Create a project{" "}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// Stands in for the interactive demo until its chunk loads, and for good when
// JavaScript is off. It is sized by its content, so the demo that replaces it
// is taller and moves the sections below it.
export function OrgToolingDemoFallback() {
  return (
    <div className="mx-auto mt-12 w-full max-w-2xl rounded-2xl border border-dashed bg-card p-4 text-center sm:p-6">
      <p className="text-sm font-semibold text-foreground">
        Interactive organization demo
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        The demo runs in your browser and needs JavaScript.
      </p>
    </div>
  );
}
