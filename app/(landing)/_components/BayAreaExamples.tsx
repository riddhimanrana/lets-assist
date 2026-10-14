import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AnimatedText } from "./AnimatedText";

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
        <div className="mx-auto max-w-3xl text-center">
          <div className="flex items-center justify-center gap-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <span aria-hidden="true" className="h-px w-12 bg-border sm:w-20" />
            Organization
            <span aria-hidden="true" className="h-px w-12 bg-border sm:w-20" />
          </div>
          <h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
            <AnimatedText
              text="Schools, clubs, and community groups"
              mode="words"
            />
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            A look at the communities exploring volunteer projects with
            Let&apos;s Assist.
          </p>
        </div>

        <ul className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {partners.map((partner) => (
            <li key={partner.name} className="border-t pt-5">
              <div className="flex items-center gap-4">
                <span className="relative size-12 shrink-0 overflow-hidden rounded-lg border bg-white">
                  <Image
                    src={partner.logo}
                    alt=""
                    fill
                    sizes="48px"
                    className="object-contain p-1"
                  />
                </span>
                <div>
                  <h3 className="text-base font-semibold">{partner.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {partner.kind}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <Link
          href="/organization"
          className="mx-auto mt-10 flex w-fit items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        >
          Explore organization profiles
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </section>
  );
}
