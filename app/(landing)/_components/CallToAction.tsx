"use client";

import { useState } from "react";
import { Play, HeartHandshake } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AnimatedText } from "./AnimatedText";

export const CallToAction = () => {
  const [open, setOpen] = useState(false);

  return (
    <section id="cta" className="py-20 relative overflow-hidden">
      {/* Enhanced background gradient */}
      <div className="absolute inset-0 bg-linear-to-b from-transparent via-muted/30 to-muted/80"></div>

      {/* Show accent circle only on desktop */}
      {/* <div className="hidden md:block absolute -left-24 bottom-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl"></div> */}
      {/* <div className="absolute -right-20 top-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl animate-pulse-slow"></div> */}

      <div className="container relative mx-auto ">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-8 max-w-3xl mx-auto px-4"
        >
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-linear-to-r from-primary/40 to-emerald-500/40 rounded-full blur-xl animate-pulse-slow"></div>
            <HeartHandshake className="w-16 h-16 text-primary mx-auto relative z-10" />
          </div>

          <div className="flex flex-col items-center gap-6">
            <h2 className="text-3xl md:text-4xl font-nohemi text-center">
              <AnimatedText text="Who will you help next?" mode="words" />
            </h2>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="rounded-full border-border/70 bg-background/80 px-7 text-base shadow-xs"
                    >
                      <Play className="mr-2 size-5" />
                      Play demo video
                    </Button>
                  }
                />
                <DialogContent className="w-full max-w-5xl border-none bg-transparent p-0 shadow-none sm:max-w-6xl">
                  <div className="aspect-video w-full overflow-hidden rounded-3xl bg-black ring-1 ring-white/10 shadow-2xl">
                    {open ? (
                      <iframe
                        className="h-full w-full"
                        src="https://www.youtube.com/embed/0Smto1UOqTY?autoplay=1&rel=0"
                        title="Let's Assist Demo"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    ) : null}
                  </div>
                </DialogContent>
              </Dialog>

              <Link href="/signup">
                <Button size="lg" className="rounded-full px-8">
                  Make a Difference
                </Button>
              </Link>
            </div>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">
            Every small act of kindness creates ripples of change in our
            community. Start your volunteering journey today.
          </p>
        </motion.div>
      </div>
    </section>
  );
};
