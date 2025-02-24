"use client";

import { Calendar, Users2, Building2, Search, Award, ClipboardCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";

const features = [
  {
    icon: Search,
    title: "Easy Discovery",
    description: "Find volunteering opportunities that match your interests and schedule"
  },
  {
    icon: Building2,
    title: "Connect with Organizations",
    description: "Partner with local non-profits and community organizations"
  },
  {
    icon: Calendar,
    title: "Flexible Scheduling",
    description: "Choose from one-time events or ongoing commitments that fit your availability"
  },
  {
    icon: ClipboardCheck,
    title: "Hour Tracking",
    description: "Automatically track and verify your volunteering hours for CSF and school requirements"
  },
  {
    icon: Users2,
    title: "Team Management",
    description: "Coordinate with other volunteers and manage event roles efficiently"
  },
  {
    icon: Award,
    title: "Achievement System",
    description: "Earn recognition and track your community service milestones"
  }
];

export const Features = () => {
  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: {
        duration: 0.5
      }
    }
  };

  return (
    <section className="py-20 bg-muted/30">
      <div className="container mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12 px-4 sm:px-6"
        >
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Why Choose Let&apos;s Assist?</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base">
            Streamline your volunteering journey with our comprehensive platform designed for both volunteers and organizations.
          </p>
        </motion.div>

        <motion.div 
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 px-4 sm:px-6"
        >
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.div key={index} variants={itemVariants}>
                <Card className="group hover:shadow-lg transition-shadow duration-300 h-full">
                  <CardContent className="p-4 sm:p-6">
                    <div className="mb-4 w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2 text-sm sm:text-base">{feature.title}</h3>
                    <p className="text-muted-foreground text-xs sm:text-sm">{feature.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
};