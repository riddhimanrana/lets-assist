"use client";

import Link from "next/link";
import { MessageCircleIcon } from "@/components/icons/animated";
import { AnimatedLinkButton } from "@/components/projects/AnimatedLinkButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
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
      "Let’s Assist is a volunteer management platform built for high schools, families, and local nonprofits. We help volunteers discover events, record attendance with QR check-ins, and access certificates and hour reports after organizers verify and publish their hours.",
      "We pair modern volunteer tools with district-friendly safeguards (like parental consent flows and audit-ready exports) so students and organizations can focus on impact instead of spreadsheets.",
    ],
  },
  {
    question: "How is this different from SignupGenius?",
    answer: [
      "Let’s Assist combines project signups with attendance verification, QR check-in/out, and certificates for published hours. Organizers review attendance before publishing volunteer records.",
      "Organizations have role-based access and activity exports. Volunteers can view published hours and certificates in their Volunteer dashboard.",
    ],
  },
  {
    question: "Can I use Let’s Assist for school service requirements?",
    answer: [
      "Yes. Let’s Assist tracks verified and self-reported hours and provides certificates and exports. Your school or CSF chapter decides how these records meet its service requirements.",
      "Teachers and admins can set cadence alerts, attach supervisor approvals, and export compliance-ready reports for every student in seconds.",
    ],
  },
  {
    question: "How do organizations get started?",
    answer: [
      "Apply for trusted member access, invite team members with six-digit join codes, and publish projects that support one-time, multi-day, or same-day multi-area events.",
      "After an event, supervisors review attendance and publish verified hours. Volunteers can then view their certificates. Contact the organizer if your hours have not been published.",
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
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Frequently asked questions"
        description="Read through the most common questions about how we support volunteers, why organizations switch from SignupGenius, and what’s next after you sign up."
      />

      <Accordion className="mt-6 w-full" defaultValue={["item-1"]}>
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

      <section className="mt-12 flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
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
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Request trusted access
          </Link>
          <AnimatedLinkButton href="/contact" icon={MessageCircleIcon}>
            Contact support
          </AnimatedLinkButton>
        </div>
      </section>
    </div>
  );
}
