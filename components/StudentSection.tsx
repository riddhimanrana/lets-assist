"use client";

import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
// import Image from "next/image";
import Link from "next/link";

export const StudentSection = () => {
  return (
    <section className="py-16 sm:py-24 overflow-hidden mx-auto">
      <div className="container px-4 sm:px-6">
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
              <li className="flex items-center gap-2 text-sm sm:text-base">
                <ChevronRight className="text-primary w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                <span>
                  California Scholarship Federation (CSF) requirements
                </span>
              </li>
              <li className="flex items-center gap-2 text-sm sm:text-base">
                <ChevronRight className="text-primary w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                <span>School graduation requirements</span>
              </li>
              <li className="flex items-center gap-2 text-sm sm:text-base">
                <ChevronRight className="text-primary w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                <span>College application portfolios</span>
              </li>
            </ul>
            <div className="pt-2 sm:pt-4">
              <Link href="/signup">
                <Button size="lg" className="w-full sm:w-auto">
                  Start Tracking Hours
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="relative h-[300px] sm:h-[400px] lg:h-[500px] rounded-xl sm:rounded-2xl overflow-hidden bg-gradient-to-br from-primary/10 to-primary/5"
          >
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="w-full max-w-md p-4 sm:p-8 backdrop-blur-sm bg-background/50 rounded-xl shadow-lg">
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex justify-between items-center p-2 sm:p-3 bg-muted rounded-lg text-sm sm:text-base">
                    <span>Total Hours</span>
                    <span className="font-bold">24.5</span>
                  </div>
                  <div className="flex justify-between items-center p-2 sm:p-3 bg-muted rounded-lg text-sm sm:text-base">
                    <span>Completed Events</span>
                    <span className="font-bold">8</span>
                  </div>
                  <div className="flex justify-between items-center p-2 sm:p-3 bg-muted rounded-lg text-sm sm:text-base">
                    <span>Certificate Status</span>
                    <span className="text-primary font-bold">Ready</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
