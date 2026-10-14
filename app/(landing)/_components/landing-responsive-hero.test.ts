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

  test("leads organizers to project creation and keeps volunteering discoverable", () => {
    expect(heroSource).toMatch(
      /href="\/signup\?redirect=%2Fprojects%2Fcreate"[\s\S]*?Create a project[\s\S]*?<\/MotionLinkButton>/,
    );
    expect(heroSource).toMatch(
      /href="#org-tooling"[\s\S]*?tone="outline"[\s\S]*?See how it works/,
    );
    expect(heroSource).toContain("Browse upcoming projects");
    expect(heroSource).not.toContain("Find volunteering near me");
  });

  test("sets handwritten notes in the handwriting font", () => {
    expect(scribbleSource).toContain("font-cheese-milky");
    expect(heroSource).toMatch(
      /className="font-cheese-milky[^"]*">\s*try our interactive demo/,
    );
  });
});
