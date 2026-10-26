import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Keep the approved primary palette separate from semantic AA requirements.
 * The reference light green and white label measure about 3.30:1 on the solid
 * fill. Record that limit instead of changing the palette to satisfy AA.
 * Pairs that meet AA in the reference retain their normal-text AA checks.
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
  const aliases = [
    ...block.matchAll(/--([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)/gu),
  ];
  for (let pass = 0; pass < aliases.length; pass++) {
    for (const [, name, target] of aliases) {
      const value = tokens.get(target);
      if (value) tokens.set(name, value);
    }
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

const LIGHT_TOKENS: Record<string, Rgb> = {
  // The approved reference uses the identity green and a white label.
  brand: { r: 22, g: 163, b: 74 },
  "primary-foreground": { r: 255, g: 255, b: 255 },
  // The reference grey remains unchanged, including its contrast limit.
  "muted-foreground": { r: 113, g: 113, b: 122 },
  // Semantic colors match the approved reference.
  success: { r: 22, g: 163, b: 74 },
  warning: hslToRgb(35, 0.77, 0.49),
  info: hslToRgb(220, 0.91, 0.54),
  primary: { r: 22, g: 163, b: 74 },
  destructive: hslToRgb(0, 0.842, 0.602),
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
    theme: "light",
    description: "staff badge label on the blue tint",
    foreground: "foreground",
    background: "info",
    tintOver: "background",
  },
  {
    theme: "dark",
    description: "staff badge label on the blue tint",
    foreground: "info",
    background: "info",
    tintOver: "background",
  },
  {
    theme: "dark",
    description: "default badge label on its green fill",
    foreground: "primary-foreground",
    background: "primary",
  },
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
  test("the filled badge uses the foreground modeled by the contrast contract", () => {
    const source = readFileSync(
      join(import.meta.dir, "../components/ui/badge.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /default:\s*"bg-primary [^"]*text-primary-foreground/u,
    );
  });

  test("light mode keeps the approved primary palette and semantic steps", () => {
    for (const [name, expected] of Object.entries(LIGHT_TOKENS)) {
      expect(token(light, name), `unexpected --${name}`).toEqual(expected);
    }
  });

  test("scanner errors use legible solid fills in both themes", () => {
    const scanner = readFileSync(
      join(import.meta.dir, "projects/_components/QRCodeScannerModal.tsx"),
      "utf8",
    );
    expect(scanner).toContain(
      "bg-red-700 text-white dark:bg-destructive dark:text-destructive-foreground",
    );
    const red700 = { r: 185, g: 28, b: 28 };
    const white = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(white, red700)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(
      contrastRatio(
        token(dark, "destructive-foreground"),
        token(dark, "destructive"),
      ),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
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

  test("the light primary reference records its actual contrast without claiming AA", () => {
    const ratio = contrastRatio(
      token(light, "primary-foreground"),
      token(light, "primary"),
    );
    expect(ratio).toBeCloseTo(3.2957336, 5);
    expect(ratio).toBeLessThan(AA_NORMAL_TEXT);
  });

  test("the light focus ring uses the primary identity", () => {
    expect(token(light, "ring")).toEqual(token(light, "primary"));
  });

  test("content-link aliases retain the approved primary in both themes", () => {
    for (const theme of [light, dark]) {
      expect(token(theme, "content-link")).toEqual(token(theme, "primary"));
    }
  });

  test("the contrast helper matches known reference ratios", () => {
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };
    expect(Number(contrastRatio(white, black).toFixed(2))).toBe(21);
    expect(Number(contrastRatio(white, white).toFixed(2))).toBe(1);
  });
});
