import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

const DEMO_VIDEO_URL = "https://www.youtube.com/watch?v=0Smto1UOqTY";

export function GetStarted() {
  return (
    <section id="cta" className="bg-background py-16 sm:py-24">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border bg-card p-8 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Looking for volunteer hours?
            </h2>
            <p className="mt-3 max-w-sm text-base leading-7 text-muted-foreground">
              Browse events near you and sign up in a minute. You only need an
              account if you want to keep a record of your hours.
            </p>
            <Link
              href="/projects"
              className={cn(
                buttonVariants({ size: "lg" }),
                "mt-6 h-12 rounded-full px-6 text-base",
              )}
            >
              Find volunteering near me
            </Link>
          </div>
          <div className="rounded-3xl border bg-card p-8 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Running an event or a club?
            </h2>
            <p className="mt-3 max-w-sm text-base leading-7 text-muted-foreground">
              Create a project, share the link, and print the QR code. It is
              free for schools, clubs, and community groups.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/signup"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-12 rounded-full px-6 text-base",
                )}
              >
                Create a free account
              </Link>
              <Link
                href="/contact"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "lg" }),
                  "h-12 rounded-full px-5 text-base",
                )}
              >
                Talk to us
              </Link>
            </div>
          </div>
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Want to see it first?{" "}
          <a
            href={DEMO_VIDEO_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Watch the two-minute demo
          </a>
        </p>
      </div>
    </section>
  );
}
