"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { useLandingForegroundMotion } from "./landing-foreground-motion";

const FLIP_INTERVAL_MS = 2500;

// Text flip animation component
export function ComparisonTextFlip({ words }: { words: string[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  // One word, or none, has nothing to flip to.
  const { reduceMotion, running } = useLandingForegroundMotion(
    words.length > 1,
  );

  useEffect(() => {
    if (!running || words.length < 2) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % words.length);
    }, FLIP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [running, words.length]);

  const word = words[currentIndex % words.length] ?? "";

  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ minWidth: "5ch" }}
    >
      {reduceMotion ? (
        // A plain span has no entering or leaving state, so the word is whole
        // the moment the preference applies, even in the middle of a flip.
        // The server cannot know the preference and sends the animated span's
        // resting style, which is why this element tolerates the difference.
        <span
          className="font-bold text-orange-700 dark:text-orange-400"
          suppressHydrationWarning
        >
          {word}
        </span>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentIndex}
            initial={{ y: 20, opacity: 0, filter: "blur(8px)" }}
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            exit={{ y: -20, opacity: 0, filter: "blur(8px)" }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="font-bold text-orange-700 dark:text-orange-400"
          >
            {word}
          </motion.span>
        </AnimatePresence>
      )}
    </span>
  );
}
