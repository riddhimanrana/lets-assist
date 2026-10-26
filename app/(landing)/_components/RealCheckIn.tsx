import Image from "next/image";

export function RealCheckIn() {
  return (
    <section id="check-in" className="border-y bg-muted/20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            From signup to check-in
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            Collect waivers and track attendance in one place.
          </p>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-12">
          <article className="min-w-0 border-t pt-5">
            <h3 className="text-xl font-semibold">Waivers at signup</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Add your waiver. Volunteers sign online or upload a signed copy.
            </p>
            <figure className="mt-6">
              <div
                className="relative overflow-hidden rounded-2xl border bg-background"
                style={{ aspectRatio: "720 / 680" }}
              >
                <Image
                  src="/images/landing/waiver-settings-preview.png"
                  alt="Let's Assist project setup showing a required waiver, an uploaded PDF, and e-signature settings"
                  fill
                  sizes="(min-width: 1024px) 540px, 100vw"
                  className="object-cover object-top"
                />
              </div>
            </figure>
          </article>

          <article className="min-w-0 border-t pt-5">
            <h3 className="text-xl font-semibold">Scan. Check in. Done.</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Volunteers scan a QR code to check in and out. Review attendance
              before publishing hours.
            </p>
            <figure className="mt-6">
              <div className="relative aspect-[985/640] overflow-hidden rounded-2xl border bg-muted">
                <Image
                  src="/images/landing/qr-scan-event.jpg"
                  alt="A volunteer outdoors scanning a printed event QR code"
                  fill
                  sizes="(min-width: 1024px) 540px, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div
                  className="relative overflow-hidden rounded-xl border bg-muted"
                  style={{ aspectRatio: "347 / 275" }}
                >
                  <Image
                    src="/images/landing/qr-scan-phone.jpg"
                    alt="Phone camera pointed at an event code"
                    fill
                    sizes="(min-width: 1024px) 260px, 50vw"
                    className="object-cover object-top"
                  />
                </div>
                <div
                  className="relative overflow-hidden rounded-xl border bg-muted"
                  style={{ aspectRatio: "320 / 275" }}
                >
                  <Image
                    src="/images/landing/qr-check-in-success.jpg"
                    alt="Successful check-in screen with the event and recorded time"
                    fill
                    sizes="(min-width: 1024px) 260px, 50vw"
                    className="object-cover object-top"
                  />
                </div>
              </div>
              <figcaption className="mt-3 text-xs leading-5 text-muted-foreground">
                Frames from the Let&apos;s Assist check-in demo.
              </figcaption>
            </figure>
          </article>
        </div>
      </div>
    </section>
  );
}
