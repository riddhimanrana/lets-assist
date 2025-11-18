"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock, GraduationCap } from "lucide-react";

export const StudentSection = () => {
  return (
    <section id="hourtracking" className="relative overflow-hidden py-20 sm:py-24">
      {/* Show gradients only on desktop */}
      <div className="hidden md:block absolute top-0 right-0 w-1/3 h-1/3 bg-gradient-to-br from-primary/10 to-violet-500/10 rounded-full blur-3xl -z-10" />
      <div className="hidden md:block absolute bottom-0 left-0 w-1/3 h-1/3 bg-gradient-to-tr from-emerald-500/10 to-primary/10 rounded-full blur-3xl -z-10" />
      
      <div className="container relative z-10 mx-auto px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="space-y-6"
          >
            <Badge variant="outline" className="inline-flex items-center gap-2 border-primary/40 bg-primary/5 text-primary">
              <GraduationCap className="h-4 w-4" />
              Students & CSF Chapters
            </Badge>
            <h2 className="font-overusedgrotesk text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
              Track your impact, earn certificates, stay CSF ready.
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg">
              Meet your community service requirements hassle-free. Our platform
              automatically tracks and verifies your volunteering hours, making
              it perfect for:
            </p>
            <ul className="space-y-3 sm:space-y-4">
              {[
                "California Scholarship Federation (CSF) requirements",
                "School graduation requirements",
                "College application portfolios"
              ].map((item, index) => (
                <motion.li 
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  className="flex items-center gap-2 text-sm sm:text-base"
                >
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                  <span>{item}</span>
                </motion.li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3 pt-2 sm:pt-4">
              <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" />
                Verified hours in <span className="font-semibold text-foreground">under 48h</span>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                <ArrowUpRight className="h-3.5 w-3.5 text-primary" />
                Export to colleges instantly
              </div>
            </div>
            <div className="pt-5">
              <Link href="/signup">
                <Button size="lg" className="w-full sm:w-auto">
                  Start Tracking Hours
                  <ArrowUpRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="relative flex h-full items-center justify-center"
          >
            <div className="relative w-full max-w-[460px] overflow-hidden rounded-3xl border border-border/60 bg-background/70 p-6 shadow-[0_40px_80px_-40px_rgba(34,197,94,0.35)] backdrop-blur">
              <div className="absolute -top-28 right-12 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
              <div className="absolute -bottom-24 left-12 h-48 w-48 rounded-full bg-emerald-400/10 blur-3xl" />
              <div className="relative space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground/70">CSF Progress</p>
                    <p className="font-overusedgrotesk text-3xl text-foreground">84%</p>
                  </div>
                  <Badge variant="secondary" className="rounded-full bg-primary/10 text-primary">
                    Auto-certified
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[{
                    label: "Hours logged",
                    value: "42.5"
                  }, {
                    label: "Events completed",
                    value: "12"
                  }, {
                    label: "Pending approvals",
                    value: "1"
                  }, {
                    label: "Certificates",
                    value: "4 ready"
                  }].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-border/60 bg-background/80 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground/70">{item.label}</p>
                      <p className="mt-1 font-overusedgrotesk text-2xl text-foreground">{item.value}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border border-border/60 bg-primary/10 p-4">
                  <p className="text-xs uppercase tracking-wider text-primary">Next action</p>
                  <p className="mt-2 text-sm text-primary-foreground/90">
                    Certificate for “Beach Cleanup” will auto-publish tomorrow at 9:00 AM.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
