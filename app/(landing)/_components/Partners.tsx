import Image from "next/image";

const partners = [
  {
    name: "DVHS California Scholarship Federation",
    logo: "/logos/dvhigh-csf.png",
  },
  { name: "Dougherty Valley High School", logo: "/logos/dvhs.png" },
  { name: "Windemere Ranch Middle School", logo: "/logos/wrms.png" },
  { name: "Troop 941", logo: "/logos/troop941.png" },
];

export function Partners() {
  return (
    <section id="partners" className="border-b bg-muted/30 py-10">
      <div className="container mx-auto flex flex-col items-center gap-6 px-4 sm:px-6 md:flex-row md:justify-center md:gap-10">
        <p className="m-0 max-w-[16rem] text-center text-sm leading-6 text-muted-foreground md:text-left">
          Schools and groups running pilots with Let&apos;s Assist
        </p>
        <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-x-10 gap-y-4 p-0">
          {partners.map((partner) => (
            <li key={partner.name} className="relative h-12 w-24">
              <Image
                src={partner.logo}
                alt={partner.name}
                fill
                sizes="96px"
                className="object-contain"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
