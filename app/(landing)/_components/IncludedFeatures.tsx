import Image from "next/image";

const photoFeatures = [
  {
    title: "Paper sign-in sheets",
    body: "Not everyone has a phone out. Take a photo of the sheet, review the rows Let's Assist reads from it, and save them as attendance.",
    image: "/images/landing/paper-sign-in.jpg",
    alt: "Hands photographing a handwritten sign-in sheet on a clipboard",
  },
  {
    title: "Waivers and forms",
    body: "Ask for a signed waiver or extra questions at sign-up. Signatures are stored with the signup, so they are there on event day.",
    image: "/images/landing/waiver.jpg",
    alt: "A parent signing on a phone that a teenager holds across a kitchen table",
  },
];

const moreFeatures = [
  {
    title: "Certificates anyone can check",
    body: "Each certificate has its own public page, so a school or scholarship committee can confirm it is real.",
  },
  {
    title: "All your hours in one place",
    body: "Verified and self-reported hours sit on one dashboard that you can export.",
  },
  {
    title: "Google Calendar and Sheets",
    body: "Volunteers add shifts to their calendar. Organizers sync rosters to a sheet.",
  },
  {
    title: "Reports for advisors",
    body: "See each member's hours by date range and export them for your records.",
  },
];

export function IncludedFeatures() {
  return (
    <section id="features" className="border-y bg-muted/30 py-16 sm:py-24">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Built for how events really run
        </h2>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {photoFeatures.map((feature) => (
            <article
              key={feature.title}
              className="overflow-hidden rounded-3xl border bg-card"
            >
              <div className="relative aspect-[16/9] bg-muted">
                <Image
                  src={feature.image}
                  alt={feature.alt}
                  fill
                  sizes="(min-width: 768px) 560px, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="p-6 sm:p-8">
                <h3 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  {feature.title}
                </h3>
                <p className="mt-2 text-base leading-7 text-muted-foreground">
                  {feature.body}
                </p>
              </div>
            </article>
          ))}
        </div>

        <dl className="m-0 mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {moreFeatures.map((feature) => (
            <div
              key={feature.title}
              className="border-t border-foreground/15 pt-4"
            >
              <dt className="text-base font-semibold text-foreground">
                {feature.title}
              </dt>
              <dd className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                {feature.body}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
