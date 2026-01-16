"use client";

import { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Trophy, Sparkles } from "lucide-react";
import Link from "next/link";

interface SessionEndedCardProps {
  projectId: string;
  projectTitle: string;
  sessionName: string;
  elapsedTime: string;
}

// Confetti particle component
function Confetti() {
  const particles = useMemo(
    () =>
      Array.from({ length: 50 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        drift: (Math.random() - 0.5) * 140,
        rotate: (Math.random() - 0.5) * 540,
        size: 6 + Math.random() * 8,
        delay: Math.random() * 0.3,
        duration: 2 + Math.random() * 1,
        colorClass: [
          "bg-primary",
          "bg-chart-3",
          "bg-chart-4",
          "bg-chart-5",
          "bg-muted-foreground",
        ][Math.floor(Math.random() * 5)],
        shapeClass: ["rounded-full", "rounded-sm"][Math.floor(Math.random() * 2)],
      })),
    []
  );

  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          className={`absolute ${particle.shapeClass} ${particle.colorClass}`}
          style={{
            left: `${particle.left}%`,
            opacity: 0.8,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
          }}
          initial={{
            y: -24,
            x: 0,
            rotate: 0,
            opacity: 0,
          }}
          animate={{
            y: viewportHeight + 20,
            x: [0, particle.drift * 0.6, particle.drift],
            rotate: particle.rotate,
            opacity: [0, 0.9, 0],
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            ease: [0.22, 1, 0.36, 1],
          }}
        />
      ))}
    </div>
  );
}

export function SessionEndedCard({
  projectId,
  projectTitle,
  sessionName,
  elapsedTime,
}: SessionEndedCardProps) {
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    // Only render confetti on the client (prevents hydration mismatch from random values)
    setShowConfetti(true);

    // Stop showing confetti after 3 seconds
    const timer = setTimeout(() => setShowConfetti(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {showConfetti && <Confetti />}
      <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background">
        <div className="container mx-auto flex min-h-screen items-center justify-center px-4 py-10 md:px-6">
          <div className="w-full max-w-md">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <Card className="relative overflow-hidden border-primary/20">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/10 to-transparent" />
              <CardHeader className="pb-4 pt-8">
                <div className="mb-4 flex justify-center">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="rounded-full bg-primary/10 p-3 ring-1 ring-primary/20"
                  >
                    <Trophy className="h-10 w-10 text-primary" />
                  </motion.div>
                </div>
                <CardTitle className="text-center text-2xl tracking-tight">
                  Event completed
                </CardTitle>
                <p className="text-center text-sm text-muted-foreground">
                  Thanks for volunteering — your session is recorded.
                </p>
              </CardHeader>
              <CardContent className="pb-6">
                <div className="space-y-6">
                  {/* Success message */}
                  <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
                    <div className="mt-0.5 rounded-full bg-chart-5/10 p-1.5 ring-1 ring-chart-5/20">
                      <CheckCircle2 className="h-4 w-4 text-chart-5" />
                    </div>
                    <div>
                      <p className="font-medium">Great work</p>
                      <p className="text-sm text-muted-foreground">
                        You've completed your volunteer session.
                      </p>
                    </div>
                  </div>

                  {/* Event details */}
                  <div className="rounded-lg border bg-card p-4">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-muted-foreground">Project</p>
                          <p className="break-words font-medium leading-snug">{projectTitle}</p>
                        </div>
                      </div>

                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-muted-foreground">Session</p>
                          <p className="break-words font-medium leading-snug">{sessionName}</p>
                        </div>
                        <div className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
                          {elapsedTime}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Encouragement message */}
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Sparkles className="h-4 w-4" />
                    <p>
                      Your hours will be finalized within 48 hours.
                    </p>
                  </div>
                </div>
              </CardContent>

              {/* Action buttons */}
              <div className="px-6 pb-6 flex flex-col gap-2">
                <Button asChild className="w-full">
                  <Link href={`/projects/${projectId}`}>
                    View Project Details
                  </Link>
                </Button>
                <Button variant="outline" asChild className="w-full">
                  <Link href="/dashboard">Back to Dashboard</Link>
                </Button>
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
    </>
  );
}
