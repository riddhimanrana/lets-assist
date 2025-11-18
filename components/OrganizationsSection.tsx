"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Users2, ClipboardList, Shield, Sparkles, Workflow, FileCheck2 } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

export const OrganizationsSection = () => {
  const features = [
    { icon: Building2, title: "Unified operations", desc: "Spin up projects, manage rosters, and assign leads in seconds." },
    { icon: Users2, title: "Roles & permissions", desc: "Granular access for directors, staff, and trusted volunteers." },
    { icon: ClipboardList, title: "Evidence in one place", desc: "Pull live reports with signatures, certificates, and audit logs." },
    { icon: Shield, title: "District-grade security", desc: "COPPA, FERPA, and internal review workflows baked in." }
  ];

  return (
    <section id="organizations" className="relative py-20 sm:py-24">
      {/* Extended background gradient that connects to adjacent components */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background z-0"></div>
      
      {/* Show gradient blobs only on desktop */}
      <div className="hidden md:block absolute -top-[40%] -left-[10%] w-[60%] h-[60%] rounded-full bg-gradient-to-br from-primary/10 to-violet-500/20 blur-[120px] animate-blob z-0" />
      <div className="hidden md:block absolute top-[50%] -right-[15%] w-[50%] h-[60%] rounded-full bg-gradient-to-br from-emerald-500/20 to-primary/10 blur-[120px] animate-blob animation-delay-2000 z-0" />
      
      <div className="container px-4 sm:px-6 mx-auto relative z-10">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
                className="group relative overflow-hidden rounded-2xl border border-border/60 bg-background/70 p-6 shadow-sm backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_25px_60px_-40px_rgba(34,197,94,0.55)]"
              >
                <div className="absolute -top-20 right-0 h-40 w-40 rounded-full bg-primary/5 blur-3xl transition-all duration-300 group-hover:bg-primary/10" />
                <feature.icon className="relative z-10 h-7 w-7 text-primary" />
                <h3 className="relative z-10 mt-4 font-overusedgrotesk text-lg text-foreground">
                  {feature.title}
                </h3>
                <p className="relative z-10 mt-2 text-sm text-muted-foreground">
                  {feature.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="lg:pl-8"
          >
            <Badge variant="outline" className="mb-4 inline-flex items-center gap-2 border-primary/40 bg-primary/5 text-primary">
              <Sparkles className="h-4 w-4" />
              District & Nonprofit teams
            </Badge>
            <h2 className="font-overusedgrotesk text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
              Operate every volunteer initiative from one command center.
            </h2>
            <p className="mt-6 rounded-2xl border border-border/60 bg-background/70 p-4 text-sm sm:text-base text-muted-foreground">
              Join the organizations modernizing volunteer engagement. Let&apos;s Assist keeps events, attendance, and compliance in sync so your staff can focus on community impact.
            </p>
            <div className="space-y-3 sm:space-y-4">
              {[
                { icon: Workflow, copy: "Automated rosters, waitlists, and shift reminders." },
                { icon: FileCheck2, copy: "Audit trails and exports trusted by school admins." },
                { icon: Sparkles, copy: "QR verification funnels data into dashboards instantly." }
              ].map((item, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  className="flex items-center gap-3 text-sm"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <item.icon className="h-4 w-4" />
                  </span>
                  <span>{item.copy}</span>
                </motion.div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/signup">
                <Button variant="outline" size="lg" className="w-full sm:w-auto border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground">
                  Partner with Us
                </Button>
              </Link>
              <Link href="#product-demo" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                Watch the platform tour
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
