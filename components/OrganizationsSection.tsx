"use client";

import { Button } from "@/components/ui/button";
import { Building2, Users2, BarChart, Shield } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

export const OrganizationsSection = () => {
  return (
    <section className="py-16 sm:py-24 bg-muted/30">
      <div className="container px-4 sm:px-6 mx-auto">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6"
          >
            <div className="p-4 sm:p-6 bg-background rounded-xl shadow-sm">
              <Building2 className="w-6 h-6 sm:w-8 sm:h-8 text-primary mb-3 sm:mb-4" />
              <h3 className="font-semibold mb-2 text-sm sm:text-base">Streamlined Management</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">Efficiently manage events and volunteer coordination</p>
            </div>
            <div className="p-4 sm:p-6 bg-background rounded-xl shadow-sm">
              <Users2 className="w-6 h-6 sm:w-8 sm:h-8 text-primary mb-3 sm:mb-4" />
              <h3 className="font-semibold mb-2 text-sm sm:text-base">Volunteer Database</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">Access a pool of verified and eager volunteers</p>
            </div>
            <div className="p-4 sm:p-6 bg-background rounded-xl shadow-sm">
              <BarChart className="w-6 h-6 sm:w-8 sm:h-8 text-primary mb-3 sm:mb-4" />
              <h3 className="font-semibold mb-2 text-sm sm:text-base">Analytics & Insights</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">Track impact and engagement metrics</p>
            </div>
            <div className="p-4 sm:p-6 bg-background rounded-xl shadow-sm">
              <Shield className="w-6 h-6 sm:w-8 sm:h-8 text-primary mb-3 sm:mb-4" />
              <h3 className="font-semibold mb-2 text-sm sm:text-base">Verified Platform</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">Join a trusted network of organizations</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="lg:pl-8"
          >
            <span className="text-primary font-semibold mb-2 block text-sm sm:text-base">FOR ORGANIZATIONS</span>
            <h2 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6">Connect with Passionate Volunteers</h2>
            <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-8">
              Join our network of non-profits and local organizations to find dedicated volunteers. 
              Our platform helps you manage events, track participation, and make a bigger impact in your community.
            </p>
            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center gap-2 text-xs sm:text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                <span>Easy event creation and management</span>
              </div>
              <div className="flex items-center gap-2 text-xs sm:text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                <span>Automatic hour verification and reporting</span>
              </div>
              <div className="flex items-center gap-2 text-xs sm:text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                <span>Direct communication with volunteers</span>
              </div>
            </div>
            <div className="mt-6 sm:mt-8">
              <Link href="/signup">
                <Button variant="outline" size="lg" className="w-full sm:w-auto">
                  Partner with Us
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};