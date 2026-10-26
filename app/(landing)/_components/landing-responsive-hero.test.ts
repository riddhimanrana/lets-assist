import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readComponent(fileName: string) {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

const heroSource = readComponent("HeroContent.tsx");
const scribbleSource = readComponent("Scribble.tsx");

describe("landing hero", () => {
  test("uses phone-specific heading and supporting-copy rhythm", () => {
    expect(heroSource).toContain("text-[2.25rem]");
    expect(heroSource).toContain("sm:leading-[0.98]");
    expect(heroSource).toContain("text-sm leading-6");
    expect(heroSource).toContain("sm:leading-8");
    expect(heroSource).toContain("pt-6 sm:px-6 sm:pt-10");
    expect(heroSource).toContain('className="mt-7 sm:mt-10"');
  });

  test("leads organizers to project creation and keeps volunteering discoverable", () => {
    expect(heroSource).toMatch(
      /href="\/signup"[\s\S]*?Get started[\s\S]*?<\/MotionLinkButton>/,
    );
    expect(heroSource).toMatch(
      /href="\/contact"[\s\S]*?tone="outline"[\s\S]*?Contact us/,
    );
    expect(heroSource).toContain("Browse upcoming projects");
    expect(heroSource).not.toContain("Find volunteering near me");
  });

  test("uses the shared primary button color for getting started", () => {
    expect(heroSource).toContain('<MotionLinkButton href="/signup">');
    expect(heroSource).not.toContain("bg-black text-white");
  });

  test("sets handwritten notes in the handwriting font", () => {
    expect(scribbleSource).toContain("font-cheese-milky");
    expect(heroSource).toMatch(
      /className="font-cheese-milky[^"]*">\s*try our interactive demo/,
    );
  });
});
