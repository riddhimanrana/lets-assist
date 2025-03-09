"use client";

import {
  Calendar,
  Users2,
  Building2,
  Search,
  Award,
  ClipboardCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const features = [
  {
    icon: Search,
    title: "Easy Discovery",
    description:
      "Find volunteering opportunities that match your interests and schedule",
  },
  {
    icon: Building2,
    title: "Connect with Organizations",
    description: "Partner with local non-profits and community organizations",
  },
  {
    icon: Calendar,
    title: "Flexible Scheduling",
    description:
      "Choose from one-time events or ongoing commitments that fit your availability",
  },
  {
    icon: ClipboardCheck,
    title: "Hour Tracking",
    description:
      "Automatically track and verify your volunteering hours for CSF and school requirements",
  },
  {
    icon: Users2,
    title: "Team Management",
    description:
      "Coordinate with other volunteers and manage event roles efficiently",
  },
  {
    icon: Award,
    title: "Achievement System",
    description: "Earn recognition and track your community service milestones",
  },
];

interface FeatureCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
}

const FeatureCard = ({ icon: Icon, title, description }: FeatureCardProps) => {
  return (
    <div className="relative h-full">
      <div className="relative h-full rounded-2xl border p-2">
        <GlowingEffect
          spread={40}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
        />
        <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-xl border p-6 dark:shadow-[0px_0px_27px_0px_#2D2D2D]">
          <div className="relative flex flex-1 flex-col justify-between gap-3">
            <div className="w-fit rounded-lg bg-primary/10 p-3 transition-colors group-hover:bg-primary/20">
              <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold text-base sm:text-lg">
                {title}
              </h3>
              <p className="text-muted-foreground text-xs sm:text-sm">
                {description}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Features = () => {
  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
      },
    },
  };

  return (
    <section id="whyvolunteer" className="py-20 bg-muted/30">
      <div className="container mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12 px-4 sm:px-6"
        >
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            Why Choose Let&apos;s Assist?
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base">
            Streamline your volunteering journey with our comprehensive platform
            designed for both volunteers and organizations.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 px-4 sm:px-6"
        >
          {features.map((feature, index) => (
            <motion.div key={index} variants={itemVariants} className="group">
              <FeatureCard
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
              />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
