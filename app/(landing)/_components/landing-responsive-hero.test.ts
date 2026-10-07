import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readComponent(fileName: string) {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

const heroSource = readComponent("HeroContent.tsx");
const scribbleSource = readComponent("Scribble.tsx");

describe("landing hero", () => {
  test("uses phone-specific heading and supporting-copy rhythm", () => {
    expect(heroSource).toContain("text-[2.6rem]");
    expect(heroSource).toContain("sm:leading-[0.98]");
    expect(heroSource).toContain("text-[0.95rem] leading-6.5");
    expect(heroSource).toContain("sm:leading-8");
  });

  test("sends volunteers and organizers to their own starting points", () => {
    expect(heroSource).toContain('<MotionLinkButton href="/projects">');
    expect(heroSource).toContain(
      '<MotionLinkButton href="/signup" tone="outline">',
    );
  });

  test("sets handwritten notes in the handwriting font", () => {
    expect(scribbleSource).toContain("font-cheese-milky");
    expect(heroSource).toMatch(
      /className="font-cheese-milky[^"]*">\s*try our interactive demo/,
    );
  });
});
