"use client";

import { Button } from "@/components/ui/button";
import { HeartHandshake } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

export const CallToAction = () => {
  return (
    <section className="py-20 relative overflow-hidden ">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-muted/50"></div>
      
      <div className="container relative mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-8 max-w-3xl mx-auto px-4"
        >
          <HeartHandshake className="w-16 h-16 text-primary mx-auto" />
          <h2 className="text-3xl md:text-4xl font-bold">
            Who will you help today?
          </h2>
          <p className="text-lg text-muted-foreground">
            Every small act of kindness creates ripples of change in our community. 
            Start your volunteering journey today.
          </p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <Link href="/signup">
              <Button size="lg" className="rounded-full px-8">
                Make a Difference
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};