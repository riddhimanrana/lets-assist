"use client";

import dynamic from "next/dynamic";
import { HeroContent } from "./HeroContent";
import { motion } from "framer-motion";

const HeroVideo = dynamic(() => import("./HeroVideo").then((mod) => mod.HeroVideo), {
  ssr: false,
  loading: () => (
    <div className="py-12 sm:py-16">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="mx-auto max-w-5xl aspect-video rounded-xl bg-transparent" />
      </div>
    </div>
  ),
});

export const Hero = () => {
  return (
    <div className="relative isolate overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.12),transparent_65%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-size-[200px_200px]" />
        </div>
        <motion.div
          className="absolute inset-x-[-10%] top-8 h-28 rounded-full bg-linear-to-r from-emerald-300/30 via-primary/20 to-transparent blur-[120px] opacity-25"
          animate={{ x: [0, 40, -20, 0], opacity: [0.25, 0.4, 0.2, 0.25] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute inset-x-[-20%] bottom-24 h-32 rounded-full bg-linear-to-r from-transparent via-primary/15 to-emerald-200/20 blur-[150px] opacity-20"
          animate={{ x: [0, -30, 30, 0], opacity: [0.2, 0.4, 0.2, 0.2] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-x-0 top-6 mx-auto h-32 w-64 rounded-full bg-emerald-400/10 blur-[140px] sm:top-12 sm:h-48 sm:w-80" />
        <div className="absolute inset-x-20 bottom-0 h-48 rounded-full bg-primary/10 blur-[160px]" />
      </div>

      <div className="relative z-10 flex flex-col gap-0">
        <HeroContent />
        <HeroVideo />
      </div>
    </div>
  );
};