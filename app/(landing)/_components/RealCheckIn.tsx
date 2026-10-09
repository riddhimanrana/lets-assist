import Image from "next/image";

import { Scribble, ScribbleArrow } from "./Scribble";

export function RealCheckIn() {
  return (
    <section id="check-in" className="border-y bg-muted/20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            This is what check-in looks like
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            The organizer prints one page. Volunteers point their phone camera
            at it, and the time they arrived is saved to the event. These frames
            are from our own demo recording.
          </p>
        </div>

        <div className="mt-10 grid items-end gap-6 md:grid-cols-[1.9fr_0.8fr_0.8fr]">
          <figure className="m-0">
            <div className="relative aspect-[985/640] overflow-hidden rounded-2xl border bg-muted">
              <Image
                src="/images/landing/qr-scan-event.jpg"
                alt="A volunteer outdoors holding a phone over a printed QR code sheet"
                fill
                sizes="(min-width: 768px) 620px, 100vw"
                className="object-cover"
              />
            </div>
            <figcaption className="mt-3 flex items-start gap-2">
              <ScribbleArrow className="-scale-y-100 rotate-180" />
              <Scribble className="-rotate-2 pt-3">
                scan the printed code
              </Scribble>
            </figcaption>
          </figure>

          <figure className="m-0">
            <div className="relative aspect-[347/475] overflow-hidden rounded-2xl border bg-muted">
              <Image
                src="/images/landing/qr-scan-phone.jpg"
                alt="Phone camera view of a printed Let's Assist QR code for a beach cleanup session"
                fill
                sizes="(min-width: 768px) 260px, 100vw"
                className="object-cover"
              />
            </div>
            <figcaption className="mt-3 text-sm text-muted-foreground">
              Each session gets its own code.
            </figcaption>
          </figure>

          <figure className="m-0">
            <div className="relative aspect-[320/395] overflow-hidden rounded-2xl border bg-muted">
              <Image
                src="/images/landing/qr-check-in-success.jpg"
                alt="Let's Assist check-in successful screen showing the project, session, date, and check-in time"
                fill
                sizes="(min-width: 768px) 260px, 100vw"
                className="object-cover object-top"
              />
            </div>
            <figcaption className="mt-3 text-sm text-muted-foreground">
              The check-in time is recorded right away.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
