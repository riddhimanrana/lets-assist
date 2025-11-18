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

export default function BayAreaExamples() {
  return (
    <section className="py-12 sm:py-16">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.5em] text-muted-foreground/70">
            Partner spotlight
          </p>
          <h3 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Currently connecting with
          </h3>
          <p className="max-w-xl text-sm text-muted-foreground">
            These schools and organizations are exploring proof-backed attendance, certificate automation, and
            volunteer ops built for districts, clubs, and nonprofits.
          </p>
        </div>
        <TooltipProvider delayDuration={150}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 sm:gap-6">
            {partners.map((partner) => (
              <Tooltip key={partner.name}>
                <TooltipTrigger asChild>
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ duration: 0.35 }}
                    className="group relative flex h-8 w-24 items-center justify-center px-2"
                  >
                    {partner.logo ? (
                      <Image
                        src={partner.logo}
                        alt={`${partner.name} logo`}
                        width={64}
                        height={24}
                        className="object-contain opacity-70 grayscale transition duration-200 group-hover:opacity-100 group-hover:grayscale-0"
                      />
                    ) : (
                      <span className="text-[0.65rem] font-semibold text-muted-foreground">
                        {partner.name
                          .split(" ")
                          .slice(0, 2)
                          .map((word) => word[0])
                          .join("")}
                      </span>
                    )}
                    <span className="sr-only">{partner.name}</span>
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent className="text-xs" side="top" align="center">
                  <p className="font-semibold text-foreground">{partner.name}</p>
                  <p className="text-muted-foreground">{partner.note}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>
    </section>
  );
}
