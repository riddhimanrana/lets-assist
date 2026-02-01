"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  MousePointer2,
  MapPin,
  CheckCircle,
  Loader2,
  Scan,
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
    <span
      className="inline-flex items-center justify-center"
      style={{ minWidth: "5ch" }}
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={currentIndex}
          initial={{ y: 20, opacity: 0, filter: "blur(8px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: -20, opacity: 0, filter: "blur(8px)" }}
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
          className="text-orange-400 font-bold font-overusedgrotesk"
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
    description:
      "Built-in COPPA compliance, student hour tracking, and certificate automation for service learning.",
  },
  {
    icon: Building2,
    title: "Nonprofit ready",
    description:
      "Audit-ready exports, verified attendance records, and organization-wide reporting at no cost.",
  },
  {
    icon: Heart,
    title: "Volunteer focused",
    description:
      "Personal dashboards, hour tracking, and certificates for applications and resumes.",
  },
];

// Modern dashboard mockup for Let's Assist with Dynamic Workflow

function ModernDashboardMockup() {
  const [phase, setPhase] = useState<
    "BROWSING" | "DETAILS" | "QR" | "NOTIFICATION" | "CERTIFICATE" | "DASHBOARD"
  >("BROWSING");

  // State for dashboard stats to simulate update

  const [stats, setStats] = useState({ hours: 47.5, certs: 8, events: 12 });

  useEffect(() => {
    // Sequence timing

    let timeout: NodeJS.Timeout;

    const runSequence = () => {
      // 1. Browsing -> Click Event

      setPhase("BROWSING");

      timeout = setTimeout(() => {
        setPhase("DETAILS"); // Clicked event

        timeout = setTimeout(() => {
          setPhase("QR"); // Signed up & went to event

          timeout = setTimeout(() => {
            setPhase("NOTIFICATION"); // Scanned & finished

            timeout = setTimeout(() => {
              setPhase("CERTIFICATE"); // Clicked notification

              timeout = setTimeout(() => {
                setPhase("DASHBOARD"); // Closed cert

                setStats({ hours: 51.5, certs: 9, events: 13 }); // Update stats

                timeout = setTimeout(() => {
                  // Reset for loop

                  setStats({ hours: 47.5, certs: 8, events: 12 });

                  runSequence();
                }, 4000); // Stay on dashboard for 4s
              }, 3000); // View cert for 3s
            }, 2500); // View notification for 2.5s
          }, 3000); // Scan QR for 3s
        }, 3000); // View details for 3s
      }, 3500); // Browse for 3.5s
    };

    runSequence();

    return () => clearTimeout(timeout);
  }, []);

  // Cursor Animation Variants

  const cursorVariants = {
    BROWSING: {
      opacity: 1,
      left: ["90%", "50%", "50%"],
      top: ["90%", "45%", "65%"], // Adjusted top to 65% for better alignment with "View Details" button
      scale: [1, 1, 0.9],
      transition: {
        duration: 2,
        times: [0, 0.8, 1],
        delay: 0.5,
        ease: "easeInOut" as const,
      },
    },
    DETAILS: {
      opacity: 1,
      left: ["50%", "25%", "25%", "75%", "75%"],
      top: ["65%", "85%", "85%", "85%", "85%"],
      scale: [1, 1, 0.9, 1, 0.9],
      transition: {
        duration: 2.5,
        times: [0, 0.3, 0.4, 0.8, 1],
        ease: "easeInOut" as const,
      },
    },
    QR: {
      opacity: 0,
      left: "50%",
      top: "50%",
      transition: { duration: 0.2 },
    },
    NOTIFICATION: {
      opacity: 1,
      left: ["90%", "50%", "50%"],
      top: ["90%", "15%", "15%"],
      scale: [1, 1, 0.9],
      transition: {
        duration: 1.5,
        times: [0, 0.8, 1],
        delay: 0.5,
        ease: "easeInOut" as const,
      },
    },
    CERTIFICATE: {
      opacity: 1,
      left: ["50%", "90%"],
      top: ["15%", "90%"],
      transition: { duration: 1, ease: "easeInOut" as const },
    },
    DASHBOARD: {
      opacity: 0,
      transition: { duration: 0.5 },
    },
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: 0.3 }}
      className="relative w-full h-[320px] sm:h-[400px]"
    >
      {/* Glow effect */}

      <div className="absolute -inset-2 sm:-inset-4 bg-linear-to-r from-primary/10 via-info/10 to-primary/10 rounded-2xl sm:rounded-3xl blur-xl sm:blur-2xl opacity-60" />

      <div className="relative w-full h-full rounded-xl sm:rounded-2xl border border-primary/20 bg-background/80 backdrop-blur-md overflow-hidden flex flex-col shadow-2xl">
        {/* Browser chrome */}

        <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-border/40 bg-muted/20 shrink-0 z-20">
          <div className="flex gap-1.5 sm:gap-2">
            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-destructive/60" />

            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-warning/60" />

            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-success/60" />
          </div>

          <div className="flex-1 flex justify-center">
            <div className="px-2 sm:px-4 py-0.5 sm:py-1 rounded-md bg-background/80 text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1 sm:gap-2 transition-all duration-300 w-full max-w-[200px] sm:max-w-xs justify-center">
              <Shield className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-primary shrink-0" />

              <span className="truncate block opacity-70">
                {phase === "BROWSING" && "lets-assist.com/explore"}

                {phase === "DETAILS" && "lets-assist.com/events/cleanup"}

                {phase === "QR" && "lets-assist.com/scan"}

                {phase === "NOTIFICATION" && "lets-assist.com/home"}

                {phase === "CERTIFICATE" && "lets-assist.com/certificates/view"}

                {phase === "DASHBOARD" && "lets-assist.com/home"}
              </span>
            </div>
          </div>
        </div>

        {/* Content Area */}

        <div className="relative flex-1 bg-muted/5 p-4 overflow-hidden">
          <AnimatePresence mode="wait">
            {/* PHASE 1: BROWSING */}

            {phase === "BROWSING" && (
              <motion.div
                key="browsing"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20, scale: 0.95 }}
                className="space-y-3"
              >
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-sm font-semibold">
                    Explore Opportunities
                  </h3>

                  <Badge variant="secondary" className="text-[10px]">
                    Filter
                  </Badge>
                </div>

                <div className="space-y-2">
                  {/* Card 1 */}

                  <div className="p-2.5 rounded-lg border bg-card shadow-xs opacity-60">
                    <div className="h-2 w-1/3 bg-muted rounded mb-2"></div>

                    <div className="h-1.5 w-full bg-muted/50 rounded"></div>
                  </div>

                  {/* Card 2 (Target) */}

                  <div className="p-2.5 rounded-lg border border-primary/40 bg-card shadow-sm relative group">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-xs sm:text-sm">
                        Community Garden Cleanup
                      </span>

                      <Badge className="text-[9px] h-4 bg-primary text-primary-foreground hover:bg-primary/80 dark:bg-primary/30 dark:text-primary-foreground">
                        Open
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-2">
                      <span className="flex items-center gap-0.5">
                        <Calendar className="w-3 h-3" /> Sat, May 12
                      </span>

                      <span className="flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" /> Central Park
                      </span>
                    </div>

                    <Button size="sm" className="w-full h-7 text-[10px]">
                      View Details
                    </Button>
                  </div>

                  {/* Card 3 */}

                  <div className="p-2.5 rounded-lg border bg-card shadow-xs opacity-60">
                    <div className="h-2 w-1/4 bg-muted rounded mb-2"></div>

                    <div className="h-1.5 w-2/3 bg-muted/50 rounded"></div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* PHASE 2: DETAILS */}

            {phase === "DETAILS" && (
              <motion.div
                key="details"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, filter: "blur(4px)" }}
                className="space-y-4 h-full flex flex-col pt-2"
              >
                <div className="h-24 w-full bg-linear-to-r from-success/10 to-primary/10 rounded-lg mb-2 shrink-0 flex items-center justify-center border border-primary/10">
                  <Building2 className="w-8 h-8 text-primary/40" />
                </div>

                <div className="shrink-0">
                  <h2 className="text-lg font-bold">
                    Community Garden Cleanup
                  </h2>

                  <p className="text-xs text-muted-foreground mt-1">
                    Help us prepare the garden for spring planting! Tools
                    provided.
                  </p>
                </div>

                <div className="mt-auto grid grid-cols-2 gap-2 pb-2">
                  <motion.div
                    animate={{ scale: [1, 0.95, 1] }}
                    transition={{ delay: 1.0, duration: 0.3 }}
                    className="w-full"
                  >
                    <Button
                      variant="outline"
                      className="w-full h-8 text-xs gap-1.5"
                    >
                      <Image
                        src="/googlecalendar.svg"
                        width={12}
                        height={12}
                        alt="GCal"
                      />
                      Add to Calendar
                    </Button>
                  </motion.div>

                  <motion.div
                    animate={{ scale: [1, 0.95, 1] }}
                    transition={{ delay: 2.2, duration: 0.3 }}
                    className="w-full"
                  >
                    <Button className="w-full h-8 text-xs">Sign Up Now</Button>
                  </motion.div>
                </div>
              </motion.div>
            )}

            {/* PHASE 3: QR SCAN */}
            {phase === "QR" && (
              <motion.div
                key="qr"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full relative"
              >
                {/* Scanner Frame */}
                <div className="relative w-[180px] h-[220px] rounded-2xl border border-border/60 bg-card shadow-lg overflow-hidden flex flex-col">
                  {/* Camera feed simulation */}
                  <div className="absolute inset-0 bg-muted/50 flex items-center justify-center">
                    <div className="w-32 h-32 border-2 border-primary/50 rounded-lg relative overflow-hidden bg-background/20 backdrop-blur-xs">
                      {/* Corner markers */}
                      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary"></div>
                      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary"></div>
                      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary"></div>
                      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-primary"></div>

                      {/* QR Code */}
                      <QrCode className="w-full h-full p-4 text-foreground/20" />

                      {/* Scanning Line */}
                      <motion.div
                        animate={{ top: ["0%", "100%", "0%"] }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                        className="absolute left-0 w-full h-0.5 bg-primary shadow-[0_0_8px_1px_rgba(var(--primary),0.5)] z-10"
                      />
                    </div>
                  </div>

                  {/* Scanning Indicator */}
                  <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                    <div className="px-3 py-1 rounded-full bg-background/80 backdrop-blur-md border border-border/50 text-[10px] flex items-center gap-1.5 shadow-sm">
                      <Scan className="w-3 h-3 text-primary animate-pulse" />
                      <span>Scanning...</span>
                    </div>
                  </div>
                </div>

                {/* Success Pop at end of phase */}
                <motion.div
                  initial={{ scale: 0.9, opacity: 0, y: 10 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  transition={{ delay: 1.5, type: "spring" }}
                  className="absolute bottom-8 right-8 z-20"
                >
                  <div className="bg-primary text-primary-foreground px-3 py-2 rounded-lg shadow-xl flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    <span className="font-bold text-xs">Checked In!</span>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* PHASE 4: NOTIFICATION */}

            {phase === "NOTIFICATION" && (
              <motion.div
                key="notification"
                className="h-full relative bg-muted/30"
              >
                {/* Fake Dashboard BG */}

                <div className="opacity-20 pointer-events-none filter blur-[1px]">
                  <div className="h-8 w-1/3 bg-foreground/10 rounded mb-4" />

                  <div className="grid grid-cols-3 gap-2">
                    <div className="h-20 bg-foreground/10 rounded" />

                    <div className="h-20 bg-foreground/10 rounded" />

                    <div className="h-20 bg-foreground/10 rounded" />
                  </div>
                </div>

                {/* Notification Dropdown */}

                <motion.div
                  initial={{ y: -50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="absolute top-2 right-2 left-2 sm:right-auto sm:w-80 bg-background border border-border shadow-lg rounded-lg p-3 z-30 flex gap-3 items-start cursor-pointer hover:bg-accent transition-colors"
                >
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Award className="w-4 h-4 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">Certificate Earned!</p>

                    <p className="text-xs text-muted-foreground line-clamp-2">
                      "Community Garden Cleanup" hours verified. Click to view.
                    </p>
                  </div>

                  <div className="h-2 w-2 rounded-full bg-info mt-1.5 shrink-0" />
                </motion.div>
              </motion.div>
            )}

            {/* PHASE 5: CERTIFICATE */}
            {phase === "CERTIFICATE" && (
              <motion.div
                key="certificate"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center justify-center h-full p-4"
              >
                <div className="bg-card text-card-foreground p-1 rounded-lg shadow-2xl w-full max-w-sm relative">
                  {/* Decorative Border */}
                  <div className="border-[6px] border-double border-primary/20 rounded-md p-4 sm:p-6 bg-background relative overflow-hidden h-full flex flex-col items-center text-center">
                    {/* Watermark */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
                      <Award className="w-32 h-32" />
                    </div>

                    <div className="relative z-10 space-y-3">
                      <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-1">
                        <Award className="w-6 h-6 text-primary" />
                      </div>

                      <div className="space-y-1">
                        <h2 className="font-serif text-lg sm:text-xl font-bold tracking-wider text-primary">
                          CERTIFICATE
                        </h2>
                        <p className="text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground">
                          of volunteer service
                        </p>
                      </div>

                      <div className="py-3 w-full border-b border-border">
                        <p className="text-base sm:text-lg font-serif italic">
                          Riddhiman Rana
                        </p>
                      </div>

                      <p className="text-[10px] sm:text-xs text-muted-foreground leading-relaxed">
                        For completing{" "}
                        <span className="font-bold text-foreground">
                          4 hours
                        </span>{" "}
                        of service at
                        <br />
                        <span className="font-semibold text-foreground">
                          Community Garden Cleanup
                        </span>
                      </p>

                      <div className="pt-4 w-full flex justify-between items-end opacity-60">
                        <div className="text-[8px] font-mono">ID: 98723-AZ</div>
                        <div className="text-[8px] font-mono">Verified</div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* PHASE 6: DASHBOARD */}

            {phase === "DASHBOARD" && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
                {/* Header */}

                <div className="flex items-start sm:items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm sm:text-base md:text-lg font-semibold text-foreground truncate">
                      Welcome back, Riddhiman!
                    </h4>

                    <p className="text-xs sm:text-sm text-muted-foreground">
                      Your volunteer impact
                    </p>
                  </div>

                  <Badge className="bg-primary/15 text-primary border-0 text-[10px] sm:text-xs shrink-0 animate-pulse">
                    <TrendingUp className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5 sm:mr-1" />
                    Stats Updated
                  </Badge>
                </div>

                {/* Stats cards */}

                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {[
                    {
                      label: "Hours",

                      value: stats.hours,

                      icon: Clock,

                      color: "text-primary",
                    },

                    {
                      label: "Certificates",

                      value: stats.certs,

                      icon: Award,

                      color: "text-warning", // Updated from chart-2
                    },

                    {
                      label: "Events",

                      value: stats.events,

                      icon: Calendar,

                      color: "text-info", // Updated from chart-3
                    },
                  ].map((stat, i) => (
                    <motion.div
                      key={stat.label}
                      layout
                      initial={{ scale: 0.9 }}
                      animate={{ scale: 1 }}
                      className="rounded-lg sm:rounded-xl border border-border/60 bg-card/50 p-2 sm:p-3 text-center"
                    >
                      <stat.icon
                        className={`w-3 h-3 sm:w-4 sm:h-4 mx-auto mb-0.5 sm:mb-1 ${stat.color}`}
                      />

                      <div className="text-base sm:text-lg md:text-xl font-bold text-foreground">
                        {stat.value}
                      </div>

                      <div className="text-[9px] sm:text-[10px] text-muted-foreground">
                        {stat.label}
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Recent Activity List */}

                <div className="space-y-2 pt-1">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                    Recent Activity
                  </p>

                  <div className="flex items-center gap-2 p-2 rounded bg-primary/5 border border-primary/10">
                    <CheckCircle className="w-3 h-3 text-success" />

                    <span className="text-[10px] sm:text-xs">
                      Completed{" "}
                      <span className="font-medium">Community Cleanup</span>
                    </span>

                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Just now
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Continuous Cursor - Moved outside AnimatePresence */}

          <motion.div
            animate={phase}
            variants={cursorVariants}
            className="absolute top-0 left-0 z-50 pointer-events-none"
            initial={false}
          >
            <MousePointer2 className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white fill-black dark:fill-white drop-shadow-md" />
          </motion.div>
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
              <div className="text-xs sm:text-sm font-medium text-muted-foreground">
                SignUpGenius
              </div>
              <div className="text-[9px] sm:text-[10px] text-muted-foreground/60">
                Founded 2007
              </div>
            </div>
          </div>

          {/* Fake Top Banner Ad */}
          <div className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-1.5 sm:p-2 text-center overflow-hidden relative">
            <div className="text-[8px] text-gray-400 absolute top-0.5 right-1">
              AD
            </div>
            <span className="text-[9px] sm:text-[10px] font-bold text-info animate-pulse">
              Start Your Free Trial Today! &gt;&gt;
            </span>
          </div>

          <div className="flex gap-2">
            {/* Old table-style layout */}
            <div className="flex-1 border border-muted-foreground/30 rounded overflow-hidden">
              <div className="bg-orange-100 dark:bg-orange-900/30 px-2 sm:px-3 py-1.5 sm:py-2 border-b border-muted-foreground/30">
                <div className="text-[10px] sm:text-xs font-medium text-muted-foreground">
                  Volunteer Signup Sheet
                </div>
              </div>
              <div className="divide-y divide-muted-foreground/20">
                {[
                  "9:00 AM - Setup",
                  "10:00 AM - Registration",
                  "11:00 AM - Food",
                ].map((slot, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs text-muted-foreground"
                  >
                    <span className="truncate">{slot}</span>
                    <span className="text-[9px] sm:text-[10px] bg-gray-200 dark:bg-gray-700 px-1.5 sm:px-2 py-0.5 rounded shrink-0 ml-2">
                      3/5
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Fake Side Ad */}
            <div className="w-16 sm:w-20 hidden xs:flex flex-col gap-1 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-1 rounded">
              <div className="text-[7px] text-gray-400 text-center w-full border-b border-gray-300 dark:border-gray-600 pb-0.5">
                AD
              </div>
              <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-black/20 rounded border border-dashed border-gray-300 dark:border-gray-600 p-0.5">
                <div className="w-4 h-4 sm:w-6 sm:h-6 rounded-full bg-orange-500/20 mb-1" />
                <div className="text-[7px] sm:text-[8px] text-center leading-tight text-gray-500">
                  Buy Now
                </div>
              </div>
            </div>
          </div>

          {/* Missing features callout */}
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            {["No hours", "No certs", "No QR", "Ads"].map((missing, i) => (
              <motion.div
                key={missing}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.8 + i * 0.1 }}
                className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground/70"
              >
                <X className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-destructive shrink-0" />
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
        className="absolute -bottom-2 -right-2 sm:-bottom-3 sm:-right-3 px-2 sm:px-3 py-1 rounded-full bg-orange-500 text-white text-[10px] sm:text-xs font-medium shadow-lg"
      >
        2010 design 📟
      </motion.div>
    </motion.div>
  );
}

// Animated counter for stats
function AnimatedCounter({
  value,
  suffix = "",
}: {
  value: number;
  suffix?: string;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = value;
    if (start === end) return;

    let totalMiliseconds = 1500;
    let incrementTime = (totalMiliseconds / end) * 2;

    let timer = setInterval(() => {
      start += 1;
      setCount(start);
      if (start === end) clearInterval(timer);
    }, incrementTime);

    return () => clearInterval(timer);
  }, [value]);

  return (
    <span>
      {count}
      {suffix}
    </span>
  );
}

// Animated checkmark component
function AnimatedCheck({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      whileInView={{ scale: 1, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ delay, type: "spring", stiffness: 400, damping: 15 }}
      className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/20 mx-auto"
    >
      <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-500 stroke-[2.5]" />
    </motion.div>
  );
}

function AnimatedX({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      whileInView={{ scale: 1, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ delay, type: "spring", stiffness: 400, damping: 15 }}
      className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-rose-500/10 ring-1 ring-rose-500/20 mx-auto"
    >
      <X className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-rose-500 stroke-[2.5]" />
    </motion.div>
  );
}

// Feature comparison row
function ComparisonRow({
  feature,
  index,
}: {
  feature: ComparisonFeature;
  index: number;
}) {
  const delay = index * 0.05;

  return (
    <motion.tr
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.3 }}
      className={`border-b border-border/40 group hover:bg-muted/30 transition-colors ${feature.highlight ? "bg-primary/5 hover:bg-primary/10" : ""}`}
    >
      <td className="py-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div
            className={`rounded-lg p-2 shrink-0 ${feature.highlight ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            <feature.icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-medium ${feature.highlight ? "text-foreground" : "text-muted-foreground group-hover:text-foreground transition-colors"}`}>
                {feature.name}
              </span>
              {feature.highlight && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-4 px-1.5 border-primary/30 text-primary bg-primary/5 rounded-full"
                >
                  Key
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground/80 truncate mt-0.5 font-medium">
              {feature.description}
            </p>
          </div>
        </div>
      </td>
      <td className="py-4 px-4 text-center bg-primary/[0.02]">
        {typeof feature.letsAssist === "boolean" ? (
          feature.letsAssist ? (
            <AnimatedCheck delay={delay + 0.1} />
          ) : (
            <AnimatedX delay={delay + 0.1} />
          )
        ) : (
          <motion.span
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: delay + 0.1 }}
            className="text-xs sm:text-sm font-semibold text-primary"
          >
            {feature.letsAssist}
          </motion.span>
        )}
      </td>
      <td className="py-4 px-4 text-center">
        {typeof feature.signupGenius === "boolean" ? (
          feature.signupGenius ? (
            <AnimatedCheck delay={delay + 0.15} />
          ) : (
            <AnimatedX delay={delay + 0.15} />
          )
        ) : (
          <motion.span
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: delay + 0.15 }}
            className="text-xs sm:text-sm text-muted-foreground font-medium"
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

  // Always show the first 6, others are conditional
  const initialFeatures = comparisonFeatures.slice(0, 6);
  const hiddenFeatures = comparisonFeatures.slice(6);

  return (
    <section
      id="comparison"
      className="py-12 sm:py-20 relative overflow-hidden"
    >
      {/* Background gradient */}
      <div className="absolute inset-0 bg-linear-to-b from-background via-muted/20 to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.03),transparent_70%)]" />

      <div className="container relative mx-auto px-4 sm:px-6">
        {/* Section header with text flip */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mx-auto max-w-4xl mb-10 sm:mb-14"
        >
          <div className="space-y-1 sm:space-y-2">
            <h2 className="font-overusedgrotesk text-[1.7rem] sm:text-3xl md:text-4xl lg:text-5xl tracking-tight font-bold">
              SignUpGenius is <TextFlip words={flipWords} />
            </h2>
            <h2 className="font-overusedgrotesk text-[1.7rem] sm:text-3xl md:text-4xl lg:text-5xl tracking-tight font-bold">
              <span className="text-transparent bg-linear-to-r from-primary via-chart-2 to-primary bg-clip-text bg-size-[200%_auto] animate-gradient">
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
            Stop using a tool designed for potlucks to manage your volunteer
            program. Modern hour tracking, auto-certificates, and
            compliance-ready reports —{" "}
            <span className="text-primary font-medium">completely free</span>.
          </motion.p>
        </motion.div>

        {/* Side-by-side comparison mockups */}
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 max-w-6xl mx-auto mb-16 sm:mb-20 items-center">
          <div className="order-2 lg:order-1 transform hover:scale-[1.02] transition-transform duration-500">
            <OutdatedMockup />
          </div>
          <div className="order-1 lg:order-2 transform hover:scale-[1.02] transition-transform duration-500">
            <ModernDashboardMockup />
          </div>
        </div>

        {/* Feature comparison table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mx-auto max-w-5xl mb-12"
        >
          <Card className="overflow-hidden border-border/60 shadow-2xl bg-card/50 backdrop-blur-sm ring-1 ring-border/50">
            <div className="p-1">
              <div className="overflow-x-auto rounded-lg">
                <table className="w-full min-w-[600px] border-collapse">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border/60">
                      <th className="py-6 px-6 text-left w-[40%]">
                        <span className="text-lg font-bold tracking-tight">Feature Comparison</span>
                      </th>
                      <th className="py-6 px-4 text-center w-[30%] bg-primary/[0.03]">
                        <div className="flex flex-col items-center gap-2">
                          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shadow-inner ring-1 ring-primary/20">
                            <span className="text-xl">✋</span>
                          </div>
                          <span className="text-sm font-bold text-primary tracking-tight">
                            Let&apos;s Assist
                          </span>
                        </div>
                      </th>
                      <th className="py-6 px-4 text-center w-[30%]">
                        <div className="flex flex-col items-center gap-2 opacity-80 mix-blend-luminosity hover:mix-blend-normal transition-all duration-300">
                          <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center shadow-inner ring-1 ring-border">
                            <span className="text-xl">💡</span>
                          </div>
                          <span className="text-sm font-semibold text-muted-foreground tracking-tight">
                            SignUpGenius
                          </span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-card">
                    {initialFeatures.map((feature, i) => (
                      <ComparisonRow
                        key={feature.name}
                        feature={feature}
                        index={i}
                      />
                    ))}

                    <AnimatePresence>
                      {showAllFeatures && (
                        hiddenFeatures.map((feature, i) => (
                          <ComparisonRow
                            key={feature.name}
                            feature={feature}
                            index={i + 6}
                          />
                        ))
                      )}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>

            {!showAllFeatures && comparisonFeatures.length > 6 && (
              <div className="relative">
                <div className="absolute inset-x-0 -top-24 h-24 bg-linear-to-b from-transparent to-card pointer-events-none" />
                <div className="p-6 text-center border-t border-border/40 bg-card relative z-10">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setShowAllFeatures(true)}
                    className="group gap-2 px-8 rounded-full border-primary/20 hover:border-primary/50 hover:bg-primary/5 text-primary transition-all duration-300 shadow-sm"
                  >
                    Show all features
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </motion.div>

        {/* Bottom CTA Section - Replaced switching cards with direct CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center px-4"
        >
          <div className="inline-flex flex-col sm:flex-row gap-2 sm:gap-3 items-center w-full sm:w-auto">
            <Link
              href="/signup"
              className={cn(
                buttonVariants({
                  size: "lg",
                  className:
                    "gap-2 px-8 h-12 rounded-full shadow-xl shadow-primary/20 hover:shadow-primary/30 transition-all w-full sm:w-auto text-base",
                }),
              )}
            >
              Start for free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/projects"
              className={cn(
                buttonVariants({
                  variant: "ghost",
                  size: "lg",
                  className: "gap-2 h-12 rounded-full hover:bg-muted w-full sm:w-auto text-base text-muted-foreground hover:text-foreground",
                }),
              )}
            >
              See examples
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
