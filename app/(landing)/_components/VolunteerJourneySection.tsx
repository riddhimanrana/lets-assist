"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Mail, QrCode, BarChart3, Award } from "lucide-react";
import { MiniProjectCard } from "./journey/MiniProjectCard";
import { EmailNotification } from "./journey/EmailNotification";
import { QRScannerPreview } from "./journey/QRScannerPreview";
import { MiniDashboard } from "./journey/MiniDashboard";
import { MiniCertificate } from "./journey/MiniCertificate";
import { AnimatedText } from "./AnimatedText";

const steps = [
  {
    icon: Search,
    key: "feed",
    label: "Browse feed",
    desc: "Discover opportunities filtered by location, schedule, and cause",
  },
  {
    icon: Mail,
    key: "signup",
    label: "Sign up & confirm",
    desc: "Instant email confirmation with event details",
  },
  {
    icon: QrCode,
    key: "qr",
    label: "QR check-in/out",
    desc: "Scan to track attendance with supervisor verification",
  },
  {
    icon: BarChart3,
    key: "dashboard",
    label: "Track progress",
    desc: "View verified hours, stats, and export records",
  },
  {
    icon: Award,
    key: "certificate",
    label: "Get certified",
    desc: "Certificates after organizers verify and publish hours",
  },
];

// Mock data for real UI components
const mockProjectData = {
  title: "Bellingham Square Park Cleanup",
  location: "San Ramon, California",
  date: "Nov 23 • 9:00 AM",
  spotsLeft: 3,
  totalSpots: 20,
  creatorName: "San Ramon City Alliance",
  // Serve the image from the Next.js public/ folder (place file at public/logos/sanramon.png)
  // Include explicit width/height so consumers (e.g., Next/Image) can size it correctly.
  creatorAvatar: "/logos/sanramon.jpg",
  creatorAvatarWidth: 40,
  creatorAvatarHeight: 40,
};

const mockDashboardData = {
  totalHours: 24.5,
  totalProjects: 6,
  progressPercentage: 75,
};

const mockCertificateData = {
  projectName: "Bellingham Square Park Cleanup",
  organizationName: "San Ramon City Alliance",
  hours: 3.0,
  volunteerName: "Riddhiman Rana",
};

export default function VolunteerJourneySection() {
  const [active, setActive] = useState(0);
  const [userSelected, setUserSelected] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const sectionInView = useInView(sectionRef, { amount: 0.3 });
  const shouldReduceMotion = useReducedMotion();

  // The steps cycle only until someone picks one. After that the choice
  // stays put, so it is not replaced while they are reading or tabbing.
  useEffect(() => {
    if (!sectionInView || shouldReduceMotion || userSelected) {
      return;
    }

    const id = setInterval(
      () => setActive((s) => (s + 1) % steps.length),
      3000,
    );
    return () => clearInterval(id);
  }, [sectionInView, shouldReduceMotion, userSelected]);

  const selectStep = (index: number) => {
    setUserSelected(true);
    setActive(index);
  };

  const previews = useMemo(
    () => ({
      feed: (
        <div className="p-4">
          <MiniProjectCard {...mockProjectData} />
        </div>
      ),
      signup: <EmailNotification />,
      qr: <QRScannerPreview shouldAnimate={sectionInView} />,
      dashboard: <MiniDashboard {...mockDashboardData} />,
      certificate: (
        <MiniCertificate
          {...mockCertificateData}
          shouldAnimate={sectionInView}
        />
      ),
    }),
    [sectionInView],
  );

  return (
    <section id="journey" ref={sectionRef} className="py-16 sm:py-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={false}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="text-center mx-auto max-w-2xl mb-8 relative"
        >
          {/* Faint background lines behind heading */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute -z-10 inset-0 h-[120%] w-full opacity-[0.08] dark:opacity-[0.12]"
            viewBox="0 0 600 200"
            preserveAspectRatio="none"
          >
            <path
              d="M0,100 C150,80 300,120 450,100 C525,90 575,110 600,100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path
              d="M0,120 C150,100 300,140 450,120 C525,110 575,130 600,120"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            <AnimatedText text="From sign-up to certificate" mode="words" />
          </h2>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground">
            What a volunteer sees, start to finish.
          </p>
        </motion.div>

        {/* The preview comes first so it sits above the steps on a phone. */}
        <div className="grid grid-cols-1 items-center gap-4 sm:gap-6 md:grid-cols-2">
          <div>
            {/* A fixed floor keeps the steps from jumping as previews change. */}
            {/*
              The key swaps the preview in the same render as the selection.
              Nothing waits on an exit animation, so the preview always
              matches the pressed step.
            */}
            <div className="flex min-h-88 items-center justify-center">
              <div key={steps[active].key} className="w-full">
                {previews[steps[active].key as keyof typeof previews]}
              </div>
            </div>
            {/*
              Each button is a 32px target around the same 8px pill. The pill
              is centred, so it sits where the old top margin put it. The
              unpressed pills use an opaque text token, so they still show
              against the page in both themes.
            */}
            <div className="flex items-center justify-center gap-2">
              {steps.map((step, i) => (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => selectStep(i)}
                  aria-label={`Show step ${i + 1} of ${steps.length}: ${step.label}`}
                  aria-pressed={i === active}
                  className="flex size-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <span
                    aria-hidden
                    className={`h-2 w-8 rounded-full transition-all ${i === active ? "bg-primary" : "bg-muted-foreground"}`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            {steps.map((step, i) => (
              <motion.div
                key={step.label}
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
              >
                <button
                  type="button"
                  onClick={() => selectStep(i)}
                  aria-pressed={i === active}
                  className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-2xl"
                >
                  <Card
                    className={`h-full border-border/60 bg-background/90 shadow-xs ${i === active ? "ring-2 ring-primary/30" : ""}`}
                  >
                    <CardContent className="flex items-start gap-4 p-4">
                      <div className="rounded-full bg-primary/10 p-2 text-primary mt-1">
                        <step.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {step.label}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {step.desc}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
