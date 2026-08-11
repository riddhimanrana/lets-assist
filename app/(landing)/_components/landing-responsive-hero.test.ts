import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readComponent(fileName: string) {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

const animatedTextSource = readComponent("AnimatedText.tsx");
const heroSource = readComponent("HeroContent.tsx");

describe("landing hero responsive text", () => {
  test("keeps animated words intact while preserving an accessible full label", () => {
    expect(animatedTextSource).toContain("aria-label={text}");
    expect(animatedTextSource).toContain("words.map((word, wordIndex)");
    expect(animatedTextSource).toContain(
      'className="inline-block whitespace-nowrap"',
    );
    expect(animatedTextSource).toContain(
      'wordIndex < words.length - 1 ? " " : null',
    );
  });

  test("uses phone-specific heading and supporting-copy rhythm", () => {
    expect(heroSource).toContain("text-[2.6rem]");
    expect(heroSource).toContain("sm:leading-[0.98]");
    expect(heroSource).toContain("text-[0.95rem] leading-6.5");
    expect(heroSource).toContain("sm:leading-8");
  });
});
