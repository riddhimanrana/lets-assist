import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readComponent(fileName: string) {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

const heroSource = readComponent("Hero.tsx");
const demoSource = readComponent("LandingDemo.tsx");
const scribbleSource = readComponent("Scribble.tsx");

describe("landing hero", () => {
  test("renders the headline as plain server text so it is in the first paint", () => {
    expect(heroSource).not.toContain('"use client"');
    expect(heroSource).toContain("Sign up, show up, get your hours verified.");
  });

  test("sends volunteers and organizers to their own starting points", () => {
    expect(heroSource).toContain('href="/projects"');
    expect(heroSource).toContain('href="/signup"');
  });

  test("sets handwritten notes in the handwriting font", () => {
    expect(scribbleSource).toContain("font-cheese-milky");
    expect(demoSource).toMatch(
      /className="font-cheese-milky[^"]*">\s*try our interactive demo/,
    );
  });
});
