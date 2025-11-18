"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Mail, QrCode, BarChart3, Award } from "lucide-react";
import { MiniProjectCard } from "@/components/journey/MiniProjectCard";
import { EmailNotification } from "@/components/journey/EmailNotification";
import { QRScannerPreview } from "@/components/journey/QRScannerPreview";
import { MiniDashboard } from "@/components/journey/MiniDashboard";
import { MiniCertificate } from "@/components/journey/MiniCertificate";

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
    desc: "Auto-published certificates 48–72h after event",
  },
];

// Mock data for real UI components
const mockProjectData = {
  title: "Bellingham Square Park Cleanup",
  location: "Santa Ramon, California",
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

  useEffect(() => {
    const id = setInterval(() => setActive((s) => (s + 1) % steps.length), 3000);
    return () => clearInterval(id);
  }, []);

  const previews = useMemo(
    () => ({
      feed: (
        <div className="p-4">
          <MiniProjectCard {...mockProjectData} />
        </div>
      ),
      signup: <EmailNotification />,
      qr: <QRScannerPreview />,
      dashboard: (
        <MiniDashboard {...mockDashboardData} />
      ),
      certificate: (
        <MiniCertificate {...mockCertificateData} />
      ),
    }),
    [],
  );

  return (
    <section className="py-16 sm:py-20">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="text-center mx-auto max-w-2xl mb-8 relative"
        >
          {/* Faint background lines behind heading */}
          <svg aria-hidden="true" className="pointer-events-none absolute -z-10 inset-0 h-[120%] w-full opacity-[0.08] dark:opacity-[0.12]" viewBox="0 0 600 200" preserveAspectRatio="none">
            <path d="M0,100 C150,80 300,120 450,100 C525,90 575,110 600,100" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M0,120 C150,100 300,140 450,120 C525,110 575,130 600,120" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
          <h2 className="font-overusedgrotesk text-3xl sm:text-4xl tracking-tight">
            From discovery to certified impact
          </h2>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground">
            The complete volunteer workflow — sign up, show up, track hours, share proof.
          </p>
        </motion.div>

        <div className="mx-auto max-w-6xl grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
          <div className="order-2 lg:order-1">
            <div className="rounded-2xl border border-border/60 bg-background/80 shadow-md overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={steps[active].key}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.35 }}
                >
                  {previews[steps[active].key as keyof typeof previews]}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="mt-3 flex items-center justify-center gap-2">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  aria-label={`Show ${steps[i].label}`}
                  className={`h-2 w-8 rounded-full transition-all ${i === active ? "bg-primary" : "bg-muted/40"}`}
                />
              ))}
            </div>
          </div>

          <div className="order-1 lg:order-2 grid gap-4">
            {steps.map((step, i) => (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
              >
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-pressed={i === active}
                  className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-2xl"
                >
                  <Card className={`h-full border-border/60 bg-background/90 shadow-sm ${i === active ? "ring-2 ring-primary/30" : ""}`}>
                    <CardContent className="flex items-start gap-4 p-4">
                      <div className="rounded-full bg-primary/10 p-2 text-primary mt-1">
                        <step.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{step.label}</p>
                        <p className="text-xs text-muted-foreground mt-1">{step.desc}</p>
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
