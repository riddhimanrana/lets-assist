import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function BayAreaExamples() {
  return (
    <section id="partners" className="border-y bg-muted/20 py-16 sm:py-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <div className="flex items-center gap-3">
              <Image
                src="/logos/dvhigh-csf.png"
                alt=""
                width={48}
                height={48}
                className="size-12 rounded-lg border bg-white object-contain p-1"
              />
              <span className="text-sm font-medium text-muted-foreground">
                DVHS CSF chapter plugin
              </span>
            </div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
              A workspace shaped around a school chapter
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground sm:text-base">
              The DVHS CSF plugin adds chapter-specific member applications,
              service-point review, meeting records, and partner-club work
              beside the wider volunteering platform. Officers review claims
              before points are awarded.
            </p>
            <Link
              href="/organization"
              className="mt-6 flex w-fit items-center gap-2 text-sm font-semibold text-green-700 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary dark:text-primary"
            >
              Explore organization profiles
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <figure className="min-w-0">
            <div
              className="relative overflow-hidden rounded-2xl border bg-background"
              style={{ aspectRatio: "1280 / 1024" }}
            >
              <Image
                src="/images/landing/csf-point-review-preview.png"
                alt="Synthetic DVHS CSF service-point review workspace with member claims awaiting officer review"
                fill
                sizes="(min-width: 1024px) 650px, 100vw"
                className="object-cover object-top"
              />
            </div>
          </figure>
        </div>
      </div>
    </section>
  );
}
