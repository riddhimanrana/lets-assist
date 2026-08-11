import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Light mode intentionally follows the historical palette from
 * d95a0aa9846bc02e611f67f0f9017245c08821d8. Lock those exact colors here so a
 * later accessibility pass cannot silently rebrand the product. Dark mode keeps
 * its existing contrast contracts.
 */

const css = readFileSync(join(import.meta.dir, "globals.css"), "utf8");

const AA_NORMAL_TEXT = 4.5;

type Rgb = { r: number; g: number; b: number };

function themeBlock(selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing ${selector} token block`).toBeGreaterThan(-1);
  const end = css.indexOf("\n  }", start);
  expect(end, `unterminated ${selector} token block`).toBeGreaterThan(start);
  return css.slice(start, end);
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = ((((hue % 360) + 360) % 360) / 60) % 6;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const sextants = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ];
  const [red, green, blue] = sextants[Math.floor(sector)] ?? sextants[0];
  const offset = lightness - chroma / 2;
  // Round to the 8-bit channels a browser composites and axe samples.
  return {
    r: Math.round((red + offset) * 255),
    g: Math.round((green + offset) * 255),
    b: Math.round((blue + offset) * 255),
  };
}

const TOKEN_DECLARATION =
  /--([a-z0-9-]+):\s*hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/gu;

function readTokens(block: string) {
  const tokens = new Map<string, Rgb>();
  for (const match of block.matchAll(TOKEN_DECLARATION)) {
    const hue = Number(match[2]);
    const saturation = Number(match[3]) / 100;
    const lightness = Number(match[4]) / 100;
    tokens.set(match[1], hslToRgb(hue, saturation, lightness));
  }
  return tokens;
}

function channelLuminance(value: number) {
  const normalized = value / 255;
  if (normalized <= 0.04045) return normalized / 12.92;
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: Rgb) {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}

function contrastRatio(one: Rgb, other: Rgb) {
  const first = relativeLuminance(one);
  const second = relativeLuminance(other);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Tailwind's `/10` opacity utilities composite the token over the surface. */
function tint(color: Rgb, surface: Rgb, alpha: number): Rgb {
  return {
    r: Math.round(color.r * alpha + surface.r * (1 - alpha)),
    g: Math.round(color.g * alpha + surface.g * (1 - alpha)),
    b: Math.round(color.b * alpha + surface.b * (1 - alpha)),
  };
}

const light = readTokens(themeBlock(":root"));
const dark = readTokens(themeBlock(".dark"));

const HISTORICAL_LIGHT_TOKENS: Record<string, Rgb> = {
  success: { r: 22, g: 163, b: 74 },
  warning: { r: 221, g: 141, b: 29 },
  info: { r: 31, g: 102, b: 244 },
  primary: { r: 22, g: 163, b: 74 },
  "primary-foreground": { r: 255, g: 241, b: 242 },
  "muted-foreground": { r: 113, g: 113, b: 122 },
  destructive: { r: 239, g: 68, b: 68 },
  ring: { r: 22, g: 163, b: 74 },
};

function token(tokens: Map<string, Rgb>, name: string) {
  const value = tokens.get(name);
  expect(value, `missing --${name} token`).toBeDefined();
  return value as Rgb;
}

type Contract = {
  theme: "light" | "dark";
  description: string;
  foreground: string;
  background: string;
  /** Composite the background token over this surface at 10% first. */
  tintOver?: string;
};

const contracts: Contract[] = [
  {
    theme: "dark",
    description: "primary button label on the primary fill",
    foreground: "primary-foreground",
    background: "primary",
  },
  {
    theme: "dark",
    description: "destructive label on the destructive fill",
    foreground: "destructive-foreground",
    background: "destructive",
  },
  {
    theme: "dark",
    description: "muted text on the muted surface",
    foreground: "muted-foreground",
    background: "muted",
  },
];

describe("theme token contrast contracts", () => {
  test("light mode matches the requested historical palette", () => {
    for (const [name, expected] of Object.entries(HISTORICAL_LIGHT_TOKENS)) {
      expect(token(light, name), `unexpected --${name}`).toEqual(expected);
    }
  });

  for (const contract of contracts) {
    const tokens = contract.theme === "light" ? light : dark;
    const surface = contract.tintOver
      ? `10% --${contract.background}`
      : `--${contract.background}`;

    test(`${contract.theme}: ${contract.description}`, () => {
      const foreground = token(tokens, contract.foreground);
      const raw = token(tokens, contract.background);
      const background = contract.tintOver
        ? tint(raw, token(tokens, contract.tintOver), 0.1)
        : raw;
      const ratio = contrastRatio(foreground, background);
      const detail = `--${contract.foreground} on ${surface} is ${ratio.toFixed(2)}:1`;
      expect(ratio, detail).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
  }

  test("the focus ring stays in step with the primary token", () => {
    expect(token(light, "ring")).toEqual(token(light, "primary"));
  });

  test("the contrast helper matches known reference ratios", () => {
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };
    expect(Number(contrastRatio(white, black).toFixed(2))).toBe(21);
    expect(Number(contrastRatio(white, white).toFixed(2))).toBe(1);

  });
});
