"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Shield, QrCode, Award } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export const NewHero = () => {
  return (
    <section className="container relative w-full overflow-hidden mx-auto px-4">
      <div className="grid place-items-center w-full gap-6 mx-auto py-12 md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center space-y-5 sm:space-y-8 w-full"
        >
          <Badge
            variant="outline"
            className="text-xs sm:text-sm py-2 sm:py-2"
          >
            <span className="mr-2 text-primary">
              <Badge>Enterprise</Badge>
            </span>
            <span>Trusted by 50+ Schools • CSF Approved</span>
          </Badge>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="w-full max-w-screen-md mx-auto text-center px-2"
          >
            <h1 className="text-[2.7rem] sm:text-4xl md:text-5xl lg:text-6xl font-extrabold sm:font-extrabold font-overusedgrotesk tracking-tight leading-[1.1] sm:leading-tight">
              Professional{" "}
              <span className="text-transparent bg-gradient-to-r from-[#4ed247] to-primary bg-clip-text inline-block">
                Volunteer Management
              </span>{" "}
              <span className="inline-block">Platform</span>
            </h1>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="max-w-screen-sm mx-auto text-sm sm:text-base md:text-lg text-muted-foreground px-4 sm:px-2 leading-relaxed"
          >
            Trusted by schools and organizations for automated CSF compliance, QR attendance tracking, verified certificates, and enterprise analytics.
          </motion.p>

          {/* Dynamic Value Props */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="flex flex-wrap justify-center gap-4 text-xs sm:text-sm text-muted-foreground"
          >
            <div className="flex items-center gap-1">
              <Shield className="w-4 h-4 text-primary" />
              <span>Automated CSF compliance</span>
            </div>
            <div className="flex items-center gap-1">
              <QrCode className="w-4 h-4 text-primary" />
              <span>QR attendance tracking</span>
            </div>
            <div className="flex items-center gap-1">
              <Award className="w-4 h-4 text-primary" />
              <span>Verified certificates</span>
            </div>
          </motion.div>

          {/* Persona-specific CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-3 px-4 sm:px-0 w-full"
          >
            <Link href="/signup" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto h-12 px-6 font-semibold text-sm group/arrow shadow-sm hover:shadow-md transform transition-all duration-200 hover:scale-[1.02]">
                Track CSF Hours
                <ArrowRight className="size-4 ml-2 group-hover/arrow:translate-x-1 transition-transform duration-500" />
              </Button>
            </Link>
            <Link href="/organization/create" className="w-full sm:w-auto">
              <Button
                variant="outline"
                className="w-full sm:w-auto h-12 px-6 text-sm hover:bg-secondary/80 transition-colors"
              >
                Manage Volunteers
              </Button>
            </Link>
            <Link href="/projects" className="w-full sm:w-auto">
              <Button
                variant="ghost"
                className="w-full sm:w-auto h-12 px-6 text-sm hover:bg-secondary/50 transition-colors"
              >
                Monitor Students
              </Button>
            </Link>
          </motion.div>
        </motion.div>

        {/* Trust & Stats section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="grid grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 mt-8 sm:mt-12 w-full max-w-4xl px-4"
        >
          <div className="text-center p-3 rounded-lg hover:bg-secondary/50 transition-colors duration-300">
            <h3 className="text-2xl sm:text-3xl font-bold text-primary mb-1">
              50+
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Schools Using Platform
            </p>
          </div>
          <div className="text-center p-3 rounded-lg hover:bg-secondary/50 transition-colors duration-300">
            <h3 className="text-2xl sm:text-3xl font-bold text-primary mb-1">
              1000+
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Verified Certificates Issued
            </p>
          </div>
          <div className="text-center col-span-2 md:col-span-1 p-3 rounded-lg hover:bg-secondary/50 transition-colors duration-300">
            <h3 className="text-2xl sm:text-3xl font-bold text-primary mb-1">
              100%
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              CSF Compliance Rate
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
};