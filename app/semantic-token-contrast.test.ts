import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AA checks and measurements of the approved reference palette.
 * The light reference primary with white text does not meet normal-text AA.
 *
 * A filled control paints its label over `--primary` plus the sheen in
 * `--button-primary-gloss`, and the primitives add `brightness-*` on hover and
 * press. A status surface paints semantic text over a tint of the same token,
 * at the opacities the primitives declare. A tinted alert paints its
 * description in a translucent foreground. Each case below composites those
 * layers from the source values and checks the result.
 *
 * This is a bound from source arithmetic, not a rendered-pixel sample. It does
 * not cover the 1px inner edge, disabled controls, font rendering, a tint on a
 * surface other than the four listed here, or classes set outside the
 * primitives read below.
 */

const appDir = import.meta.dir;
const css = readFileSync(join(appDir, "globals.css"), "utf8");
const filledControls = ["button-variants.ts", "badge.tsx"]
  .map((file) =>
    readFileSync(join(appDir, "..", "components", "ui", file), "utf8"),
  )
  .join("\n");

const AA_NORMAL_TEXT = 4.5;

type Rgb = { r: number; g: number; b: number };
type GlossStop = { color: Rgb; alpha: number };

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
  return {
    r: Math.round((red + offset) * 255),
    g: Math.round((green + offset) * 255),
    b: Math.round((blue + offset) * 255),
  };
}

const TOKEN_DECLARATION =
  /--([a-z0-9-]+):\s*hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/gu;
const GLOSS_STOP = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)%\s*\)/gu;

function readTokens(block: string) {
  const tokens = new Map<string, Rgb>();
  for (const match of block.matchAll(TOKEN_DECLARATION)) {
    tokens.set(
      match[1],
      hslToRgb(
        Number(match[2]),
        Number(match[3]) / 100,
        Number(match[4]) / 100,
      ),
    );
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

/** The colour stops of the filled-control sheen, strongest and weakest. */
function readGloss(block: string, name = "button-primary-gloss"): GlossStop[] {
  const start = block.indexOf(`--${name}:`);
  expect(start, `missing --${name}`).toBeGreaterThan(-1);
  const declaration = block.slice(start, block.indexOf(";", start));
  return [...declaration.matchAll(GLOSS_STOP)].map((match) => ({
    color: { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) },
    alpha: Number(match[4]) / 100,
  }));
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
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Source-over compositing of a translucent layer on an opaque surface. */
function over(layer: Rgb, surface: Rgb, alpha: number): Rgb {
  return {
    r: Math.round(layer.r * alpha + surface.r * (1 - alpha)),
    g: Math.round(layer.g * alpha + surface.g * (1 - alpha)),
    b: Math.round(layer.b * alpha + surface.b * (1 - alpha)),
  };
}

/** CSS `brightness()` scales each channel and applies to the label as well. */
function brightness(color: Rgb, factor: number): Rgb {
  const scale = (value: number) => Math.min(255, Math.round(value * factor));
  return { r: scale(color.r), g: scale(color.g), b: scale(color.b) };
}

function token(tokens: Map<string, Rgb>, name: string) {
  const value = tokens.get(name);
  expect(value, `missing --${name} token`).toBeDefined();
  return value as Rgb;
}

/** Rest, plus every hover and press brightness the filled primitives use. */
const brightnessFactors = [
  ...new Set([
    100,
    ...[...filledControls.matchAll(/(?:hover|active):brightness-(\d+)/gu)].map(
      (match) => Number(match[1]),
    ),
  ]),
].map((percent) => percent / 100);

/**
 * The lowest label contrast across both ends of the sheen and every state. A
 * gradient between two stops of one colour stays between its ends, so the ends
 * bound every pixel in between.
 */
function worstFilledLabel(
  fill: Rgb,
  label: Rgb,
  gloss: GlossStop[],
  factors: number[],
) {
  let worst = { ratio: Number.POSITIVE_INFINITY, state: "" };
  for (const stop of gloss) {
    const surface = over(stop.color, fill, stop.alpha);
    for (const factor of factors) {
      const ratio = contrastRatio(
        brightness(label, factor),
        brightness(surface, factor),
      );
      if (ratio < worst.ratio) {
        worst = {
          ratio,
          state: `sheen ${stop.alpha * 100}% at brightness ${factor}`,
        };
      }
    }
  }
  return worst;
}

const themes = [
  { name: "light", block: themeBlock(":root") },
  { name: "dark", block: themeBlock(".dark") },
].map(({ name, block }) => ({
  name,
  tokens: readTokens(block),
  gloss: readGloss(block),
}));

const SURFACES = ["background", "card", "popover", "muted"];
const SEMANTIC_TEXT_TOKENS = ["success", "info", "warning", "destructive"];

function uiSource(file: string) {
  return readFileSync(join(appDir, "..", "components", "ui", file), "utf8");
}

const alertSource = uiSource("alert.tsx");
/** Every primitive that puts semantic text on a tint of its own token. */
const tintedPrimitives = [
  alertSource,
  uiSource("badge.tsx"),
  uiSource("button-variants.ts"),
  uiSource("status-badge.tsx"),
].join("\n");

/**
 * The tint opacities a token is painted at, rest and hover alike. A class
 * without `dark:` also applies in dark mode, so the dark list keeps it. Menu
 * items focus at 10 and 20%, which the floor below always includes.
 */
function tintAlphas(source: string, name: string, themeName: string) {
  const percents = new Set([10, 20]);
  const utility = new RegExp(`(\\S*)bg-${name}/(\\d+)`, "gu");
  for (const match of source.matchAll(utility)) {
    if (themeName === "light" && match[1].includes("dark:")) continue;
    percents.add(Number(match[2]));
  }
  return [...percents].map((percent) => percent / 100);
}

/** The opacity of the description text the tinted alerts carry. */
const tintedDescriptionAlphas = [
  ...alertSource.matchAll(/alert-description\]:text-foreground\/(\d+)/gu),
].map((match) => Number(match[1]) / 100);
const destructiveDescriptionAlphas = [
  ...alertSource.matchAll(/alert-description\]:text-destructive\/(\d+)/gu),
].map((match) => Number(match[1]) / 100);

const referenceChanges: Record<string, Record<string, Rgb>> = {
  light: {
    background: hslToRgb(0, 0, 1),
    foreground: hslToRgb(240, 0.1, 0.039),
    card: hslToRgb(0, 0, 1),
    popover: hslToRgb(0, 0, 1),
    muted: hslToRgb(240, 0.048, 0.959),
    secondary: hslToRgb(240, 0.048, 0.959),
    accent: hslToRgb(240, 0.048, 0.959),
    primary: { r: 22, g: 163, b: 74 },
    "primary-foreground": { r: 255, g: 255, b: 255 },
    success: { r: 22, g: 163, b: 74 },
    info: hslToRgb(220, 0.91, 0.54),
    warning: hslToRgb(35, 0.77, 0.49),
    destructive: hslToRgb(0, 0.842, 0.602),
    "muted-foreground": hslToRgb(240, 0.038, 0.461),
  },
  dark: {
    background: hslToRgb(240, 0.23, 0.09),
    foreground: hslToRgb(226, 0.64, 0.88),
    card: hslToRgb(240, 0.21, 0.12),
    popover: hslToRgb(240, 0.21, 0.12),
    muted: hslToRgb(240, 0.21, 0.15),
    secondary: hslToRgb(237, 0.16, 0.23),
    accent: hslToRgb(237, 0.16, 0.23),
    primary: hslToRgb(115, 0.54, 0.76),
    "primary-foreground": hslToRgb(240, 0.23, 0.09),
    success: hslToRgb(115, 0.54, 0.76),
    warning: hslToRgb(41, 0.86, 0.83),
    info: hslToRgb(217, 0.92, 0.76),
    destructive: hslToRgb(343, 0.81, 0.75),
    "muted-foreground": hslToRgb(227, 0.3529411852359772, 0.8),
  },
};

// A reference pair below AA stays a measured limitation, never an AA pass.
function expectReferenceContrast(
  actual: number,
  reference: number,
  detail: string,
) {
  if (reference >= AA_NORMAL_TEXT) {
    expect(actual, detail).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  } else {
    expect(
      actual,
      `${detail}; approved reference ${reference.toFixed(2)}:1 is below AA`,
    ).toBeCloseTo(reference, 6);
    expect(actual).toBeLessThan(AA_NORMAL_TEXT);
  }
}

function measurePair(
  actual: Map<string, Rgb>,
  reference: Map<string, Rgb>,
  foreground: string,
  background: string,
  alpha = 0,
  tintName = "",
  textAlpha = 1,
) {
  const measure = (tokens: Map<string, Rgb>) => {
    const base = token(tokens, background);
    const surface = tintName
      ? over(token(tokens, tintName), base, alpha)
      : base;
    return contrastRatio(
      over(token(tokens, foreground), surface, textAlpha),
      surface,
    );
  };
  expectReferenceContrast(
    measure(actual),
    measure(reference),
    `${foreground} on ${background}, tint ${tintName} ${alpha}, text opacity ${textAlpha}`,
  );
}

describe("approved reference colors and measured contrast", () => {
  test("badges use the same themed primary fill, label and gloss as buttons", () => {
    const badge = uiSource("badge.tsx");
    expect(badge).toContain("bg-primary");
    expect(badge).toContain("text-primary-foreground");
    expect(badge).toContain("bg-[image:var(--button-primary-gloss)]");
    expect(badge).not.toContain("--badge-primary");
  });

  test("the primitives retain hover and press brightness", () => {
    expect(brightnessFactors.some((factor) => factor > 1)).toBe(true);
    expect(brightnessFactors.some((factor) => factor < 1)).toBe(true);
  });

  test("the primitives retain the light and dark tint coverage", () => {
    expect(tintAlphas(tintedPrimitives, "warning", "light")).toEqual([
      0.1, 0.2,
    ]);
    expect(tintAlphas(tintedPrimitives, "warning", "dark")).toContain(0.15);
    const darkOnly = tintAlphas(tintedPrimitives, "destructive", "dark").filter(
      (alpha) =>
        !tintAlphas(tintedPrimitives, "destructive", "light").includes(alpha),
    );
    expect(darkOnly.length).toBeGreaterThan(0);
  });

  for (const theme of themes) {
    const reference = new Map(Object.entries(referenceChanges[theme.name]));
    test(`${theme.name}: colors match the approved reference`, () => {
      for (const [name, value] of Object.entries(
        referenceChanges[theme.name],
      )) {
        expect(token(theme.tokens, name)).toEqual(value);
      }
      expect(token(theme.tokens, "primary")).toEqual(
        token(theme.tokens, "brand"),
      );
    });

    test(`${theme.name}: filled primary contrast is measured honestly across gloss and interaction states`, () => {
      const referenceGloss = [
        {
          color: { r: 255, g: 255, b: 255 },
          alpha: theme.name === "light" ? 0.18 : 0.3,
        },
        { color: { r: 255, g: 255, b: 255 }, alpha: 0 },
      ];
      expect(theme.gloss).toEqual(referenceGloss);
      const actual = worstFilledLabel(
        token(theme.tokens, "primary"),
        token(theme.tokens, "primary-foreground"),
        theme.gloss,
        brightnessFactors,
      );
      const expected = worstFilledLabel(
        token(reference, "primary"),
        token(reference, "primary-foreground"),
        referenceGloss,
        brightnessFactors,
      );
      expectReferenceContrast(actual.ratio, expected.ratio, actual.state);
      if (theme.name === "light") {
        const solid = contrastRatio(
          token(theme.tokens, "primary"),
          token(theme.tokens, "primary-foreground"),
        );
        expect(solid).toBeCloseTo(3.2957336, 5);
        expect(solid).toBeLessThan(AA_NORMAL_TEXT);
      }
    });

    for (const name of ["primary", ...SEMANTIC_TEXT_TOKENS]) {
      test(`${theme.name}: ${name} plain and tinted reference contrast, with AA required where the reference meets it`, () => {
        for (const surface of SURFACES) {
          measurePair(theme.tokens, reference, name, surface);
          for (const alpha of tintAlphas(tintedPrimitives, name, theme.name)) {
            measurePair(theme.tokens, reference, name, surface, alpha, name);
          }
        }
      });
    }

    test(`${theme.name}: alert descriptions preserve reference contrast`, () => {
      expect(tintedDescriptionAlphas).toHaveLength(3);
      expect(new Set(tintedDescriptionAlphas).size).toBe(1);
      expect(destructiveDescriptionAlphas).toHaveLength(1);
      for (const name of ["info", "success", "warning"]) {
        for (const surface of SURFACES) {
          for (const alpha of tintAlphas(alertSource, name, theme.name)) {
            for (const textAlpha of tintedDescriptionAlphas) {
              measurePair(
                theme.tokens,
                reference,
                "foreground",
                surface,
                alpha,
                name,
                textAlpha,
              );
            }
          }
        }
      }
      for (const textAlpha of destructiveDescriptionAlphas) {
        measurePair(
          theme.tokens,
          reference,
          "destructive",
          "card",
          0,
          "",
          textAlpha,
        );
      }
    });

    test(`${theme.name}: muted reference contrast on plain surfaces records limitations without changing grey`, () => {
      expect(alertSource).toContain("text-muted-foreground");
      for (const surface of [...SURFACES, "secondary", "accent"]) {
        measurePair(theme.tokens, reference, "muted-foreground", surface);
      }
    });

    test(`${theme.name}: attachment errors preserve reference contrast at rest and hover`, () => {
      const attachment = uiSource("attachment.tsx");
      const alphas = [
        ...attachment.matchAll(/attachment:text-destructive\/(\d+)/gu),
      ].map((match) => Number(match[1]) / 100);
      expect(alphas.length).toBeGreaterThan(0);
      expect(attachment).toContain("hover:bg-muted/50");
      for (const alpha of alphas) {
        measurePair(
          theme.tokens,
          reference,
          "destructive",
          "card",
          0,
          "",
          alpha,
        );
        measurePair(
          theme.tokens,
          reference,
          "destructive",
          "card",
          0.5,
          "muted",
          alpha,
        );
      }
    });
  }
});
