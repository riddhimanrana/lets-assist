"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Rocket,
  LineChart,
  Users,
  ClipboardCheck,
  Cog,
  Workflow,
  Sparkles,
} from "lucide-react";

const nowHighlights = [
  {
    icon: Rocket,
    title: "Live district pilots",
    description: "Serving school districts and nonprofits that rely on accurate hour verification and student safety checks.",
  },
  {
    icon: LineChart,
    title: "Insightful analytics",
    description: "Dashboards surface volunteer engagement, attendance reliability, and certification readiness in real time.",
  },
  {
    icon: Users,
    title: "Unified stakeholder experience",
    description: "Volunteers, guardians, organizers, and administrators stay in sync with role-based access and shared context.",
  },
];

const roadmap = [
  {
    icon: ClipboardCheck,
    title: "Deeper SIS & district data integrations",
    status: "In progress",
    description: "Sync rosters, guardians, and attendance exports directly into school information systems.",
  },
  {
    icon: Workflow,
    title: "Automated approvals & escalations",
    status: "Next release",
    description: "Configurable workflows route volunteer eligibility checks and certificates for faster sign-off.",
  },
  {
    icon: Sparkles,
    title: "AI-powered shift recommendations",
    status: "Exploring",
    description: "Intelligence recommends opportunities based on impact goals, skills, and available transportation.",
  },
  {
    icon: Cog,
    title: "Open API for partner ecosystems",
    status: "Planning",
    description: "Let organizations connect Let\'s Assist data with fundraising, CRM, and student success tools.",
  },
];

export const CurrentStateSection = () => {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto"
        >
          <Badge variant="outline" className="mb-4 inline-flex items-center gap-2 border-primary/40 bg-primary/5 text-primary">
            Product Snapshot
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Where Let&apos;s Assist is Today—and What&apos;s Next
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base">
            We ship in partnership with educators, students, and community leaders. Here&apos;s the current state of the platform and the roadmap we&apos;re actively building.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-12">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <Card className="h-full border-border/70 bg-card/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">What&apos;s live</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 pt-0">
                {nowHighlights.map((highlight) => (
                  <div key={highlight.title} className="flex items-start gap-4">
                    <div className="rounded-xl bg-primary/10 p-2 text-primary">
                      <highlight.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold">{highlight.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {highlight.description}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Card className="h-full border-border/70 bg-card/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">What we&apos;re building next</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 pt-0">
                {roadmap.map((item) => (
                  <div key={item.title} className="flex items-start gap-4">
                    <div className="rounded-xl bg-primary/10 p-2 text-primary">
                      <item.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {item.title}
                        <Badge className="bg-primary/10 text-primary">{item.status}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
