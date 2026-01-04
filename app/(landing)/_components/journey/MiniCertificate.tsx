"use client";

import { motion } from "framer-motion";
import { Award, BadgeCheck, Building2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface MiniCertificateProps {
  projectName: string;
  organizationName: string;
  hours: number;
  volunteerName: string;
}

export function MiniCertificate({
  projectName,
  organizationName,
  hours,
  volunteerName,
}: MiniCertificateProps) {
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="p-4"
    >
      <div className="relative overflow-hidden rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/10 via-background to-primary/5 p-6 shadow-lg">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", duration: 0.6, delay: 0.2 }}
          >
            <Award className="h-10 w-10 text-primary" />
          </motion.div>
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", duration: 0.6, delay: 0.3 }}
          >
            <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20">
              <BadgeCheck className="h-3 w-3 mr-1" />
              Verified
            </Badge>
          </motion.div>
        </div>

        {/* Content */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="space-y-3"
        >
          <div>
            <p className="text-xs text-muted-foreground mb-1">Certificate of Volunteer Service</p>
            <h3 className="text-lg font-bold leading-tight">{projectName}</h3>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            <span>{organizationName}</span>
          </div>

          <div className="p-3 bg-gradient-to-r from-primary/5 to-transparent backdrop-blur-sm rounded-lg border border-primary/10">
            <p className="text-sm font-semibold mb-1">{volunteerName}</p>
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <p className="text-lg font-bold text-primary">{hours} hours</p>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Verified • Nov 16, 2025
            </p>
          </div>
        </motion.div>

        {/* Decorative gradient orb */}
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute -bottom-6 -right-6 w-24 h-24 bg-primary/20 rounded-full blur-2xl -z-10 pointer-events-none"
        />
      </div>
    </motion.div>
  );
}
