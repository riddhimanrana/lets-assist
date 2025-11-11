"use client";

import { Button } from "@/components/ui/button";
import { Building2, Users2, ClipboardList, Shield } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

export const OrganizationsSection = () => {
  const features = [
    { icon: Building2, title: "Streamlined Management", desc: "Efficiently manage events and volunteer coordination" },
    { icon: Users2, title: "Volunteer Database", desc: "Access a pool of verified and eager volunteers" },
    { icon: ClipboardList, title: "Member Data Access", desc: "Easily view and export volunteer hours and participation" },
    { icon: Shield, title: "Verified Platform", desc: "Join a trusted network of organizations" }
  ];

  return (
    <section id="organizations" className="py-16 sm:py-24 relative">
      {/* Extended background gradient that connects to adjacent components */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background z-0"></div>
      
      {/* Show gradient blobs only on desktop */}
      <div className="hidden md:block absolute -top-[40%] -left-[10%] w-[60%] h-[60%] rounded-full bg-gradient-to-br from-primary/10 to-violet-500/20 blur-[120px] animate-blob z-0" />
      <div className="hidden md:block absolute top-[50%] -right-[15%] w-[50%] h-[60%] rounded-full bg-gradient-to-br from-emerald-500/20 to-primary/10 blur-[120px] animate-blob animation-delay-2000 z-0" />
      
      <div className="container px-4 sm:px-6 mx-auto relative z-10">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6"
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
                className="p-4 sm:p-6 bg-background/60 backdrop-blur-sm rounded-xl shadow-sm border border-white/5 hover:border-primary/20 group hover:shadow-md transition-all duration-300"
              >
                <div className="relative inline-block mb-3 sm:mb-4">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-emerald-500/30 rounded-full blur-md group-hover:blur-lg transition-all duration-300"></div>
                  <feature.icon className="w-6 h-6 sm:w-8 sm:h-8 text-primary relative z-10" />
                </div>
                <h3 className="font-semibold mb-2 text-sm sm:text-base group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-primary group-hover:to-emerald-500 group-hover:bg-clip-text transition-all duration-300">
                  {feature.title}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
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
            <motion.span 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3 }}
              className="text-transparent bg-gradient-to-r from-primary via-emerald-500 to-primary bg-clip-text animate-gradient bg-size-200 font-semibold mb-2 block text-sm sm:text-base"
            >
              FOR ORGANIZATIONS
            </motion.span>
            <h2 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6">
              Connect with Passionate Volunteers
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-8 backdrop-blur-sm bg-background/0 p-3 rounded-xl">
              Join our network of non-profits and local organizations to find
              dedicated volunteers. Our platform helps you manage events, track
              participation, and make a bigger impact in your community.
            </p>
            <div className="space-y-3 sm:space-y-4">
              {[
                "Easy event creation and management",
                "Automatic hour verification and reporting",
                "Direct communication with volunteers"
              ].map((item, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  className="flex items-center gap-2 text-xs sm:text-sm group"
                >
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-primary/20 to-emerald-500/20 flex items-center justify-center group-hover:from-primary/30 group-hover:to-emerald-500/30 transition-all duration-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-br from-primary to-emerald-500"></span>
                  </span>
                  <span>{item}</span>
                </motion.div>
              ))}
            </div>
            <div className="mt-6 sm:mt-8">
              <Link href="/signup">
              <Button
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto"
                >
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
