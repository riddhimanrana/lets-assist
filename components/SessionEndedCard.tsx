"use client";

import { useState, useEffect } from "react";
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
  const particles = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.3,
    duration: 2 + Math.random() * 1,
  }));

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          className="absolute w-2 h-2 rounded-full"
          style={{
            left: `${particle.left}%`,
            background: [
              "#ff6b6b",
              "#4ecdc4",
              "#45b7d1",
              "#ffd93d",
              "#6bcf7f",
            ][Math.floor(Math.random() * 5)],
            opacity: 0.8,
          }}
          initial={{
            y: -10,
            opacity: 1,
          }}
          animate={{
            y: window.innerHeight + 20,
            opacity: 0,
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            ease: "easeIn",
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
  const [showConfetti, setShowConfetti] = useState(true);

  useEffect(() => {
    // Stop showing confetti after 3 seconds
    const timer = setTimeout(() => setShowConfetti(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {showConfetti && <Confetti />}
      <div className="container mx-auto py-12 px-4 md:px-6 flex items-center justify-center min-h-screen">
        <div className="w-full max-w-md">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <Card className="border-primary/20 shadow-lg">
              <CardHeader className="pb-4">
                <div className="flex justify-center mb-4">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                  >
                    <Trophy className="h-12 w-12 text-primary" />
                  </motion.div>
                </div>
                <CardTitle className="text-center text-2xl">
                  Event Completed!
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-6">
                <div className="space-y-6">
                  {/* Success message */}
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Great work!</p>
                      <p className="text-sm text-muted-foreground">
                        You've completed your volunteer session.
                      </p>
                    </div>
                  </div>

                  {/* Event details */}
                  <div className="space-y-3 bg-muted/50 p-4 rounded-lg">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">
                        Project
                      </p>
                      <p className="font-medium break-words">{projectTitle}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">
                        Session
                      </p>
                      <p className="font-medium break-words">{sessionName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">
                        Time Served
                      </p>
                      <p className="font-medium">{elapsedTime}</p>
                    </div>
                  </div>

                  {/* Encouragement message */}
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <Sparkles className="h-4 w-4" />
                    <p>Your hours will be finalized within 48 hours.</p>
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
    </>
  );
}
