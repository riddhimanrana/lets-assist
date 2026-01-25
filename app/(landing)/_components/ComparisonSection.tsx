"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
    <span className="inline-flex items-center justify-center" style={{ minWidth: '5ch' }}>
      <AnimatePresence mode="wait">
        <motion.span
          key={currentIndex}
          initial={{ y: 20, opacity: 0, filter: "blur(4px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: -20, opacity: 0, filter: "blur(4px)" }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          className="text-orange-500 dark:text-orange-400 font-bold"
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
      <div className="absolute -inset-2 sm:-inset-4 bg-linear-to-r from-primary/20 via-emerald-500/20 to-primary/20 rounded-2xl sm:rounded-3xl blur-xl sm:blur-2xl opacity-60" />
      
      <div className="relative rounded-xl sm:rounded-2xl border border-primary/30 bg-linear-to-br from-background via-background to-primary/5 p-0.5 sm:p-1 shadow-xl sm:shadow-2xl">
        {/* Browser chrome */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-3 border-b border-border/50 bg-muted/30 rounded-t-xl">
          <div className="flex gap-1 sm:gap-1.5">
            <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-red-400/80" />
            <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-yellow-400/80" />
            <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-green-400/80" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="px-2 sm:px-4 py-0.5 sm:py-1 rounded-md bg-background/80 text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1 sm:gap-2">
              <Shield className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-primary" />
              <span className="hidden xs:inline">lets-assist.com/home</span>
              <span className="xs:hidden">lets-assist.com</span>
            </div>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4">
          {/* Header */}
          <div className="flex items-start sm:items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <motion.h4 
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 }}
                className="text-sm sm:text-base md:text-lg font-semibold text-foreground truncate"
              >
                Welcome back, Riddhiman!
              </motion.h4>
              <p className="text-xs sm:text-sm text-muted-foreground">Your volunteer impact</p>
            </div>
            <Badge className="bg-primary/15 text-primary border-0 text-[10px] sm:text-xs shrink-0">
              <TrendingUp className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5 sm:mr-1" />
              +15%
            </Badge>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: "Hours", value: "47.5", icon: Clock, color: "text-primary" },
              { label: "Certs", value: "8", icon: Award, color: "text-emerald-500" },
              { label: "Events", value: "12", icon: Calendar, color: "text-blue-500" },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.6 + i * 0.1 }}
                className="rounded-lg sm:rounded-xl border border-border/60 bg-card/50 p-2 sm:p-3 text-center"
              >
                <stat.icon className={`w-3 h-3 sm:w-4 sm:h-4 mx-auto mb-0.5 sm:mb-1 ${stat.color}`} />
                <div className="text-base sm:text-lg md:text-xl font-bold text-foreground">{stat.value}</div>
                <div className="text-[9px] sm:text-[10px] text-muted-foreground">{stat.label}</div>
              </motion.div>
            ))}
          </div>

          {/* Feature highlights */}
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {[
              { icon: QrCode, label: "QR Check-in" },
              { icon: Smartphone, label: "Mobile" },
              { icon: Shield, label: "Verified" },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.9 + i * 0.1 }}
                className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-primary/10 text-primary text-[10px] sm:text-xs font-medium"
              >
                <item.icon className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
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
      <div className="relative rounded-xl sm:rounded-2xl border-2 border-dashed border-muted-foreground/30 bg-muted/20 p-0.5 sm:p-1 opacity-75">
        {/* Browser chrome - old style */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-3 border-b border-muted-foreground/20 bg-linear-to-b from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 rounded-t-lg sm:rounded-t-xl">
          <div className="flex gap-1 sm:gap-1.5">
            <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-gray-400" />
            <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-gray-400" />
            <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-gray-400" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="px-2 sm:px-4 py-0.5 sm:py-1 rounded-sm bg-white dark:bg-gray-900 text-[10px] sm:text-xs text-muted-foreground border border-muted-foreground/30">
              signupgenius.com
            </div>
          </div>
        </div>

        {/* Old-style content */}
        <div className="p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4 bg-linear-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-950">
          {/* SignUpGenius logo */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Image 
              src="/signupgenius.jpg" 
              alt="SignUpGenius" 
              width={32} 
              height={32} 
              className="rounded opacity-70 w-8 h-8 sm:w-10 sm:h-10"
            />
            <div>
              <div className="text-xs sm:text-sm font-medium text-muted-foreground">SignUpGenius</div>
              <div className="text-[9px] sm:text-[10px] text-muted-foreground/60">Founded 2007</div>
            </div>
          </div>

          {/* Old table-style layout */}
          <div className="border border-muted-foreground/30 rounded overflow-hidden">
            <div className="bg-orange-100 dark:bg-orange-900/30 px-2 sm:px-3 py-1.5 sm:py-2 border-b border-muted-foreground/30">
              <div className="text-[10px] sm:text-xs font-medium text-muted-foreground">Volunteer Signup Sheet</div>
            </div>
            <div className="divide-y divide-muted-foreground/20">
              {["9:00 AM - Setup", "10:00 AM - Registration", "11:00 AM - Food"].map((slot, i) => (
                <div key={i} className="flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs text-muted-foreground">
                  <span className="truncate">{slot}</span>
                  <span className="text-[9px] sm:text-[10px] bg-gray-200 dark:bg-gray-700 px-1.5 sm:px-2 py-0.5 rounded shrink-0 ml-2">3/5</span>
                </div>
              ))}
            </div>
          </div>

          {/* Missing features callout */}
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            {[
              "No hours",
              "No certs",
              "No QR",
              "Ads",
            ].map((missing, i) => (
              <motion.div
                key={missing}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.8 + i * 0.1 }}
                className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground/70"
              >
                <X className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-red-400 shrink-0" />
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
        className="absolute -bottom-2 -right-2 sm:-bottom-3 sm:-right-3 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-orange-500/90 text-white text-[10px] sm:text-xs font-medium shadow-lg"
      >
        2010 design 📟
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
      className="flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full bg-primary/15 mx-auto"
    >
      <Check className="h-3 w-3 sm:h-4 sm:w-4 text-primary" />
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
      className="flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full bg-red-500/10 mx-auto"
    >
      <X className="h-3 w-3 sm:h-4 sm:w-4 text-red-400" />
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
      <td className="py-3 sm:py-4 px-3 sm:px-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className={`rounded-lg p-1 sm:p-1.5 shrink-0 ${feature.highlight ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
            <feature.icon className="h-3 w-3 sm:h-4 sm:w-4" />
          </div>
          <div className="min-w-0">
            <div className={`flex flex-wrap items-center gap-1.5 text-xs sm:text-sm font-medium leading-tight ${feature.highlight ? "text-primary" : "text-foreground"}`}>
              <span>{feature.name}</span>
              {feature.highlight && (
                <Badge variant="outline" className="text-[8px] sm:text-[10px] py-0 px-1 sm:px-1.5 border-primary/30 text-primary">Key</Badge>
              )}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block truncate">{feature.description}</p>
          </div>
        </div>
      </td>
      <td className="py-3 sm:py-4 px-2 sm:px-4 text-center">
        {typeof feature.letsAssist === "boolean" ? (
          feature.letsAssist ? <AnimatedCheck delay={delay + 0.1} /> : <AnimatedX delay={delay + 0.1} />
        ) : (
          <motion.span
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: delay + 0.1 }}
            className="text-[10px] sm:text-xs font-medium text-primary"
          >
            {feature.letsAssist}
          </motion.span>
        )}
      </td>
      <td className="py-3 sm:py-4 px-2 sm:px-4 text-center">
        {typeof feature.signupGenius === "boolean" ? (
          feature.signupGenius ? <AnimatedCheck delay={delay + 0.15} /> : <AnimatedX delay={delay + 0.15} />
        ) : (
          <motion.span
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: delay + 0.15 }}
            className="text-[10px] sm:text-xs text-muted-foreground"
          >
            {feature.signupGenius}
          </motion.span>
        )}
      </td>
    </motion.tr>
  );
}

export default function ComparisonSection() {
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const visibleFeatures = showAllFeatures ? comparisonFeatures : comparisonFeatures.slice(0, 6);

  return (
    <section id="comparison" className="py-16 sm:py-24 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-linear-to-b from-background via-muted/20 to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.05),transparent_70%)]" />

      <div className="container relative mx-auto px-4 sm:px-6">
        {/* Section header with text flip */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mx-auto max-w-4xl mb-12 sm:mb-16"
        >
          <div className="space-y-1 sm:space-y-2">
            <h2 className="font-overusedgrotesk text-xl xs:text-2xl sm:text-3xl md:text-4xl lg:text-5xl tracking-tight font-bold">
              SignUpGenius is <TextFlip words={flipWords} />
            </h2>
            <h2 className="font-overusedgrotesk text-xl xs:text-2xl sm:text-3xl md:text-4xl lg:text-5xl tracking-tight font-bold">
              <span className="text-transparent bg-linear-to-r from-primary via-emerald-500 to-primary bg-clip-text bg-size-[200%_auto] animate-gradient">
                Let&apos;s Assist is built for today.
              </span>
            </h2>
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="mt-4 sm:mt-6 text-sm sm:text-base lg:text-lg text-muted-foreground max-w-2xl mx-auto px-4"
          >
            Stop using a tool designed for potlucks to manage your volunteer program. 
            Modern hour tracking, auto-certificates, and compliance-ready reports — <span className="text-primary font-medium">completely free</span>.
          </motion.p>
        </motion.div>

        {/* Side-by-side comparison mockups */}
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 max-w-6xl mx-auto mb-12 sm:mb-20 items-center">
          <div className="order-2 lg:order-1">
            <OutdatedMockup />
          </div>
          <div className="order-1 lg:order-2">
            <ModernDashboardMockup />
          </div>
        </div>

        {/* Stats banner
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto mb-16"
        >
          <div className="grid grid-cols-3 gap-4 sm:gap-8 p-6 sm:p-8 rounded-2xl bg-linear-to-r from-primary/10 via-emerald-500/10 to-primary/10 border border-primary/20">
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
        </motion.div> */}

        {/* Feature comparison table */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mx-auto max-w-4xl mb-12 sm:mb-16"
        >
          <Card className="overflow-hidden border-border/60 shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="py-3 sm:py-4 px-3 sm:px-4 text-left text-xs sm:text-sm font-semibold text-foreground">Feature</th>
                    <th className="py-3 sm:py-4 px-2 sm:px-4 text-center w-20 sm:w-28">
                      <div className="flex flex-col items-center gap-0.5 sm:gap-1">
                        <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                          <Image
                            src="/logo.png"
                            alt="Let's Assist"
                            width={24}
                            height={24}
                            className="opacity-90 w-5 h-5 sm:w-6 sm:h-6"
                          />
                        </div>
                        <span className="text-[10px] sm:text-xs font-medium text-primary">Let&apos;s Assist</span>
                      </div>
                    </th>
                    <th className="py-3 sm:py-4 px-2 sm:px-4 text-center w-20 sm:w-28">
                      <div className="flex flex-col items-center gap-0.5 sm:gap-1">
                        <Image 
                          src="/signupgenius.jpg" 
                          alt="SignUpGenius" 
                          width={24} 
                          height={24} 
                          className="rounded-lg opacity-60 w-5 h-5 sm:w-6 sm:h-6"
                        />
                        <span className="text-[10px] sm:text-xs font-medium text-muted-foreground">SignUpGenius</span>
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
              <div className="p-3 sm:p-4 text-center border-t border-border/50 bg-muted/20">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllFeatures(true)}
                  className="text-primary hover:text-primary/80 hover:bg-primary/10 text-xs sm:text-sm"
                >
                  Show all {comparisonFeatures.length} features
                  <ArrowRight className="ml-1 h-3 w-3 sm:h-4 sm:w-4" />
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
          className="mb-12 sm:mb-16"
        >
          <h3 className="text-center text-lg sm:text-xl md:text-2xl font-semibold mb-6 sm:mb-8 px-4">
            Built for <span className="text-primary">real</span> volunteer management
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 max-w-5xl mx-auto">
            {switchReasons.map((reason, i) => (
              <motion.div
                key={reason.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
              >
                <Card className="h-full border-border/60 bg-background/80 backdrop-blur-xs hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
                  <CardContent className="p-4 sm:p-5">
                    <div className="mb-2 sm:mb-3 inline-flex rounded-lg sm:rounded-xl bg-linear-to-br from-primary/20 to-emerald-500/20 p-2 sm:p-3 text-primary">
                      <reason.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                    <h4 className="text-sm sm:text-base font-semibold text-foreground mb-1.5 sm:mb-2">{reason.title}</h4>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{reason.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Pricing comparison */}
        {/* <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto mb-16"
        >
          <Card className="border-primary/30 bg-linear-to-br from-primary/5 via-background to-emerald-500/5 overflow-hidden shadow-xl">
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
                className="mt-6 p-4 rounded-xl bg-linear-to-r from-primary/15 to-emerald-500/15 border border-primary/20"
              >
                <p className="text-sm text-foreground font-medium">
                  🎉 Everything you need for volunteer management, <span className="text-primary">completely free</span>. No hidden fees, no premium tiers, no ads.
                </p>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div> */}

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center px-4"
        >
          <div className="inline-flex flex-col sm:flex-row gap-2 sm:gap-3 items-center w-full sm:w-auto">
            <Button asChild size="lg" className="gap-2 px-6 sm:px-8 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-shadow w-full sm:w-auto">
              <Link href="/signup">
                Start for free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 hover:bg-primary/5 w-full sm:w-auto">
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
            className="mt-4 sm:mt-6 text-xs sm:text-sm text-muted-foreground"
          >
            No credit card • Free forever • Switch in minutes
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
