import Image from "next/image";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

import { AwardBadge } from "./AwardBadge";
import { LandingDemo } from "./LandingDemo";
import { Scribble, ScribbleArrow } from "./Scribble";

export function Hero() {
  return (
    <section className="border-b bg-background">
      <div className="container mx-auto px-4 pb-12 pt-10 sm:px-6 md:pb-16 md:pt-16">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div>
            <AwardBadge />
            <h1 className="mt-6 text-balance text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground sm:text-6xl lg:text-[4.25rem]">
              Sign up, show up, get your hours verified.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              Let&apos;s Assist is a free way for schools, clubs, and community
              groups to run volunteer events. Volunteers check in with a QR
              code, and every hour lands on a record that anyone can verify.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/projects"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-12 rounded-full px-6 text-base",
                )}
              >
                Find volunteering near me
              </Link>
              <Link
                href="/signup"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-12 rounded-full px-6 text-base",
                )}
              >
                Run a volunteer event
              </Link>
            </div>
          </div>

          <figure className="relative m-0">
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-muted">
              <Image
                src="/images/landing/food-bank.jpg"
                alt="Students and adults sorting donated food into boxes while a coordinator with a clipboard talks to two volunteers"
                fill
                priority
                sizes="(min-width: 1024px) 560px, 100vw"
                className="object-cover"
              />
            </div>
            <figcaption className="mt-3 flex items-start justify-end gap-2 pr-2">
              <Scribble className="-rotate-2 pt-4">
                no more paper hour logs
              </Scribble>
              <ScribbleArrow className="-scale-x-100" />
            </figcaption>
          </figure>
        </div>

        <div className="mt-12 md:mt-16">
          <LandingDemo />
        </div>
      </div>
    </section>
  );
}
