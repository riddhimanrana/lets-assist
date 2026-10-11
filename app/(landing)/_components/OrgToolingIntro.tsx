import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BarChart3, FileSpreadsheet, Plug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent } from "@/components/ui/card";

const orgFeatures = [
  {
    icon: FileSpreadsheet,
    title: "Google Sheets + Calendar syncing",
    desc: "Keep member hours, project summaries, volunteer slots, and shared calendar reminders connected to the tools your team already uses.",
    logos: [
      { src: "/resources/google-sheets-logo-2026.png", alt: "Google Sheets" },
      {
        src: "/resources/google-calendar-logo-2026.png",
        alt: "Google Calendar",
      },
    ],
  },
  {
    icon: Plug,
    title: "Custom plugins",
    desc: "Connect membership rules, school workflows, imports, approvals, paid events, and private operational tools.",
  },
  {
    icon: BarChart3,
    title: "Analytics dashboards",
    desc: "See verified hours, member progress, project turnout, exports, and CSF-ready reporting from one dashboard.",
  },
];

const ctaClassName = buttonVariants({
  size: "lg",
  variant: "outline",
  className: "gap-2",
});

// The heading, features and links have no browser dependencies, so they are
// in the first response. `children` is the slot for the client-only demo.
export function OrgToolingIntro({ children }: { children: ReactNode }) {
  return (
    <section id="org-tooling" className="py-16 sm:py-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="text-center mx-auto max-w-3xl">
          <Badge
            variant="outline"
            className="mb-3 border-primary/40 bg-primary/10 text-primary"
          >
            For organizations
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            The workspace SignUpGenius never built
          </h2>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Manage members and roles, verify hours from QR check-ins, issue
            certificates, and export reports from one dashboard. Made for
            schools and nonprofits that have to show their volunteer records to
            someone else.
          </p>
        </div>

        {children}

        <div className="mt-12 space-y-10">
          <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
            {orgFeatures.map((feat) => (
              <Card
                key={feat.title}
                className="h-full border-border/60 bg-background/90 shadow-xs"
              >
                <CardContent className="p-4">
                  {feat.logos ? (
                    <div className="mb-2 flex items-center gap-2">
                      {feat.logos.map((logo) => (
                        <span
                          key={logo.src}
                          className="flex size-9 items-center justify-center rounded-lg border bg-background shadow-xs"
                        >
                          <Image
                            src={logo.src}
                            alt={logo.alt}
                            width={22}
                            height={22}
                            className="size-5 object-contain"
                          />
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mb-2 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                      <feat.icon className="h-4 w-4" />
                    </div>
                  )}
                  <p className="text-sm font-semibold text-foreground">
                    {feat.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    {feat.desc}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
            <Link href="/contact" className={ctaClassName}>
              Contact us for integrations
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/organization" className={ctaClassName}>
              Explore connected organizations
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
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
