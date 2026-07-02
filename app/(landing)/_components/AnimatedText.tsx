"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

type AnimatedTextProps = {
  text: string;
  mode?: "letters" | "words";
  className?: string;
  highlight?: string;
  delay?: number;
  once?: boolean;
};

type RevealStyle = CSSProperties & {
  "--la-delay"?: string;
  "--la-duration"?: string;
  "--la-reveal-y"?: string;
  "--la-reveal-blur"?: string;
  "--la-scale"?: string;
  "--la-rotate-x"?: string;
};

const HERO_LETTER_STAGGER = 0.018;
const WORD_STAGGER = 0.1;

function isHighlighted(word: string, highlight?: string) {
  if (!highlight) return false;
  return word.replace(/[^\w]/g, "").toLowerCase() === highlight.toLowerCase();
}

export function AnimatedText({
  text,
  mode = "words",
  className,
  highlight,
  delay = 0,
  once = true,
}: AnimatedTextProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const words = text.split(" ");

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reduceMotion || mode === "letters") {
      const frame = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    const element = rootRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setIsVisible(true);
        if (once) observer.disconnect();
      },
      { threshold: 0.1 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [mode, once]);

  if (mode === "words") {
    return (
      <span
        ref={rootRef}
        aria-label={text}
        data-visible={isVisible}
        className={cn("la-text-reveal inline-block", className)}
      >
        {words.map((word, index) => (
          <span
            key={`${word}-${index}`}
            aria-hidden
            className={cn(
              "la-text-reveal-item inline-block whitespace-pre",
              isHighlighted(word, highlight) && "text-primary",
            )}
            style={
              {
                "--la-delay": `${delay + index * WORD_STAGGER}s`,
                "--la-duration": "0.42s",
                "--la-reveal-y": "28px",
                "--la-reveal-blur": "12px",
                "--la-scale": "0.88",
                "--la-rotate-x": "60deg",
              } as RevealStyle
            }
          >
            {word}
            {index < words.length - 1 ? " " : null}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span
      ref={rootRef}
      aria-label={text}
      data-visible={isVisible}
      className={cn("la-text-reveal block whitespace-pre-wrap", className)}
    >
      {Array.from(text).map((letter, index) => (
        <span
          key={`${letter}-${index}`}
          aria-hidden
          className="la-text-reveal-item inline-block whitespace-pre"
          style={
            {
              "--la-delay": `${delay + index * HERO_LETTER_STAGGER}s`,
              "--la-duration": "0.62s",
              "--la-reveal-y": "20px",
              "--la-reveal-blur": "10px",
              "--la-scale": "1",
              "--la-rotate-x": "0deg",
            } as RevealStyle
          }
        >
          {letter}
        </span>
      ))}
    </span>
  );
}
