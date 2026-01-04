"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Play, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";

const videoId = "0Smto1UOqTY";
const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

export const HeroVideo = () => {
  const [open, setOpen] = useState(false);

  return (
    <section id="product-demo" className="relative py-12 sm:py-16 overflow-hidden">
      <div className="container relative mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-4xl"
        >
          <Dialog open={open} onOpenChange={setOpen}>
            <Card className="overflow-hidden border-border/60 shadow-[0_25px_80px_-40px_rgba(15,23,42,0.6)]">
              <CardContent className="p-0">
                <DialogTrigger asChild>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className="group relative block aspect-video w-full overflow-hidden bg-muted"
                  >
                    {/* subtle glow behind the video thumbnail */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-3/4 h-3/4 rounded-2xl bg-gradient-to-r from-indigo-500/30 via-purple-500/20 to-pink-500/10 blur-2xl opacity-0 transform scale-90 transition-all duration-300 group-hover:opacity-90 group-hover:scale-100" />
                    </div>

                    <div
                      className="absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url(${thumbnailUrl})` }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/5 to-black/40" />
                    <motion.div
                      className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2, duration: 0.6 }}
                    >
                      <div className="flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-black shadow-lg">
                        <Play className="h-4 w-4" />
                        Watch video
                      </div>
                      <p className="text-xs text-white/70 pt-5">3 min walkthrough</p>
                    </motion.div>
                  </motion.button>
                </DialogTrigger>
              </CardContent>
            </Card>

            <DialogContent className="max-w-4xl border-none bg-transparent p-0 shadow-none">
              <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
                {open ? (
                  <iframe
                    className="h-full w-full"
                    src={embedUrl}
                    title="Let's Assist Demo"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
        </motion.div>
      </div>
    </section>
  );
};
