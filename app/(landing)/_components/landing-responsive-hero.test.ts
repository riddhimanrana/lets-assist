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

  test("gives volunteers and organizers distinct starting actions", () => {
    expect(heroSource).toMatch(
      /<MotionLinkButton href="\/projects">Find a project<\/MotionLinkButton>/,
    );
    expect(heroSource).toMatch(
      /href="\/signup\?redirect=%2Fprojects%2Fcreate"[\s\S]*?tone="outline"[\s\S]*?Run a volunteer event/,
    );
    expect(heroSource).not.toContain("Find volunteering near me");
  });

  test("sets handwritten notes in the handwriting font", () => {
    expect(scribbleSource).toContain("font-cheese-milky");
    expect(heroSource).toMatch(
      /className="font-cheese-milky[^"]*">\s*try our interactive demo/,
    );
  });
});
