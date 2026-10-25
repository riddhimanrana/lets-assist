import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";

const orgFeatures = [
  {
    title: "Share one signup",
    desc: "Set session times and capacity, then send volunteers one project page.",
  },
  {
    title: "Record attendance",
    desc: "Use QR check-in and check-out, or scan a handwritten roster for staff review afterward.",
  },
  {
    title: "Verify the hours",
    desc: "Attribute attendance to volunteers, review the hours, and publish verified service records.",
  },
  {
    title: "Use your connections",
    desc: "Volunteers can connect Google Calendar; the CSF chapter plugin supports reviewed Google Sheets imports.",
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
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            One workspace for your team
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Signups, QR or reviewed paper attendance, attributed hours, and
            certificates stay together. Organization plugins can add workflows
            specific to your group.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-2xl text-center">
          <Badge
            variant="outline"
            className="border-primary/40 bg-primary/10 text-primary"
          >
            Fictional organization demo
          </Badge>
        </div>
        {children}

        <div className="mt-12 grid gap-x-8 border-y sm:grid-cols-2 lg:grid-cols-4">
          {orgFeatures.map((feature) => (
            <div
              key={feature.title}
              className="border-b py-6 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-b-0"
            >
              <h3 className="text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>Where connected</span>
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
            <span>Sheets imports · Calendar sync</span>
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
