import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Small text on the semantic tokens, measured at the worst enabled state.
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
  return tokens;
}

/** The colour stops of the filled-control sheen, strongest and weakest. */
function readGloss(block: string): GlossStop[] {
  const start = block.indexOf("--button-primary-gloss:");
  expect(start, "missing --button-primary-gloss").toBeGreaterThan(-1);
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
const SEMANTIC_TEXT_TOKENS = [
  "primary",
  "success",
  "info",
  "warning",
  "destructive",
];

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

describe("filled control labels at their worst enabled state", () => {
  test("the primitives still expose a hover and a press brightness", () => {
    expect(brightnessFactors.some((factor) => factor > 1)).toBe(true);
    expect(brightnessFactors.some((factor) => factor < 1)).toBe(true);
  });

  for (const theme of themes) {
    test(`${theme.name}: label on the primary fill under the sheen, hover and press`, () => {
      expect(theme.gloss.length).toBeGreaterThanOrEqual(2);
      const worst = worstFilledLabel(
        token(theme.tokens, "primary"),
        token(theme.tokens, "primary-foreground"),
        theme.gloss,
        brightnessFactors,
      );
      expect(
        worst.ratio,
        `${worst.ratio.toFixed(2)}:1 with ${worst.state}`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
  }

  test("the same measurement rejects the light finish it replaced", () => {
    // Identity green fill, the unchanged label, and the earlier 18% sheen.
    const white = { r: 255, g: 255, b: 255 };
    const worst = worstFilledLabel(
      { r: 22, g: 163, b: 74 },
      { r: 255, g: 241, b: 242 },
      [
        { color: white, alpha: 0.18 },
        { color: white, alpha: 0 },
      ],
      brightnessFactors,
    );
    expect(worst.ratio).toBeLessThan(AA_NORMAL_TEXT);
  });
});

describe("semantic text on plain and tinted surfaces", () => {
  test("the primitives declare the tints this file measures", () => {
    // Light statuses rest at 10% and hover at 20%. Dark alerts sit at 15%.
    expect(tintAlphas(tintedPrimitives, "warning", "light")).toEqual([
      0.1, 0.2,
    ]);
    expect(tintAlphas(tintedPrimitives, "warning", "dark")).toContain(0.15);
    // A dark-only tint must not leak into the light list.
    const darkOnly = tintAlphas(tintedPrimitives, "destructive", "dark").filter(
      (alpha) =>
        !tintAlphas(tintedPrimitives, "destructive", "light").includes(alpha),
    );
    expect(darkOnly.length).toBeGreaterThan(0);
  });

  for (const theme of themes) {
    for (const name of SEMANTIC_TEXT_TOKENS) {
      test(`${theme.name}: ${name} text on the plain surfaces`, () => {
        for (const surfaceName of SURFACES) {
          const ratio = contrastRatio(
            token(theme.tokens, name),
            token(theme.tokens, surfaceName),
          );
          expect(
            ratio,
            `--${name} on --${surfaceName} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        }
      });

      test(`${theme.name}: ${name} text on its own tint at rest and on hover`, () => {
        const text = token(theme.tokens, name);
        for (const surfaceName of SURFACES) {
          for (const alpha of tintAlphas(tintedPrimitives, name, theme.name)) {
            const surface = over(text, token(theme.tokens, surfaceName), alpha);
            const ratio = contrastRatio(text, surface);
            expect(
              ratio,
              `--${name} on ${alpha * 100}% --${name} over --${surfaceName} is ${ratio.toFixed(2)}:1`,
            ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
          }
        }
      });
    }
  }
});

describe("alert descriptions", () => {
  test("each tinted variant carries the stronger description", () => {
    expect(tintedDescriptionAlphas).toHaveLength(3);
    expect(new Set(tintedDescriptionAlphas).size).toBe(1);
    expect(destructiveDescriptionAlphas).toHaveLength(1);
  });

  for (const theme of themes) {
    test(`${theme.name}: description on the info, success and warning tints`, () => {
      const foreground = token(theme.tokens, "foreground");
      for (const name of ["info", "success", "warning"]) {
        for (const surfaceName of SURFACES) {
          for (const alpha of tintAlphas(alertSource, name, theme.name)) {
            const surface = over(
              token(theme.tokens, name),
              token(theme.tokens, surfaceName),
              alpha,
            );
            for (const textAlpha of tintedDescriptionAlphas) {
              const ratio = contrastRatio(
                over(foreground, surface, textAlpha),
                surface,
              );
              expect(
                ratio,
                `description on ${alpha * 100}% --${name} over --${surfaceName} is ${ratio.toFixed(2)}:1`,
              ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
            }
          }
        }
      }
    });

    test(`${theme.name}: description on the destructive alert's card`, () => {
      const card = token(theme.tokens, "card");
      for (const textAlpha of destructiveDescriptionAlphas) {
        const ratio = contrastRatio(
          over(token(theme.tokens, "destructive"), card, textAlpha),
          card,
        );
        expect(
          ratio,
          `destructive description on --card is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    });

    test(`${theme.name}: the default alert keeps muted text, which passes on its card`, () => {
      expect(alertSource).toContain("text-muted-foreground");
      for (const surfaceName of ["background", "card", "popover"]) {
        const ratio = contrastRatio(
          token(theme.tokens, "muted-foreground"),
          token(theme.tokens, surfaceName),
        );
        expect(
          ratio,
          `--muted-foreground on --${surfaceName} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    });
  }

  test("light muted text on a tint is the case the stronger description replaces", () => {
    const light = themes[0].tokens;
    const surface = over(token(light, "info"), token(light, "background"), 0.1);
    expect(
      contrastRatio(token(light, "muted-foreground"), surface),
    ).toBeLessThan(AA_NORMAL_TEXT);
  });
});

describe("neutral text on the plain surfaces", () => {
  const NEUTRAL_SURFACES = [...SURFACES, "secondary", "accent"];

  for (const theme of themes) {
    test(`${theme.name}: muted text on every plain surface, tinted or not`, () => {
      for (const surfaceName of NEUTRAL_SURFACES) {
        const ratio = contrastRatio(
          token(theme.tokens, "muted-foreground"),
          token(theme.tokens, surfaceName),
        );
        expect(
          ratio,
          `--muted-foreground on --${surfaceName} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    });
  }

  test("the same measurement rejects the grey it replaced on the muted surface", () => {
    const ratio = contrastRatio(
      { r: 113, g: 113, b: 122 },
      token(themes[0].tokens, "muted"),
    );
    expect(ratio).toBeLessThan(AA_NORMAL_TEXT);
  });
});

describe("attachment error description", () => {
  const attachmentSource = uiSource("attachment.tsx");
  const errorTextAlphas = [
    ...attachmentSource.matchAll(/attachment:text-destructive\/(\d+)/gu),
  ].map((match) => Number(match[1]) / 100);

  test("the attachment still declares a translucent destructive description", () => {
    expect(errorTextAlphas.length).toBeGreaterThan(0);
    expect(attachmentSource).toContain("hover:bg-muted/50");
  });

  for (const theme of themes) {
    test(`${theme.name}: translucent destructive text on the card at rest and on hover`, () => {
      const card = token(theme.tokens, "card");
      const hovered = over(token(theme.tokens, "muted"), card, 0.5);
      for (const surface of [card, hovered]) {
        for (const textAlpha of errorTextAlphas) {
          const ratio = contrastRatio(
            over(token(theme.tokens, "destructive"), surface, textAlpha),
            surface,
          );
          expect(
            ratio,
            `destructive at ${textAlpha * 100}% is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        }
      }
    });
  }
});

describe("the semantic step leaves the identity alone", () => {
  const light = themes[0].tokens;

  test("light --brand keeps the identity green and is not the text token", () => {
    expect(token(light, "brand")).toEqual({ r: 22, g: 163, b: 74 });
    expect(token(light, "primary")).not.toEqual(token(light, "brand"));
  });

  test("the focus ring follows --primary", () => {
    expect(token(light, "ring")).toEqual(token(light, "primary"));
  });
});
