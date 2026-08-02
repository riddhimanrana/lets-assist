"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { Quote } from "lucide-react";

import { cn } from "@/lib/utils";
import { AnimatedText } from "./AnimatedText";

const testimonials = [
  {
    quote:
      "I am interested in learning more about your portal for tracking volunteers for the Speech and Debate program.",
    name: "Minu Basu",
    role: "DV Speech & Debate Advisor",
    src: "/logos/dvhs.png",
  },
  {
    quote:
      "I will definitely use this platform for a unit design at the end of the year. Kudos to you for seeing the niche to fill and doing a smart job of it. It's impressive.",
    name: "John Hanavan",
    role: "DV English 11 Teacher",
    src: "/logos/dvhs.png",
  },
  {
    quote:
      "Let's Assist looks like a very promising system!",
    name: "Jill Nonn",
    role: "DV Vice Principal",
    src: "/logos/dvhs.png",
  },
  {
    quote:
      "In reviewing the demo video and mock-up the app seems to have so much to offer in one location. Well, done!",
    name: "Rene Matsumoto",
    role: "DV Interact Advisor",
    src: "/logos/dvhs.png",
  },
  {
    quote:
      "I would love to use something like this for DV Robotics & Science Fair but if you could get SRVUSD approval that would really solidify it.",
    name: "Andy Su",
    role: "DV Robotics & Science Fair Advisor",
    src: "/logos/dvhs.png",
  },
  {
    quote:
      "That's amazing! I checked out the website. Very professional. If we share it with students, I think it needs to be FERPA-Compliant.",
    name: "Jenny Erickson",
    role: "DVHS community educator",
    src: "/logos/dvhs.png",
  },
  {
    quote:
      "I have heard positive remarks regarding your system.",
    name: "Tim Jorgenson",
    role: "Grand Knight, Knights of Columbus Council 6043",
    src: "/logos/kofc-6043.jpg",
  },
  {
    quote:
      "+ many more from SRVUSD and local service organizations, including SRVCPTA Council, SRV Run for Education, SR Rotary Club, KoC Pleasanton, multiple DVHS, EHS, and SRVHS clubs, and 20+ other DV teachers.",
    name: "More community voices",
    role: "Schools, clubs, councils, and service groups",
    src: "/logo.png",
  },
];

function TestimonialCard({
  testimonial,
  className,
}: {
  testimonial: (typeof testimonials)[number];
  className?: string;
}) {
  return (
    <article
      className={cn(
        "w-[330px] shrink-0 rounded-3xl border border-foreground/10 bg-card/95 p-5 shadow-xs backdrop-blur",
        className,
      )}
    >
      <Quote className="mb-5 size-5 text-primary" />
      <p className="font-sans text-sm leading-7 text-foreground/82">
        {testimonial.quote}
      </p>
      <div className="mt-6 flex items-center gap-3">
        <div className="relative size-10 overflow-hidden rounded-full border border-border bg-background">
          <Image
            src={testimonial.src}
            alt=""
            fill
            sizes="40px"
            className="object-contain p-1.5"
          />
        </div>
        <div>
          <p className="[font-family:var(--font-geist-sans)] text-sm font-semibold">
            {testimonial.name}
          </p>
          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
            {testimonial.role}
          </p>
        </div>
      </div>
    </article>
  );
}

export default function TestimonialsSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="relative overflow-hidden border-y border-foreground/10 bg-background py-14 sm:py-20">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_68%)]"
      />
      <div className="container relative mx-auto px-4 sm:px-6">
        <div className="mx-auto mb-9 max-w-3xl text-center">
          <p className="[font-family:var(--font-geist-sans)] text-xs font-medium uppercase tracking-[0.28em] text-primary">
            Testimonials from demos
          </p>
          <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
            <AnimatedText text="Trusted by the people leading service." mode="words" />
          </h2>
          <p className="mx-auto mt-4 max-w-2xl font-sans text-base leading-8 text-muted-foreground">
            Feedback from DVHS educators, SRVUSD community demos, and local
            service organizations already evaluating Lets Assist.
          </p>
        </div>

        <div className="relative mx-auto max-w-6xl overflow-hidden">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-linear-to-r from-background to-transparent sm:w-20" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-linear-to-l from-background to-transparent sm:w-20" />

          <motion.div
            className="flex w-max gap-4 py-1"
            animate={shouldReduceMotion ? undefined : { x: ["0%", "-42%", "0%"] }}
            transition={{
              duration: 58,
              ease: "linear",
              repeat: Infinity,
            }}
          >
            {testimonials.map((testimonial) => (
              <TestimonialCard
                key={testimonial.name}
                testimonial={testimonial}
              />
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
