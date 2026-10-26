import { Fragment, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

type LetterStyle = CSSProperties & { "--la-delay": string };

// Timing recovered from the earlier hero: each letter rises 20px out of a
// 10px blur over 0.62s, 18ms after the one before it, and the green line
// starts at 0.46s.
const LETTER_STAGGER = 0.018;

export const HERO_HEADLINE_LINES = [
  { text: "The modern way to do", delay: 0.04, className: undefined },
  {
    text: "volunteering",
    delay: 0.46,
    className: "text-[color:var(--primary)]",
  },
] as const;

export const HERO_HEADLINE_TEXT = HERO_HEADLINE_LINES.map(
  (line) => line.text,
).join(" ");

/**
 * The landing headline with its restored letter entrance. This animation is
 * limited to this headline.
 *
 * The h1 carries its full text once, for assistive technology. The letters
 * are decorative copies. The entrance is a CSS animation, so it needs no
 * script, starts from laid-out letters that never change size, plays once
 * when the heading mounts, and cannot replay when the hero re-renders for a
 * dialog. `prefers-reduced-motion` removes it in `app/globals.css`.
 */
export function HeroHeading({ className }: { className?: string }) {
  return (
    <h1 className={className}>
      <span className="sr-only">{HERO_HEADLINE_TEXT}</span>
      {HERO_HEADLINE_LINES.map((line) => {
        const words = line.text.split(" ");
        let letterIndex = 0;

        return (
          <span
            key={line.text}
            aria-hidden="true"
            className={cn("block", line.className)}
          >
            {words.map((word, wordIndex) => (
              <Fragment key={`${word}-${wordIndex}`}>
                {/* Words stay atomic so lines never break mid-word on small screens. */}
                <span className="inline-block whitespace-nowrap">
                  {Array.from(word).map((letter, index) => {
                    const delay = line.delay + letterIndex * LETTER_STAGGER;
                    letterIndex += 1;
                    return (
                      <span
                        key={`${letter}-${index}`}
                        className="la-hero-letter inline-block"
                        style={
                          {
                            "--la-delay": `${delay.toFixed(3)}s`,
                          } as LetterStyle
                        }
                      >
                        {letter}
                      </span>
                    );
                  })}
                </span>
                {wordIndex < words.length - 1 ? " " : null}
              </Fragment>
            ))}
          </span>
        );
      })}
    </h1>
  );
}
