"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const partners = [
  {
    name: "DVHigh CSF",
    logo: "/logos/dvhigh-csf.png",
    note: "CSF volunteer-hour workflows for DVHS students, advisors, and activity coordinators",
  },
  {
    name: "Dougherty Valley High School",
    logo: "/logos/dvhs.png",
    note: "Working toward full SRVUSD district verification while engaging multiple teachers for pilots",
  },
  {
    name: "Windemere Ranch Middle School",
    logo: "/logos/wrms.png",
    note: "Two teachers running a small volunteer test group; district verification pending",
  },
  {
    name: "Troop 941",
    logo: "/logos/troop941.png",
    note: "Migrating upcoming events/projects onto the platform",
  },
];

const cloudItems = [...partners, ...partners];

export default function BayAreaExamples() {
  return (
    <section id="partners" className="border-y bg-muted/20 py-12 sm:py-16">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Built for clubs, schools, and community teams
          </h3>
          <p className="max-w-xl font-sans text-sm leading-6 text-muted-foreground">
            These schools and organizations are exploring proof-backed
            attendance, certificate automation, and volunteer ops built for
            districts, clubs, and nonprofits.
          </p>
        </div>
        <TooltipProvider>
          <div className="relative mx-auto mt-8 max-w-4xl overflow-hidden">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-linear-to-r from-muted/20 to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l from-muted/20 to-transparent" />
            <motion.div
              className="flex w-max items-center gap-4"
              animate={{ x: ["0%", "-50%"] }}
              transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
            >
              {cloudItems.map((partner, index) => (
                <Tooltip key={`${partner.name}-${index}`}>
                  <TooltipTrigger>
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ duration: 0.35 }}
                    className="group relative flex h-16 w-44 shrink-0 items-center justify-center rounded-2xl border bg-background/75 px-5 shadow-xs backdrop-blur transition-colors hover:border-primary/30"
                  >
                    {partner.logo ? (
                      <Image
                        src={partner.logo}
                        alt={`${partner.name} logo`}
                        fill
                        sizes="128px"
                        className="object-contain p-3 opacity-65 grayscale transition duration-200 group-hover:opacity-100 group-hover:grayscale-0"
                      />
                    ) : (
                      <span className="text-[0.65rem] font-semibold text-muted-foreground">
                        {partner.name}
                      </span>
                    )}
                    <span className="sr-only">{partner.name}</span>
                  </motion.div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72 text-xs" side="top" align="center">
                    <p className="font-semibold">{partner.name}</p>
                    <p className="opacity-80">{partner.note}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </motion.div>
          </div>
        </TooltipProvider>
      </div>
    </section>
  );
}
