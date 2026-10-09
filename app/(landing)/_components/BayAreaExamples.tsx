import Image from "next/image";
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

export default function BayAreaExamples() {
  return (
    <section id="partners" className="border-y bg-muted/20 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Built for clubs, schools, and community teams
          </h3>
          <p className="max-w-xl font-sans text-sm leading-6 text-muted-foreground">
            Schools and groups running pilots with Let&apos;s Assist.
          </p>
        </div>
        {/* Four partners fit on the page, so they sit in a grid and nothing is clipped. */}
        <TooltipProvider>
          <ul className="mt-8 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {partners.map((partner) => (
              <li key={partner.name}>
                <Tooltip>
                  <TooltipTrigger className="flex h-full w-full items-center gap-3 rounded-xl border bg-background p-3 text-left transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {/* Logos are drawn for a light page, so the plate stays white in both themes. */}
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-white">
                      <Image
                        src={partner.logo}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-contain p-0.5"
                      />
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {partner.name}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    className="max-w-72 text-xs"
                    side="top"
                    align="center"
                  >
                    <p className="font-semibold">{partner.name}</p>
                    <p className="opacity-80">{partner.note}</p>
                  </TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        </TooltipProvider>
      </div>
    </section>
  );
}
