import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const partners = [
  { name: "DVHigh CSF", logo: "/logos/dvhigh-csf.png", kind: "School club" },
  {
    name: "Dougherty Valley High School",
    logo: "/logos/dvhs.png",
    kind: "School community",
  },
  {
    name: "Windemere Ranch Middle School",
    logo: "/logos/wrms.png",
    kind: "School community",
  },
  { name: "Troop 941", logo: "/logos/troop941.png", kind: "Local troop" },
];

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
                DVHS CSF example
              </span>
            </div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
              A workspace shaped around a school chapter
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground sm:text-base">
              The DVHS CSF plugin shows what organization-specific tools can
              look like: one place for member applications, service-point
              review, meetings, and partner clubs. Those chapter workflows live
              beside the wider volunteering platform.
            </p>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Preview from a synthetic test workspace. The names and records
              shown are fictional.
            </p>
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
            <figcaption className="mt-3 text-xs leading-5 text-muted-foreground">
              Service-point review in the chapter-specific workspace.
            </figcaption>
          </figure>
        </div>

        <div className="mt-16 border-t pt-8">
          <h3 className="text-lg font-semibold">
            Schools, clubs, and community groups
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Communities exploring volunteer projects with Let&apos;s Assist.
          </p>
          <ul className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {partners.map((partner) => (
              <li key={partner.name} className="border-t pt-4">
                <div className="flex items-center gap-3">
                  <span className="relative size-10 shrink-0 overflow-hidden rounded-lg border bg-white">
                    <Image
                      src={partner.logo}
                      alt=""
                      fill
                      sizes="40px"
                      className="object-contain p-1"
                    />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{partner.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {partner.kind}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Link
            href="/organization"
            className="mt-8 flex w-fit items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            Explore organization profiles
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
