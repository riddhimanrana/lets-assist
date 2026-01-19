"use client";

import { useState, useEffect, useRef } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";
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
  ArrowRight,
  Calendar,
  FileText,
  Mail,
  Zap,
  Building2,
  GraduationCap,
  Heart,
  Smartphone,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";

// Words that flip in the header
const flipWords = ["outdated", "limited", "2010s", "cluttered"];

// Text flip animation component
function TextFlip({ words }: { words: string[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % words.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [words.length]);

  return (
    <span className="relative inline-block w-[140px] sm:w-[180px] h-[1.2em] overflow-hidden align-bottom">
      <AnimatePresence mode="wait">
        <motion.span
          key={currentIndex}
          initial={{ y: 40, opacity: 0, rotateX: -90 }}
          animate={{ y: 0, opacity: 1, rotateX: 0 }}
          exit={{ y: -40, opacity: 0, rotateX: 90 }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          className="absolute left-0 text-orange-500 dark:text-orange-400"
        >
          {words[currentIndex]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

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
    description: "Built-in COPPA compliance, student hour tracking, and certificate automation for service learning.",
  },
  {
    icon: Building2,
    title: "Nonprofit ready",
    description: "Audit-ready exports, verified attendance records, and organization-wide reporting at no cost.",
  },
  {
    icon: Heart,
    title: "Volunteer focused",
    description: "Personal dashboards, hour tracking, and certificates for applications and resumes.",
  },
];

// Modern dashboard mockup for Let's Assist
function ModernDashboardMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: 0.3 }}
      className="relative"
    >
      {/* Glow effect */}
      <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 via-emerald-500/20 to-primary/20 rounded-3xl blur-2xl opacity-60" />
      
      <div className="relative rounded-2xl border border-primary/30 bg-gradient-to-br from-background via-background to-primary/5 p-1 shadow-2xl">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-muted/30 rounded-t-xl">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
            <div className="w-3 h-3 rounded-full bg-green-400/80" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="px-4 py-1 rounded-md bg-background/80 text-xs text-muted-foreground flex items-center gap-2">
              <Shield className="w-3 h-3 text-primary" />
              letsassist.com/dashboard
            </div>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-4 sm:p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <motion.h4 
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 }}
                className="text-lg font-semibold text-foreground"
              >
                Welcome back, Sarah! 👋
              </motion.h4>
              <p className="text-sm text-muted-foreground">Your volunteer impact this month</p>
            </div>
            <Badge className="bg-primary/15 text-primary border-0">
              <TrendingUp className="w-3 h-3 mr-1" />
              +15% this month
            </Badge>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Verified Hours", value: "47.5", icon: Clock, color: "text-primary" },
              { label: "Certificates", value: "8", icon: Award, color: "text-emerald-500" },
              { label: "Events", value: "12", icon: Calendar, color: "text-blue-500" },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.6 + i * 0.1 }}
                className="rounded-xl border border-border/60 bg-card/50 p-3 text-center"
              >
                <stat.icon className={`w-4 h-4 mx-auto mb-1 ${stat.color}`} />
                <div className="text-xl font-bold text-foreground">{stat.value}</div>
                <div className="text-[10px] text-muted-foreground">{stat.label}</div>
              </motion.div>
            ))}
          </div>

          {/* Feature highlights */}
          <div className="flex flex-wrap gap-2">
            {[
              { icon: QrCode, label: "QR Check-in" },
              { icon: Smartphone, label: "Mobile Ready" },
              { icon: Shield, label: "Verified" },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.9 + i * 0.1 }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
              >
                <item.icon className="w-3 h-3" />
                {item.label}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Outdated SignUpGenius mockup
function OutdatedMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="relative"
    >
      <div className="relative rounded-2xl border-2 border-dashed border-muted-foreground/30 bg-muted/20 p-1 opacity-75">
        {/* Browser chrome - old style */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-muted-foreground/20 bg-gradient-to-b from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 rounded-t-xl">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-gray-400" />
            <div className="w-3 h-3 rounded-full bg-gray-400" />
            <div className="w-3 h-3 rounded-full bg-gray-400" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="px-4 py-1 rounded-sm bg-white dark:bg-gray-900 text-xs text-muted-foreground border border-muted-foreground/30">
              signupgenius.com
            </div>
          </div>
        </div>

        {/* Old-style content */}
        <div className="p-4 sm:p-6 space-y-4 bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-950">
          {/* SignUpGenius logo */}
          <div className="flex items-center gap-3">
            <Image 
              src="/signupgenius.jpg" 
              alt="SignUpGenius" 
              width={40} 
              height={40} 
              className="rounded opacity-70"
            />
            <div>
              <div className="text-sm font-medium text-muted-foreground">SignUpGenius</div>
              <div className="text-[10px] text-muted-foreground/60">Founded 2007</div>
            </div>
          </div>

          {/* Old table-style layout */}
          <div className="border border-muted-foreground/30 rounded overflow-hidden">
            <div className="bg-orange-100 dark:bg-orange-900/30 px-3 py-2 border-b border-muted-foreground/30">
              <div className="text-xs font-medium text-muted-foreground">Volunteer Signup Sheet</div>
            </div>
            <div className="divide-y divide-muted-foreground/20">
              {["9:00 AM - Setup", "10:00 AM - Registration", "11:00 AM - Food Service"].map((slot, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                  <span>{slot}</span>
                  <span className="text-[10px] bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded">3/5 spots</span>
                </div>
              ))}
            </div>
          </div>

          {/* Missing features callout */}
          <div className="space-y-2">
            {[
              "No hour tracking",
              "No certificates",
              "No QR check-in",
              "Ads on free tier",
            ].map((missing, i) => (
              <motion.div
                key={missing}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.8 + i * 0.1 }}
                className="flex items-center gap-2 text-xs text-muted-foreground/70"
              >
                <X className="w-3 h-3 text-red-400" />
                {missing}
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* "Stuck in 2010" label */}
      <motion.div
        initial={{ opacity: 0, rotate: -5 }}
        whileInView={{ opacity: 1, rotate: -3 }}
        viewport={{ once: true }}
        transition={{ delay: 1.2 }}
        className="absolute -bottom-3 -right-3 px-3 py-1 rounded-full bg-orange-500/90 text-white text-xs font-medium shadow-lg"
      >
        Designed for 2010 📟
      </motion.div>
    </motion.div>
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
      className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 mx-auto"
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
      className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/10 mx-auto"
    >
      <X className="h-4 w-4 text-red-400" />
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
            <p className="text-xs text-muted-foreground hidden sm:block">{feature.description}</p>
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

// Animated counter for stats
function AnimatedCounter({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (isInView) {
      const duration = 1500;
      const steps = 40;
      const increment = value / steps;
      let current = 0;
      const timer = setInterval(() => {
        current += increment;
        if (current >= value) {
          setDisplayValue(value);
          clearInterval(timer);
        } else {
          setDisplayValue(Math.floor(current));
        }
      }, duration / steps);
      return () => clearInterval(timer);
    }
  }, [isInView, value]);

  return <span ref={ref}>{displayValue}{suffix}</span>;
}

export default function ComparisonSection() {
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const visibleFeatures = showAllFeatures ? comparisonFeatures : comparisonFeatures.slice(0, 6);

  return (
    <section id="comparison" className="py-16 sm:py-24 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/20 to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.05),transparent_70%)]" />

      <div className="container relative mx-auto px-4 sm:px-6">
        {/* Section header with text flip */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mx-auto max-w-4xl mb-16"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            <Badge variant="outline" className="mb-6 border-primary/40 bg-primary/10 text-primary px-4 py-1.5">
              <Zap className="h-3 w-3 mr-1.5" />
              Why 100+ organizations switched this year
            </Badge>
          </motion.div>

          <h2 className="font-overusedgrotesk text-3xl sm:text-4xl lg:text-5xl xl:text-6xl tracking-tight font-bold leading-tight">
            SignUpGenius is{" "}
            <TextFlip words={flipWords} />
            <br className="hidden sm:block" />
            <span className="text-transparent bg-gradient-to-r from-primary via-emerald-500 to-primary bg-clip-text bg-[length:200%_auto] animate-gradient">
              Let&apos;s Assist is built for today.
            </span>
          </h2>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto"
          >
            Stop using a tool designed for potlucks to manage your volunteer program. 
            Modern hour tracking, auto-certificates, and compliance-ready reports — <span className="text-primary font-medium">completely free</span>.
          </motion.p>
        </motion.div>

        {/* Side-by-side comparison mockups */}
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 max-w-6xl mx-auto mb-20 items-center">
          <div className="order-2 lg:order-1">
            <OutdatedMockup />
          </div>
          <div className="order-1 lg:order-2">
            <ModernDashboardMockup />
          </div>
        </div>

        {/* Stats banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto mb-16"
        >
          <div className="grid grid-cols-3 gap-4 sm:gap-8 p-6 sm:p-8 rounded-2xl bg-gradient-to-r from-primary/10 via-emerald-500/10 to-primary/10 border border-primary/20">
            {[
              { value: 335, suffix: "+", label: "Saved per year" },
              { value: 100, suffix: "%", label: "Free forever" },
              { value: 48, suffix: "h", label: "Cert delivery" },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <div className="text-2xl sm:text-4xl font-bold text-primary">
                  {stat.label === "Saved per year" && "$"}
                  <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground mt-1">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Feature comparison table */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mx-auto max-w-4xl mb-16"
        >
          <Card className="overflow-hidden border-border/60 shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="py-4 px-4 text-left text-sm font-semibold text-foreground">Feature</th>
                    <th className="py-4 px-4 text-center min-w-[100px]">
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center mb-1">
                          <Heart className="w-4 h-4 text-primary" />
                        </div>
                        <span className="text-xs font-medium text-primary">Let&apos;s Assist</span>
                      </div>
                    </th>
                    <th className="py-4 px-4 text-center min-w-[100px]">
                      <div className="flex flex-col items-center gap-1">
                        <Image 
                          src="/signupgenius.jpg" 
                          alt="SignUpGenius" 
                          width={32} 
                          height={32} 
                          className="rounded-lg opacity-60 mb-1"
                        />
                        <span className="text-xs font-medium text-muted-foreground">SignUpGenius</span>
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
              <div className="p-4 text-center border-t border-border/50 bg-muted/20">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllFeatures(true)}
                  className="text-primary hover:text-primary/80 hover:bg-primary/10"
                >
                  Show all {comparisonFeatures.length} features
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
            Built for <span className="text-primary">real</span> volunteer management
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {switchReasons.map((reason, i) => (
              <motion.div
                key={reason.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
              >
                <Card className="h-full border-border/60 bg-background/80 backdrop-blur-sm hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex rounded-xl bg-gradient-to-br from-primary/20 to-emerald-500/20 p-3 text-primary">
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
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-background to-emerald-500/5 overflow-hidden shadow-xl">
            <CardContent className="p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  Price comparison
                </h3>
                <Badge className="bg-primary text-primary-foreground">Save $335+/year</Badge>
              </div>
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
                <span className="text-sm font-medium text-muted-foreground">Feature</span>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-primary">Let&apos;s Assist</span>
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
                className="mt-6 p-4 rounded-xl bg-gradient-to-r from-primary/15 to-emerald-500/15 border border-primary/20"
              >
                <p className="text-sm text-foreground font-medium">
                  🎉 Everything you need for volunteer management, <span className="text-primary">completely free</span>. No hidden fees, no premium tiers, no ads.
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
            <Button asChild size="lg" className="gap-2 px-8 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-shadow">
              <Link href="/signup">
                Start for free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 hover:bg-primary/5">
              <Link href="/projects">
                Explore opportunities
              </Link>
            </Button>
          </div>
          <motion.p 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="mt-6 text-sm text-muted-foreground"
          >
            No credit card required • Free forever • Switch from SignUpGenius in minutes
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
