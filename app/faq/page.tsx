"use client";

import Link from "next/link";
import { MessageCircleIcon } from "@/components/icons/animated";
import { AnimatedLinkButton } from "@/components/projects/AnimatedLinkButton";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "What is Let’s Assist?",
    answer: [
      "Let’s Assist is a volunteer management platform built for high schools, families, and local nonprofits. We help volunteers discover events, verify their attendance with QR check‑ins, and automatically publish certificates and hour reports once work is validated.",
      "We pair modern volunteer tools with district-friendly safeguards (like parental consent flows and audit-ready exports) so students and organizations can focus on impact instead of spreadsheets.",
    ],
  },
  {
    question: "How is this different from SignupGenius?",
    answer: [
      "SignupGenius is great for scheduling, but Let’s Assist layers in attendance verification, QR-based check-in/out, and auto-published certificates for verified hours. That means approvals, proof, and reporting happen without manual work.",
      "Organizations get role-based access, activity exports, and certificate automation out of the box, while volunteers instantly see verified hours, certificates, and progress toward requirements like CSF.",
    ],
  },
  {
    question: "Can I use Let’s Assist for school service requirements?",
    answer: [
      "Yes. Let’s Assist tracks verified and self-reported hours, syncs with personal calendars, and surfaces automated certificates that map directly to graduation or CSF goals.",
      "Teachers and admins can set cadence alerts, attach supervisor approvals, and export compliance-ready reports for every student in seconds.",
    ],
  },
  {
    question: "How do organizations get started?",
    answer: [
      "Apply for trusted member access, invite team members with six-digit join codes, and publish projects that support one-time, multi-day, or same-day multi-area events.",
      "Once events run, supervisors verify check-ins via QR scans, and certificates auto-publish 48–72 hours later — no extra spreadsheets needed.",
    ],
  },
  {
    question: "What should I do if I still have questions?",
    answer: [
      "Send feedback right from the navbar or drop us a note through the support link at the bottom of any page.",
      "You can also request a demo or pilot directly from `/contact` if you want a guided walkthrough for your campus or nonprofit.",
    ],
  },
];

export default function FAQPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Frequently asked questions
        </h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Read through the most common questions about how we support
          volunteers, why organizations switch from SignupGenius, and what’s
          next after you sign up.
        </p>
      </header>

      <Accordion className="mt-8 w-full" defaultValue={["item-1"]}>
        {faqs.map((faq, index) => (
          <AccordionItem key={faq.question} value={`item-${index + 1}`}>
            <AccordionTrigger className="py-4 text-base">
              {faq.question}
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground flex max-w-prose flex-col gap-3 text-sm leading-6">
              {faq.answer.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <section className="mt-10 flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <h2 className="font-medium">Still need a demo?</h2>
          <p className="text-muted-foreground text-sm">
            Chat with us or request trusted member access to pilot Let’s Assist
            with your team.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Link
            href="/trusted-member"
            className={buttonVariants({ variant: "outline" })}
          >
            Request trusted access
          </Link>
          <AnimatedLinkButton href="/contact" icon={MessageCircleIcon}>
            Contact support
          </AnimatedLinkButton>
        </div>
      </section>
    </main>
  );
}
