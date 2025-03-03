"use client";

import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

export const StudentSection = () => {
  return (
    <section className="py-16 sm:py-24 overflow-hidden mx-auto relative">
      {/* Show gradients only on desktop */}
      <div className="hidden md:block absolute top-0 right-0 w-1/3 h-1/3 bg-gradient-to-br from-primary/10 to-violet-500/10 rounded-full blur-3xl -z-10" />
      <div className="hidden md:block absolute bottom-0 left-0 w-1/3 h-1/3 bg-gradient-to-tr from-emerald-500/10 to-primary/10 rounded-full blur-3xl -z-10" />
      
      <div className="container px-4 sm:px-6 relative z-10">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="space-y-4 sm:space-y-6"
          >
            <h2 className="text-2xl sm:text-3xl font-bold leading-tight">
              High School Students & CSF Members
              <span className="block text-primary mt-2">
                Track Your Hours with Ease
              </span>
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
                  className="flex items-center gap-2 text-sm sm:text-base group"
                >
                  <span className="text-primary w-5 h-5 flex-shrink-0 rounded-full bg-gradient-to-br from-primary/20 to-emerald-500/20 flex items-center justify-center group-hover:from-primary/30 group-hover:to-emerald-500/30 transition-all duration-300">
                    <ChevronRight className="w-3 h-3" />
                  </span>
                  <span>{item}</span>
                </motion.li>
              ))}
            </ul>
            <div className="pt-2 sm:pt-4">
              <Link href="/signup">
                <Button size="lg" className="w-full sm:w-auto">
                  Start Tracking Hours
                  <ChevronRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="relative h-[300px] sm:h-[400px] lg:h-[500px] rounded-xl sm:rounded-2xl overflow-hidden"
          >
            {/* Animated gradient background that aligns with previous sections */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/0 via-emerald-500/0 to-violet-500/0 animate-gradient-slow"></div>
            
            {/* Floating accent elements with increased size */}
            <div className="absolute top-10 left-10 w-40 h-40 bg-primary/0 rounded-full blur-xl animate-float"></div>
            <div className="absolute bottom-20 right-10 w-48 h-48 bg-violet-500/0 rounded-full blur-xl animate-float animation-delay-2000"></div>
            
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="w-full max-w-md p-4 sm:p-8 backdrop-blur-md bg-background/90 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all duration-300">
                <div className="space-y-3 sm:space-y-4">
                  {[
                    { label: "Total Hours", value: "24.5" },
                    { label: "Completed Events", value: "8" },
                    { label: "Certificate Status", value: "Ready", highlight: true }
                  ].map((item, index) => (
                    <motion.div 
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.3, delay: 0.5 + (index * 0.1) }}
                      className="flex justify-between items-center p-2 sm:p-3 bg-gradient-to-r from-muted to-muted/50 hover:from-muted/80 hover:to-muted/30 rounded-lg text-sm sm:text-base transition-all duration-300"
                    >
                      <span>{item.label}</span>
                      <span className={`font-bold ${item.highlight ? 'text-transparent bg-gradient-to-r from-primary to-emerald-500 bg-clip-text' : ''}`}>
                        {item.value}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
