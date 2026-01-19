"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Check,
  X,
  QrCode,
  Award,
  Users,
  BarChart3,
  Clock,
  Shield,
  Sparkles,
  ArrowRight,
  Calendar,
  FileText,
  Mail,
  Zap,
  DollarSign,
  Building2,
  GraduationCap,
  Heart,
} from "lucide-react";
import Link from "next/link";

interface ComparisonFeature {
  name: string;
  description: string;
  letsAssist: boolean | string;
  signupGenius: boolean | string;
  highlight?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}

const comparisonFeatures: ComparisonFeature[] = [
  {
    name: "QR Check-in/out",
    description: "Contactless attendance verification",
    letsAssist: true,
    signupGenius: false,
    highlight: true,
    icon: QrCode,
  },
  {
    name: "Auto Certificates",
    description: "PDF certificates generated automatically",
    letsAssist: true,
    signupGenius: false,
    highlight: true,
    icon: Award,
  },
  {
    name: "Verified Hours",
    description: "Supervisor-verified time tracking",
    letsAssist: true,
    signupGenius: false,
    highlight: true,
    icon: Shield,
  },
  {
    name: "Organization Roles",
    description: "Admin, staff, and member permissions",
    letsAssist: true,
    signupGenius: false,
    icon: Users,
  },
  {
    name: "Personal Dashboard",
    description: "Track all your volunteer hours",
    letsAssist: true,
    signupGenius: false,
    icon: BarChart3,
  },
  {
    name: "CSV Exports",
    description: "Export data for compliance/audits",
    letsAssist: true,
    signupGenius: "Premium only",
    icon: FileText,
  },
  {
    name: "Calendar Sync",
    description: "Add events to Google Calendar",
    letsAssist: true,
    signupGenius: true,
    icon: Calendar,
  },
  {
    name: "Email Confirmations",
    description: "Automated signup confirmations",
    letsAssist: true,
    signupGenius: true,
    icon: Mail,
  },
  {
    name: "Multiple Event Types",
    description: "One-time, multi-day, same-day slots",
    letsAssist: true,
    signupGenius: "Limited",
    icon: Clock,
  },
  {
    name: "COPPA Compliance",
    description: "Parental consent for minors",
    letsAssist: true,
    signupGenius: false,
    icon: Shield,
  },
];

const pricingComparison = [
  { feature: "Basic signup management", letsAssist: "Free", signupGenius: "Free with ads" },
  { feature: "QR attendance tracking", letsAssist: "Free", signupGenius: "Not available" },
  { feature: "Auto certificates", letsAssist: "Free", signupGenius: "Not available" },
  { feature: "Remove ads", letsAssist: "No ads", signupGenius: "$11.99/mo" },
  { feature: "Export to CSV", letsAssist: "Free", signupGenius: "$11.99/mo" },
  { feature: "Advanced reporting", letsAssist: "Free", signupGenius: "$27.99/mo" },
];

const switchReasons = [
  {
    icon: GraduationCap,
    title: "Perfect for schools",
    description: "Built-in COPPA compliance, student hour tracking, and certificate automation for service learning requirements.",
  },
  {
    icon: Building2,
    title: "Nonprofit ready",
    description: "Audit-ready exports, verified attendance records, and organization-wide reporting at no cost.",
  },
  {
    icon: Heart,
    title: "Volunteer focused",
    description: "Personal dashboards, hour tracking, and certificates that volunteers can use for applications and resumes.",
  },
];

// Mockup UI components for visual comparison
function SignUpGeniusMockup() {
  return (
    <div className="relative rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 p-4 opacity-60">
      <div className="absolute -top-3 left-4">
        <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">SignUpGenius</Badge>
      </div>
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-orange-200/50" />
          <div className="flex-1">
            <div className="h-3 w-32 rounded bg-muted-foreground/20" />
            <div className="mt-1 h-2 w-24 rounded bg-muted-foreground/10" />
          </div>
        </div>
        <div className="h-px w-full bg-muted-foreground/10" />
        <div className="flex gap-2">
          <div className="flex-1 rounded border border-muted-foreground/20 p-2">
            <div className="h-2 w-16 rounded bg-muted-foreground/15" />
            <div className="mt-1 h-3 w-8 rounded bg-muted-foreground/20" />
          </div>
          <div className="flex-1 rounded border border-muted-foreground/20 p-2">
            <div className="h-2 w-16 rounded bg-muted-foreground/15" />
            <div className="mt-1 h-3 w-12 rounded bg-muted-foreground/20" />
          </div>
        </div>
        <div className="flex items-center justify-center gap-1 rounded bg-orange-100/30 p-2 text-xs text-muted-foreground">
          <X className="h-3 w-3" />
          <span>No hour tracking</span>
        </div>
        <div className="flex items-center justify-center gap-1 rounded bg-orange-100/30 p-2 text-xs text-muted-foreground">
          <X className="h-3 w-3" />
          <span>No certificates</span>
        </div>
      </div>
    </div>
  );
}

function LetsAssistMockup() {
  return (
    <div className="relative rounded-lg border-2 border-primary/40 bg-primary/5 p-4 shadow-lg shadow-primary/10">
      <div className="absolute -top-3 left-4">
        <Badge className="text-xs bg-primary text-primary-foreground">Let's Assist</Badge>
      </div>
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center">
            <Heart className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <div className="h-3 w-32 rounded bg-primary/30" />
            <div className="mt-1 h-2 w-24 rounded bg-primary/20" />
          </div>
        </div>
        <div className="h-px w-full bg-primary/20" />
        <div className="flex gap-2">
          <div className="flex-1 rounded border border-primary/30 bg-primary/5 p-2">
            <div className="text-[10px] text-muted-foreground">Verified Hours</div>
            <div className="text-sm font-semibold text-primary">24.5h</div>
          </div>
          <div className="flex-1 rounded border border-primary/30 bg-primary/5 p-2">
            <div className="text-[10px] text-muted-foreground">Certificates</div>
            <div className="text-sm font-semibold text-primary">6</div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-1 rounded bg-primary/15 p-2 text-xs text-primary font-medium">
          <QrCode className="h-3 w-3" />
          <span>QR Check-in Ready</span>
        </div>
        <div className="flex items-center justify-center gap-1 rounded bg-primary/15 p-2 text-xs text-primary font-medium">
          <Award className="h-3 w-3" />
          <span>Auto Certificates</span>
        </div>
      </div>
    </div>
  );
}

// Animated checkmark component
function AnimatedCheck({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0 }}
      whileInView={{ scale: 1 }}
      viewport={{ once: true }}
      transition={{ delay, type: "spring", stiffness: 300, damping: 20 }}
      className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15"
    >
      <Check className="h-4 w-4 text-primary" />
    </motion.div>
  );
}

function AnimatedX({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0 }}
      whileInView={{ scale: 1 }}
      viewport={{ once: true }}
      transition={{ delay, type: "spring", stiffness: 300, damping: 20 }}
      className="flex h-6 w-6 items-center justify-center rounded-full bg-muted"
    >
      <X className="h-4 w-4 text-muted-foreground" />
    </motion.div>
  );
}

// Feature comparison row
function ComparisonRow({ feature, index }: { feature: ComparisonFeature; index: number }) {
  const delay = index * 0.05;
  
  return (
    <motion.tr
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.3 }}
      className={`border-b border-border/50 ${feature.highlight ? "bg-primary/5" : ""}`}
    >
      <td className="py-4 px-4">
        <div className="flex items-center gap-3">
          <div className={`rounded-lg p-1.5 ${feature.highlight ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
            <feature.icon className="h-4 w-4" />
          </div>
          <div>
            <p className={`text-sm font-medium ${feature.highlight ? "text-primary" : "text-foreground"}`}>
              {feature.name}
              {feature.highlight && (
                <Badge variant="outline" className="ml-2 text-[10px] border-primary/30 text-primary">Key</Badge>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{feature.description}</p>
          </div>
        </div>
      </td>
      <td className="py-4 px-4 text-center">
        {typeof feature.letsAssist === "boolean" ? (
          feature.letsAssist ? <AnimatedCheck delay={delay + 0.1} /> : <AnimatedX delay={delay + 0.1} />
        ) : (
          <motion.span
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: delay + 0.1 }}
            className="text-xs font-medium text-primary"
          >
            {feature.letsAssist}
          </motion.span>
        )}
      </td>
      <td className="py-4 px-4 text-center">
        {typeof feature.signupGenius === "boolean" ? (
          feature.signupGenius ? <AnimatedCheck delay={delay + 0.15} /> : <AnimatedX delay={delay + 0.15} />
        ) : (
          <motion.span
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: delay + 0.15 }}
            className="text-xs text-muted-foreground"
          >
            {feature.signupGenius}
          </motion.span>
        )}
      </td>
    </motion.tr>
  );
}

// Pricing comparison row
function PricingRow({ item, index }: { item: typeof pricingComparison[0]; index: number }) {
  const delay = index * 0.08;
  const isFree = item.letsAssist === "Free" || item.letsAssist === "No ads";
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.4 }}
      className="flex items-center justify-between py-3 border-b border-border/40 last:border-0"
    >
      <span className="text-sm text-foreground">{item.feature}</span>
      <div className="flex items-center gap-4">
        <span className={`text-sm font-semibold ${isFree ? "text-primary" : "text-foreground"}`}>
          {item.letsAssist}
        </span>
        <span className="text-sm text-muted-foreground w-24 text-right">{item.signupGenius}</span>
      </div>
    </motion.div>
  );
}

export default function ComparisonSection() {
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const visibleFeatures = showAllFeatures ? comparisonFeatures : comparisonFeatures.slice(0, 6);

  return (
    <section id="comparison" className="py-16 sm:py-24 bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 sm:px-6">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mx-auto max-w-3xl mb-12"
        >
          <Badge variant="outline" className="mb-4 border-primary/40 bg-primary/10 text-primary">
            <Sparkles className="h-3 w-3 mr-1" />
            Why teams are switching
          </Badge>
          <h2 className="font-overusedgrotesk text-3xl sm:text-4xl lg:text-5xl tracking-tight font-bold">
            SignUpGenius is for signups.
            <br />
            <span className="text-transparent bg-gradient-to-r from-primary to-emerald-500 bg-clip-text">
              Let's Assist is for volunteering.
            </span>
          </h2>
          <p className="mt-4 text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Stop using a tool designed for potlucks to manage your volunteer program. 
            Get verified hours, auto-certificates, and compliance-ready reports — all free.
          </p>
        </motion.div>

        {/* Side-by-side mockups */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto mb-16"
        >
          <SignUpGeniusMockup />
          <LetsAssistMockup />
        </motion.div>

        {/* Feature comparison table */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mx-auto max-w-4xl mb-16"
        >
          <Card className="overflow-hidden border-border/60 shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="py-4 px-4 text-left text-sm font-semibold text-foreground">Feature</th>
                    <th className="py-4 px-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Badge className="bg-primary text-primary-foreground">Let's Assist</Badge>
                      </div>
                    </th>
                    <th className="py-4 px-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Badge variant="secondary" className="bg-muted text-muted-foreground">SignUpGenius</Badge>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFeatures.map((feature, i) => (
                    <ComparisonRow key={feature.name} feature={feature} index={i} />
                  ))}
                </tbody>
              </table>
            </div>
            {!showAllFeatures && comparisonFeatures.length > 6 && (
              <div className="p-4 text-center border-t border-border/50">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllFeatures(true)}
                  className="text-primary hover:text-primary/80"
                >
                  Show all features
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            )}
          </Card>
        </motion.div>

        {/* Why teams switch cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-16"
        >
          <h3 className="text-center text-xl sm:text-2xl font-semibold mb-8">
            Built for real volunteer management
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {switchReasons.map((reason, i) => (
              <motion.div
                key={reason.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
              >
                <Card className="h-full border-border/60 bg-background hover:border-primary/40 hover:shadow-md transition-all duration-300">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-xl bg-primary/10 p-3 text-primary">
                      <reason.icon className="h-5 w-5" />
                    </div>
                    <h4 className="text-base font-semibold text-foreground mb-2">{reason.title}</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">{reason.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Pricing comparison */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto mb-16"
        >
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
            <CardContent className="p-6 sm:p-8">
              <div className="flex items-center gap-2 mb-6">
                <DollarSign className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Price comparison</h3>
              </div>
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
                <span className="text-sm font-medium text-muted-foreground">Feature</span>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-primary">Let's Assist</span>
                  <span className="text-sm font-medium text-muted-foreground w-24 text-right">SignUpGenius</span>
                </div>
              </div>
              {pricingComparison.map((item, i) => (
                <PricingRow key={item.feature} item={item} index={i} />
              ))}
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 }}
                className="mt-6 p-4 rounded-lg bg-primary/10 border border-primary/20"
              >
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-primary">Save $335+/year</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Everything you need for volunteer management, completely free. No hidden fees, no premium tiers.
                </p>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <div className="inline-flex flex-col sm:flex-row gap-3 items-center">
            <Button asChild size="lg" className="gap-2 px-8">
              <Link href="/signup">
                Start for free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2">
              <Link href="/projects">
                Explore opportunities
              </Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No credit card required • Free forever • Switch from SignUpGenius in minutes
          </p>
        </motion.div>
      </div>
    </section>
  );
}
