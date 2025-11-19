"use client";

import { HeroSection } from "@/components/Hero";
import { LaunchVideoSection } from "@/components/LaunchVideoSection";
import { motion } from "framer-motion";

export const HeroVideoStage = () => {
  return (
    <div className="relative isolate overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 opacity-60">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.06),transparent_65%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:200px_200px]" />
        </div>
        <motion.div
          className="absolute inset-x-[-8%] top-8 h-20 rounded-full bg-gradient-to-r from-emerald-300/30 via-primary/20 to-transparent blur-[80px]"
          animate={{ x: [0, 40, -20, 0], opacity: [0.5, 0.7, 0.4, 0.5] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute inset-x-[-12%] bottom-24 h-24 rounded-full bg-gradient-to-r from-transparent via-primary/16 to-emerald-200/20 blur-[100px]"
          animate={{ x: [0, -30, 30, 0], opacity: [0.35, 0.6, 0.45, 0.35] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-x-0 top-6 mx-auto h-20 w-48 rounded-full bg-emerald-400/12 blur-[100px] sm:top-12 sm:h-36 sm:w-64" />
        <div className="absolute inset-x-20 bottom-0 h-28 rounded-full bg-primary/12 blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col gap-0">
        <HeroSection />
        <LaunchVideoSection />
      </div>
    </div>
  );
};
