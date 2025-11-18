"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CalendarCheck,
  ShieldCheck,
  Building2,
  LayoutDashboard,
  LockKeyhole,
  Network,
  CheckCircle2,
} from "lucide-react";

const pillars = [
  {
    icon: CalendarCheck,
    title: "Google Calendar Sync",
    description:
      "Two-way syncing keeps volunteers, coordinators, and families aligned with instant updates and reminders.",
  },
  {
    icon: LayoutDashboard,
    title: "Volunteer Command Center",
    description:
      "Live dashboards surface attendance, hours, certificates, and next actions the moment an event wraps.",
  },
  {
    icon: Building2,
    title: "Organization Operations",
    description:
      "Permissions, rosters, and document workflows purpose-built for district leaders and nonprofit partners.",
  },
  {
    icon: ShieldCheck,
    title: "Student Privacy & COPPA",
    description:
      "Parent/guardian consent, age gates, and audit trails help schools stay compliant without slowing onboarding.",
  },
];

const assurances = [
  {
    icon: LockKeyhole,
    label: "Supabase-secured data layer",
  },
  {
    icon: Network,
    label: "Granular organization roles",
  },
  {
    icon: CheckCircle2,
    label: "Automated certificates & audit logs",
  },
];

export const TrustAndComplianceSection = () => {
  return (
    <section className="py-20 bg-muted/30">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto"
        >
          <Badge variant="outline" className="mb-4 inline-flex items-center gap-2 border-primary/40 bg-primary/5 text-primary">
            Trust & Compliance
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Built for Schools, Nonprofits, and Families
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base">
            Let&apos;s Assist pairs delightful volunteer experiences with enterprise-grade guardrails so districts and organizations can scale confidently.
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={{
            hidden: {},
            visible: {
              transition: { staggerChildren: 0.08 },
            },
          }}
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mt-12"
        >
          {pillars.map((pillar) => (
            <motion.div
              key={pillar.title}
              variants={{
                hidden: { opacity: 0, y: 24 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
              }}
            >
              <Card className="h-full border-border/70 bg-card/80 backdrop-blur">
                <CardHeader className="flex flex-row items-center gap-3 pb-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <pillar.icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base font-semibold">
                    {pillar.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground leading-relaxed">
                  {pillar.description}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        <div className="mt-12">
          <div className="flex flex-wrap items-center justify-center gap-4">
            {assurances.map((assurance) => (
              <Badge key={assurance.label} variant="outline" className="gap-2 border-border/60 bg-background/80 backdrop-blur">
                <assurance.icon className="h-4 w-4 text-primary" />
                {assurance.label}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
