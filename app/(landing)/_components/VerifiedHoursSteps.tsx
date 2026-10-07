import Image from "next/image";

import { cn } from "@/lib/utils";

const steps = [
  {
    title: "Sign up from one link",
    body: "An organizer shares a project link. You pick a shift, with or without an account, and it goes on your calendar.",
    image: "/images/landing/students-sign-up.jpg",
    alt: "Three students at a hallway bulletin board, one signing up for a volunteer shift on a phone",
  },
  {
    title: "Check in when you arrive",
    body: "Scan the QR code at the event. Your start and end times are recorded for you, so nobody has to remember them later.",
    image: "/images/landing/qr-check-in.jpg",
    alt: "A volunteer scanning a printed QR code on a table at a park cleanup",
  },
  {
    title: "The organizer verifies your hours",
    body: "After the event the organizer confirms who attended and publishes the hours. You get a certificate with a link your school can check.",
    image: "/images/landing/certificate-review.jpg",
    alt: "A student handing a printed volunteer certificate to a club advisor at a desk",
  },
];

export function VerifiedHoursSteps() {
  return (
    <section id="how-it-works" className="bg-background py-16 sm:py-24">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
            How your hours get verified
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg">
            A volunteer hour only counts if someone can confirm it happened.
            Let&apos;s Assist ties each hour to an event, a check-in, and the
            organizer who approved it.
          </p>
        </div>

        <ol className="m-0 mt-12 flex list-none flex-col gap-14 p-0 sm:mt-16 sm:gap-20">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="grid items-center gap-6 md:grid-cols-2 md:gap-14"
            >
              <div
                className={cn(
                  "relative aspect-[3/2] overflow-hidden rounded-3xl bg-muted",
                  index % 2 === 1 && "md:order-2",
                )}
              >
                <Image
                  src={step.image}
                  alt={step.alt}
                  fill
                  sizes="(min-width: 768px) 540px, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="flex gap-5">
                <span
                  aria-hidden
                  className="font-cheese-milky text-6xl leading-none text-primary sm:text-7xl"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                    {step.title}
                  </h3>
                  <p className="mt-3 max-w-md text-base leading-7 text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
