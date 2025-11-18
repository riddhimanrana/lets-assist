"use client";

import { Button } from "@/components/ui/button";
import { HoverGradientButton } from "@/components/effects/HoverGradientButton";
import { HeartHandshake } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

export const CallToAction = () => {
  return (
    <section className="py-20 relative overflow-hidden">
      {/* Enhanced background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-muted/30 to-muted/80"></div>
      
      {/* Show accent circle only on desktop */}
      {/* <div className="hidden md:block absolute -left-24 bottom-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl"></div> */}
      {/* <div className="absolute -right-20 top-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl animate-pulse-slow"></div> */}

      <div className="container relative mx-auto ">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-8 max-w-3xl mx-auto px-4"
        >
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/40 to-emerald-500/40 rounded-full blur-xl animate-pulse-slow"></div>
            <HeartHandshake className="w-16 h-16 text-primary mx-auto relative z-10" />
          </div>
          
          <h2 className="text-3xl md:text-4xl font-bold bg-clip-text">
            Who will you help today?
          </h2>
                    <p className="text-sm sm:text-base text-muted-foreground">
            Every small act of kindness creates ripples of change in our
            community. Start your volunteering journey today.
          </p>
          
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <Link href="/signup">
              <Button size="lg" className="px-8 rounded-full">
                Make a Difference
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};
