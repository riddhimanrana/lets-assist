"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
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
    <main className="min-h-screen bg-background py-16 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="space-y-3 text-center">
          <p className="text-xs uppercase tracking-[0.5em] text-muted-foreground">
            Frequently asked questions
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">
            Everything you want to know about Let’s Assist
          </h1>
          <p className="mx-auto max-w-3xl text-sm sm:text-base text-muted-foreground">
            Read through the most common questions about how we support volunteers,
            why organizations switch from SignupGenius, and what’s next after you sign up.
          </p>
        </div>

        <section className="rounded-3xl border border-border/60 bg-card/80 p-6 shadow-lg shadow-foreground/5">
          <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
            {faqs.map((faq, index) => (
              <AccordionItem key={faq.question} value={`item-${index + 1}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent className="flex flex-col gap-4 text-sm text-muted-foreground">
                  {faq.answer.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        <div className="rounded-2xl border border-border/60 bg-primary/10 p-6 text-center">
          <p className="text-sm font-medium text-primary">Still need a demo?</p>
          <p className="text-sm text-muted-foreground">
            Chat with us or request trusted member access to pilot Let’s Assist with your team.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link href="/trusted-member">
              <Button variant="ghost">Request trusted access</Button>
            </Link>
            <Link href="/contact">
              <Button>Contact support</Button>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
