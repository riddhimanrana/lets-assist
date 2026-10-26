"use client";

import Image from "next/image";
import { Quote } from "lucide-react";
import type { KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

// The gap between cards: `gap-4` on the row.
const CARD_GAP = 16;
// One 330px card plus the gap. Used when the first card cannot be measured.
const FALLBACK_ARROW_SCROLL_STEP = 346;

// A card is narrower than 330px on a phone, so the step is read from the first
// card. Each arrow press then brings in one quote at any width.
function arrowScrollStep(row: HTMLDivElement) {
  const card =
    typeof row.querySelector === "function"
      ? row.querySelector("article")
      : null;
  const width = card?.getBoundingClientRect().width;
  return typeof width === "number" && Number.isFinite(width) && width > 0
    ? width + CARD_GAP
    : FALLBACK_ARROW_SCROLL_STEP;
}

// Arrow keys do not reliably scroll a focused overflow row on their own, so
// the row handles them. The scroll is instant: it does not wait on animation
// frames, and the browser clamps the position at either end. Keys aimed at
// something inside the row, and key combinations, are left alone.
function scrollRowFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
  if (event.target !== event.currentTarget) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  const row = event.currentTarget;
  let left: number;
  switch (event.key) {
    case "ArrowLeft":
      left = row.scrollLeft - arrowScrollStep(row);
      break;
    case "ArrowRight":
      left = row.scrollLeft + arrowScrollStep(row);
      break;
    case "Home":
      left = 0;
      break;
    case "End":
      left = row.scrollWidth;
      break;
    default:
      return;
  }

  event.preventDefault();
  row.scrollTo({ left, behavior: "instant" });
}

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
    quote: "Let's Assist looks like a very promising system!",
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
    quote: "I have heard positive remarks regarding your system.",
    name: "Tim Jorgenson",
    role: "Grand Knight, Knights of Columbus Council 6043",
    src: "/logos/kofc-6043.jpg",
  },
  {
    quote:
      "It was very impressive and I look forward to trying it out to streamline our processes.",
    name: "Ava Ahuja",
    role: "Cub Scouts & PTA demo feedback",
    src: "/logo.png",
  },
  {
    quote:
      "Yes, they seem enthusiastic about the new platform! We're thinking we will try it out at the start of next school year.",
    name: "Stephanie Smith SooHoo",
    role: "Quail Run Elementary PTA, after a board discussion",
    src: "/logo.png",
  },
  {
    quote: "Thanks for the opportunity to pilot the platform!",
    name: "Alicia Gholami",
    role: "SRVCPTA pilot feedback",
    src: "/logo.png",
  },
  {
    quote:
      "I had a quick look at the Eagle project and the website, and it seems quite useful.",
    name: "Divya Jonnavittula",
    role: "Community demo feedback",
    src: "/logo.png",
  },
  {
    quote:
      "We're willing to try out your website at our next volunteering event this upcoming Friday.",
    name: "Hearts4Hands",
    role: "Dougherty Valley High School club, before an event trial",
    src: "/logos/dvhs.png",
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
    // 330px wide, or narrower on a phone: the viewport less the 32px of page
    // padding, the 16px gap and a strip of the next card. The strip is up to
    // 48px with no scrollbar gutter, and 33px beside a 15px classic gutter,
    // which is enough to show part of the next card's quote mark.
    <article
      className={cn(
        "w-[min(330px,calc(100vw_-_96px))] shrink-0 rounded-3xl border border-foreground/10 bg-card/95 p-5 shadow-xs backdrop-blur",
        className,
      )}
    >
      <Quote aria-hidden="true" className="mb-5 size-5 text-primary" />
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
  return (
    <section
      id="testimonials"
      className="relative overflow-hidden border-y border-foreground/10 bg-background py-14 sm:py-20"
    >
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="mx-auto mb-9 max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            What our community is saying
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Feedback from teachers, advisors, PTAs and local groups after demos
            and during early pilots.
          </p>
        </div>

        {/*
          The row scrolls by hand for everyone. It used to drift on its own,
          which moved quotes away mid-sentence and left keyboard users no way
          to reach the ones off screen. The row takes focus so the arrow keys
          scroll it, and it renders the same with or without a motion
          preference. The landing smooth-scroll layer is told to leave
          sideways wheel gestures to the row.
        */}
        <div
          role="region"
          aria-label="Feedback from teachers, advisors and community groups"
          tabIndex={0}
          onKeyDown={scrollRowFromKeyboard}
          data-lenis-prevent-horizontal
          className="relative overflow-x-auto rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex w-max gap-4 py-1">
            {testimonials.map((testimonial) => (
              <TestimonialCard
                key={testimonial.name}
                testimonial={testimonial}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
