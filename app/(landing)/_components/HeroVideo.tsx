"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Card, CardContent } from "@/components/ui/card";
import { Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const videoId = "0Smto1UOqTY";
const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

export const HeroVideo = () => {
  const [open, setOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="product-demo"
      className="relative py-12 sm:py-16 overflow-hidden"
    >
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-5xl"
        >
          <Dialog open={open} onOpenChange={setOpen}>
            <Card className="overflow-hidden py-0 border-0 ring-0 shadow-[0_25px_80px_-40px_rgba(15,23,42,0.6)]">
              <CardContent className="p-0">
                <DialogTrigger
                  render={
                    <motion.button
                      type="button"
                      whileHover={
                        shouldReduceMotion ? undefined : { scale: 1.01 }
                      }
                      whileTap={
                        shouldReduceMotion ? undefined : { scale: 0.99 }
                      }
                      className="group relative block aspect-video w-full overflow-hidden bg-muted"
                    >
                      <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${thumbnailUrl})` }}
                      />
                      <div className="absolute inset-0 bg-linear-to-b from-black/20 via-black/5 to-black/40" />
                      <motion.div
                        className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white"
                        initial={
                          shouldReduceMotion ? false : { opacity: 0, y: 10 }
                        }
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2, duration: 0.6 }}
                      >
                        <div className="flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-black shadow-lg">
                          <Play className="h-4 w-4" />
                          Watch video
                        </div>
                        <p className="text-xs text-white/70 pt-5">
                          3 min walkthrough
                        </p>
                      </motion.div>
                    </motion.button>
                  }
                />
              </CardContent>
            </Card>

            <DialogContent className="w-[calc(100%-2rem)] max-w-screen-xl sm:max-w-screen-xl border-none bg-transparent p-0 shadow-none [&>[data-slot=dialog-close]]:bg-black/70 [&>[data-slot=dialog-close]]:text-white [&>[data-slot=dialog-close]]:hover:bg-black/90 [&>[data-slot=dialog-close]]:hover:text-white [&>[data-slot=dialog-close]]:focus-visible:ring-white">
              <DialogTitle className="sr-only">
                Let&apos;s Assist demo video
              </DialogTitle>
              <div className="relative aspect-video min-h-[200px] w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 shadow-2xl">
                {open ? (
                  <iframe
                    className="absolute inset-0 h-full w-full"
                    src={embedUrl}
                    title="Let's Assist Demo"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    // The site sends no referrer by default. YouTube needs
                    // the embedding origin, and only the origin.
                    referrerPolicy="strict-origin-when-cross-origin"
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
