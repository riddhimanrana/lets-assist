"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const CallToAction = () => {
  const [open, setOpen] = useState(false);

  return (
    <section id="cta" className="border-t py-16 sm:py-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={false}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl space-y-6"
        >
          <div className="space-y-6">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Set up your next volunteer project
            </h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                asChild
                size="lg"
                className="w-full rounded-full px-6 sm:w-auto"
              >
                <Link href="/signup?redirect=%2Fprojects%2Fcreate">
                  Create a project
                </Link>
              </Button>

              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="w-full rounded-full px-6 sm:w-auto"
                    >
                      <Play data-icon="inline-start" aria-hidden="true" />
                      Play demo video
                    </Button>
                  }
                />
                <DialogContent className="w-[calc(100%-2rem)] max-w-5xl gap-2 border-none bg-transparent p-0 shadow-none sm:max-w-6xl [&>[data-slot=dialog-close]]:top-2.5 [&>[data-slot=dialog-close]]:right-2.5 [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:bg-black/70 [&>[data-slot=dialog-close]]:text-white [&>[data-slot=dialog-close]]:hover:bg-black/90 [&>[data-slot=dialog-close]]:hover:text-white [&>[data-slot=dialog-close]]:focus-visible:ring-white [&>[data-slot=dialog-close]]:focus-visible:ring-inset">
                  {/* The close button sits over this bar, never the player. */}
                  <div
                    data-slot="video-dialog-toolbar"
                    className="flex min-h-16 items-center rounded-3xl bg-background py-2.5 pr-16 pl-5 text-foreground"
                  >
                    <DialogTitle className="text-sm font-semibold sm:text-base">
                      Let&apos;s Assist demo video
                    </DialogTitle>
                  </div>
                  <div
                    data-slot="video-dialog-player"
                    className="relative aspect-video min-h-[200px] w-full overflow-hidden rounded-3xl bg-black ring-1 ring-white/10 shadow-2xl"
                  >
                    {open ? (
                      <iframe
                        className="absolute inset-0 h-full w-full"
                        src="https://www.youtube.com/embed/0Smto1UOqTY?autoplay=1&rel=0"
                        title="Let's Assist Demo"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        // The site sends no referrer by default. YouTube
                        // needs the embedding origin, and only the origin.
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                      />
                    ) : null}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">
            Add a date and shifts, then share one link with your volunteers.
            Questions before you begin?{" "}
            <Link
              href="/contact"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              Contact us
            </Link>
            .
          </p>
        </motion.div>
      </div>
    </section>
  );
};
