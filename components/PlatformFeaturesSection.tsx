"use client";

import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CalendarCheck,
  QrCode,
  BarChart3,
  ShieldCheck,
  Calendar,
  Clock,
} from "lucide-react";


interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  badge: string | null;
  imagePath?: string;
}

const features: Feature[] = [
  {
    icon: CalendarCheck,
    title: "Calendar sync",
    desc: "Add shifts to your personal Google Calendar with one click. Times respect your timezone and can include optional reminders.",
    badge: null,
  },
  {
    icon: QrCode,
    title: "Fast QR check‑in/out",
    desc: "Contactless QR check‑in and check‑out for quick attendance. Supervisors can verify entries instantly from their dashboard.",
    badge: null,
  },
  {
    icon: BarChart3,
    title: "Personal dashboard",
    desc: "A clear dashboard showing your verified and self‑reported hours, upcoming shifts, and one‑click CSV export.",
    badge: null,
  },
  {
    icon: Calendar,
    title: "Flexible event types",
    desc: "Supports one‑time sessions, multi‑day events with recurring slots, and same‑day multi‑area schedules to match any volunteer setup.",
    badge: "3 types",
  },
  {
    icon: Clock,
    title: "Organization insights",
    desc: "Admins and staff can view member hours with date‑range filters, event breakdowns, and exportable reports for easy audits.",
    badge: "Admin & staff",
  },
  {
    icon: ShieldCheck,
    title: "Parental consent (COPPA)",
    desc: "Secure parental/guardian consent flow for users under 13 — triggered only when signing up with participating school‑district email addresses.",
    badge: "COPPA (district‑specific)",
  },
];

export default function PlatformFeaturesSection() {
  return (
    <section id="features" className="py-16 sm:py-20 bg-muted/30">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="text-center mx-auto max-w-2xl mb-10"
        >
          <h2 className="font-overusedgrotesk text-3xl sm:text-4xl tracking-tight">
            Everything you need, nothing you don't
          </h2>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground">
            Core features built for high schoolers, families, and organizations.
          </p>
        </motion.div>

        <div className="mx-auto max-w-5xl grid gap-4 sm:gap-5 md:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feat, i) => (
            <motion.div
              key={feat.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
            >
              <Card className="h-full border-border/60 bg-background shadow-sm hover:shadow-md transition">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
                      <feat.icon className="h-5 w-5" />
                    </div>
                    {feat.badge && (
                      <Badge variant="secondary" className="text-xs">
                        {feat.badge}
                      </Badge>
                    )}
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2">
                    {feat.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feat.desc}
                  </p>
                  {feat.imagePath && (
                    <div className="mt-4 rounded-md border border-border/60 bg-muted/30 p-2">
                      <p className="text-xs text-muted-foreground italic">
                        Reference: {feat.imagePath}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
