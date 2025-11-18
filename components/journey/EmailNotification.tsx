"use client";

import { motion } from "framer-motion";
import { Mail, CheckCircle } from "lucide-react";

export function EmailNotification() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6">
      <motion.div
        initial={{ scale: 0.8, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", duration: 0.6, delay: 0.2 }}
        className="relative"
      >
        <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 p-6 border border-primary/20">
          <Mail className="h-16 w-16 text-primary" />
        </div>
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", duration: 0.4, delay: 0.5 }}
          className="absolute -top-2 -right-2 bg-green-500 rounded-full p-1"
        >
          <CheckCircle className="h-6 w-6 text-white" />
        </motion.div>
      </motion.div>
      
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
        className="text-center"
      >
        <p className="text-sm font-semibold mb-1">Signup Confirmed!</p>
        <p className="text-xs text-muted-foreground">
          Email notification from Let&apos;s Assist
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Check your inbox for event details
        </p>
      </motion.div>
    </div>
  );
}
