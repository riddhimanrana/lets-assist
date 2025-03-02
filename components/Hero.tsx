"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export const HeroSection = () => {
  return (
    <section className="container relative w-full overflow-hidden mx-auto px-4">
      {/* Background gradient blob */}
      <div className="absolute -z-10 blur-3xl opacity-20 bg-gradient-to-r from-primary via-blue-500 to-purple-500 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] rounded-full top-0 left-0 transform -translate-x-1/2 -translate-y-1/2"></div>
      
      <div className="grid place-items-center w-full gap-6 mx-auto py-12 md:py-28">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center space-y-5 sm:space-y-8 w-full"
        >
          <Badge variant="outline" className="text-xs sm:text-sm py-1.5 sm:py-2">
            <span className="mr-2 text-primary">
              <Badge>New</Badge>
            </span>
            <span> v1.0 released 🎉</span>
          </Badge>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="w-full max-w-screen-md mx-auto text-center px-2"
          >
            <h1 className="text-[2.7rem] sm:text-4xl md:text-5xl lg:text-6xl font-black font-sans leading-[1.1] sm:leading-tight">
              Give back to your{' '}
              <span className="text-transparent bg-gradient-to-r from-[#4ed247] to-primary bg-clip-text inline-block">
                community
              </span>{' '}
              <span className="inline-block">your way</span>
            </h1>
          </motion.div>

          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="max-w-screen-sm mx-auto text-sm sm:text-base md:text-lg text-muted-foreground px-4 sm:px-2 leading-relaxed"
          >
            Find and track local volunteering opportunities, connect with organizations, and make a difference in your community.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 px-4 sm:px-0 w-full sm:w-auto"
          >
            <Link href="/signup" className="w-full sm:w-auto max-w-[280px]">
              <Button className="w-full h-12 sm:h-11 px-8 font-semibold text-sm group/arrow shadow-sm hover:shadow-md transform transition-all duration-200 hover:scale-[1.02]">
                Get Started
                <ArrowRight className="size-5 ml-2 group-hover/arrow:translate-x-1 transition-transform duration-500" />
              </Button>
            </Link>
            <Link href="/projects" className="w-full sm:w-auto max-w-[280px]">
              <Button variant="outline" className="w-full h-12 sm:h-11 px-8 text-sm hover:bg-secondary/80 transition-colors">
                Browse Opportunities
              </Button>
            </Link>
          </motion.div>
        </motion.div>

        {/* Stats section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="grid grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 mt-8 sm:mt-12 w-full max-w-3xl px-4"
        >
          <div className="text-center p-3 rounded-lg hover:bg-secondary/50 transition-colors duration-300">
            <h3 className="text-2xl sm:text-3xl font-bold text-primary mb-1">500+</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">Active Opportunities</p>
          </div>
          <div className="text-center p-3 rounded-lg hover:bg-secondary/50 transition-colors duration-300">
            <h3 className="text-2xl sm:text-3xl font-bold text-primary mb-1">1000+</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">Volunteers</p>
          </div>
          <div className="text-center col-span-2 md:col-span-1 p-3 rounded-lg hover:bg-secondary/50 transition-colors duration-300">
            <h3 className="text-2xl sm:text-3xl font-bold text-primary mb-1">50+</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">Organizations</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
};