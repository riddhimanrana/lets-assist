"use client";

import {
  QrCode,
  Shield,
  Award,
  BarChart3,
  Users,
  MapPin,
  Clock,
  CheckCircle,
  Building2,
  FileText,
  Zap,
  Target,
} from "lucide-react";
import { motion } from "framer-motion";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const uniqueFeatures = [
  {
    icon: QrCode,
    title: "QR Code Attendance Tracking",
    description: "Instant check-in/out with QR scanning. Eliminates manual tracking errors and provides real-time attendance verification.",
    highlight: "Unique",
  },
  {
    icon: Award,
    title: "Professional Certificate Generation",
    description: "School-accepted, verifiable certificates with unique IDs. Automated compliance documentation for CSF and institutional requirements.",
    highlight: "Verified",
  },
  {
    icon: Shield,
    title: "Automated CSF Compliance",
    description: "One-click CSF reporting with pre-formatted submissions. Automatic hour tracking, category assignment, and approval workflows.",
    highlight: "CSF Approved",
  },
  {
    icon: Building2,
    title: "Verified Organization Network",
    description: "Curated network of legitimate nonprofits and schools. Background-verified opportunities with institutional partnerships.",
    highlight: "Enterprise",
  },
];

const advancedCapabilities = [
  {
    icon: BarChart3,
    title: "Advanced Analytics Dashboard",
    description: "ROI tracking, volunteer engagement metrics, and outcome measurement for organizations managing 100+ volunteers.",
  },
  {
    icon: Users,
    title: "Bulk Volunteer Management",
    description: "Coordinate large teams with role assignments, communication tools, and automated scheduling systems.",
  },
  {
    icon: MapPin,
    title: "Intelligent Opportunity Matching",
    description: "AI-powered matching based on location, skills, availability, and institutional requirements.",
  },
  {
    icon: Clock,
    title: "Automated Hour Validation",
    description: "Cross-referenced time tracking with supervisor approval and institutional verification systems.",
  },
  {
    icon: CheckCircle,
    title: "Multi-Level Approval Workflows",
    description: "Customizable approval chains for schools, organizations, and compliance officers.",
  },
  {
    icon: FileText,
    title: "Institutional Integration",
    description: "Direct integration with school information systems and nonprofit management platforms.",
  },
  {
    icon: Zap,
    title: "Real-Time Notifications",
    description: "Instant alerts for attendance, approvals, deadlines, and compliance requirements.",
  },
  {
    icon: Target,
    title: "Goal Tracking & Milestones",
    description: "Personal and organizational goal setting with progress tracking and achievement recognition.",
  },
];

interface FeatureCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  highlight?: string;
  featured?: boolean;
}

const FeatureCard = ({ icon: Icon, title, description, highlight, featured = false }: FeatureCardProps) => {
  return (
    <div className="relative h-full">
      <div className={`relative h-full rounded-2xl border p-2 ${featured ? 'border-primary/50' : ''}`}>
        <GlowingEffect
          spread={featured ? 50 : 40}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
        />
        <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-xl border p-6 dark:shadow-[0px_0px_27px_0px_#2D2D2D]">
          <div className="relative flex flex-1 flex-col justify-between gap-4">
            <div className="flex items-start justify-between">
              <div className={`w-fit rounded-lg p-3 transition-colors ${featured ? 'bg-primary/20' : 'bg-primary/10'} group-hover:bg-primary/20`}>
                <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${featured ? 'text-primary' : 'text-primary'}`} />
              </div>
              {highlight && (
                <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                  {highlight}
                </span>
              )}
            </div>
            <div className="space-y-3">
              <h3 className={`font-semibold ${featured ? 'text-lg sm:text-xl' : 'text-base sm:text-lg'}`}>
                {title}
              </h3>
              <p className="text-muted-foreground text-xs sm:text-sm leading-relaxed">
                {description}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ComprehensiveFeatures = () => {
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
    <section id="features" className="py-20 bg-muted/30">
      <div className="container mx-auto">
        {/* Unique Differentiators */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16 px-4 sm:px-6"
        >
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Professional-Grade Volunteer Management
          </h2>
          <p className="text-muted-foreground max-w-3xl mx-auto text-sm sm:text-base">
            Enterprise features that set us apart from basic volunteering platforms. 
            Built for schools, organizations, and compliance requirements.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-6 sm:gap-8 px-4 sm:px-6 mb-16"
        >
          {uniqueFeatures.map((feature, index) => (
            <motion.div key={index} variants={itemVariants} className="group">
              <FeatureCard
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
                highlight={feature.highlight}
                featured={true}
              />
            </motion.div>
          ))}
        </motion.div>

        {/* Advanced Capabilities */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12 px-4 sm:px-6"
        >
          <h3 className="text-2xl sm:text-3xl font-bold mb-4">
            Advanced Enterprise Capabilities
          </h3>
          <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base">
            Sophisticated tools for managing large-scale volunteer programs with institutional oversight.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 px-4 sm:px-6"
        >
          {advancedCapabilities.map((feature, index) => (
            <motion.div key={index} variants={itemVariants} className="group">
              <FeatureCard
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
              />
            </motion.div>
          ))}
        </motion.div>

        {/* Call to action */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-center mt-16 px-4 sm:px-6"
        >
          <p className="text-muted-foreground text-sm">
            <span className="font-medium text-primary">Enterprise-grade security</span> • 
            <span className="mx-2">SOC 2 compliance</span> • 
            <span className="font-medium text-primary">99.9% uptime</span>
          </p>
        </motion.div>
      </div>
    </section>
  );
};