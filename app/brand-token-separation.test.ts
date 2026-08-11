import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * CLEAN-004 darkened `--primary` to clear WCAG AA behind
 * `--primary-foreground`, which is correct for buttons, links, status text, and
 * focus rings. But `--primary` was doing a second, unrelated job: it also
 * painted the decorative organization-header washes. Darkening it there read as
 * a global rebrand — the CSF Classes page stopped looking like Production,
 * whose identity green is `#16a34a` and still ships in every transactional
 * email and the OpenGraph card.
 *
 * `--brand` splits those two jobs apart. This file is the contract for that
 * split, and it has to be a source test rather than a browser test: the failure
 * mode is someone reaching for the nearest green token, which renders fine and
 * only shows up as drift against Production.
 */

const appDir = import.meta.dir;
const repoRoot = join(appDir, "..");
const css = readFileSync(join(appDir, "globals.css"), "utf8");

const AA_NORMAL_TEXT = 4.5;

/** Production identity green: `#16a34a`, as shipped by `emails/` and the OG card. */
const PRODUCTION_BRAND = { r: 22, g: 163, b: 74 };
/** The AA-tuned semantic green: `#117e39`. */
const ACCESSIBLE_PRIMARY = { r: 17, g: 126, b: 57 };

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

/** Tailwind's `/15`-style opacity modifiers composite the token over the surface. */
function tint(color: Rgb, surface: Rgb, alpha: number): Rgb {
  return {
    r: Math.round(color.r * alpha + surface.r * (1 - alpha)),
    g: Math.round(color.g * alpha + surface.g * (1 - alpha)),
    b: Math.round(color.b * alpha + surface.b * (1 - alpha)),
  };
}

const light = readTokens(themeBlock(":root"));
const dark = readTokens(themeBlock(".dark"));

function token(tokens: Map<string, Rgb>, name: string) {
  const value = tokens.get(name);
  expect(value, `missing --${name} token`).toBeDefined();
  return value as Rgb;
}

describe("the brand token carries identity, the primary token carries meaning", () => {
  test("light --brand is the Production identity green", () => {
    expect(token(light, "brand")).toEqual(PRODUCTION_BRAND);
  });

  test("light --primary keeps the AA-tuned green, not the identity green", () => {
    expect(token(light, "primary")).toEqual(ACCESSIBLE_PRIMARY);
    expect(token(light, "primary")).not.toEqual(PRODUCTION_BRAND);
  });

  test("the focus ring tracks --primary, never --brand", () => {
    expect(token(light, "ring")).toEqual(token(light, "primary"));
    expect(token(light, "ring")).not.toEqual(token(light, "brand"));
  });

  test("dark --brand is pinned to dark --primary so dark mode is unchanged", () => {
    // Light mode needed the split because AA forced --primary off the identity
    // hue. Dark mode never had that conflict, so introducing --brand there must
    // be a visual no-op. Without this declaration the `:root` value would
    // cascade into dark mode and silently repaint every wash.
    expect(token(dark, "brand")).toEqual(token(dark, "primary"));
  });

  test("--brand is exposed to Tailwind exactly once, as a color", () => {
    expect(css).toContain("--color-brand: var(--brand);");
  });
});

describe("decorative brand surfaces", () => {
  const decorative: Array<{ file: string; label: string; match: RegExp }> = [
    {
      file: "app/organization/[id]/page.tsx",
      label: "organization header backdrop wash",
      match: /from-brand\/15 via-brand\/5 to-background\/0/u,
    },
    {
      file: "components/organization/OrganizationHeader.tsx",
      label: "organization avatar monogram tint",
      match: /bg-brand\/10/u,
    },
  ];

  for (const surface of decorative) {
    test(`${surface.label} is painted with --brand`, () => {
      const source = readFileSync(join(repoRoot, surface.file), "utf8");
      expect(source).toMatch(surface.match);
    });
  }

  test("the verified badge stays on --primary because it reports state", () => {
    const source = readFileSync(
      join(repoRoot, "components/organization/OrganizationHeader.tsx"),
      "utf8",
    );
    expect(source).toContain("text-primary fill-background");
    expect(source).not.toMatch(/text-brand/u);
  });
});

describe("--brand never reaches an interactive or text-bearing surface", () => {
  /**
   * `--brand` is lighter than `--primary` by design, so it is *below* AA behind
   * `--primary-foreground` and as body text on white. The only safe use is a
   * low-opacity background wash. Rather than trusting a comment in `globals.css`
   * to hold that line, scan the tree: any brand utility that is not an
   * opacity-modified background or gradient stop is a defect.
   */
  const SAFE_BRAND_UTILITY = /^(?:bg|from|via|to)-brand\/\d+$/u;
  const ANY_BRAND_UTILITY = /(?<![\w-])[a-z-]*brand(?:\/\d+)?(?![\w-])/gu;

  function sourceFiles(dir: string): string[] {
    const skip = new Set(["node_modules", ".next", ".git", "private"]);
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        found.push(...sourceFiles(path));
      } else if (
        /\.tsx?$/u.test(entry.name) &&
        !/\.test\.tsx?$/u.test(entry.name)
      ) {
        found.push(path);
      }
    }
    return found;
  }

  test("every brand utility in the tree is a decorative tint", () => {
    const violations: string[] = [];

    for (const path of [
      ...sourceFiles(join(repoRoot, "app")),
      ...sourceFiles(join(repoRoot, "components")),
    ]) {
      const source = readFileSync(path, "utf8");
      for (const [utility] of source.matchAll(ANY_BRAND_UTILITY)) {
        // `brand` also appears as a plain identifier (props, variable names).
        // Only Tailwind-shaped tokens are in scope here.
        if (
          !/^(?:bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|decoration|divide|accent|caret)-brand/u.test(
            utility,
          )
        ) {
          continue;
        }
        if (SAFE_BRAND_UTILITY.test(utility)) continue;
        violations.push(`${relative(repoRoot, path)}: ${utility}`);
      }
    }

    expect(
      violations,
      `--brand is decorative only; use --primary for text, icons, controls, and focus rings:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the brand washes still clear WCAG AA", () => {
  const background = token(light, "background");

  test("the monogram reads on the 10% brand avatar tint", () => {
    const surface = tint(token(light, "brand"), background, 0.1);
    const ratio = contrastRatio(token(light, "foreground"), surface);
    expect(
      ratio,
      `--foreground on 10% --brand is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test("muted header text reads on the strongest 15% wash stop", () => {
    // The `@username` and the organization-type badge sit in the darkest stop of
    // the header gradient, so this is the wash's worst case.
    const surface = tint(token(light, "brand"), background, 0.15);
    const ratio = contrastRatio(token(light, "muted-foreground"), surface);
    expect(
      ratio,
      `--muted-foreground on 15% --brand is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test("the brand wash is lighter than the primary wash it replaced", () => {
    // Restoring the identity green is not an accessibility regression: --brand
    // is lighter than --primary, so every tint built from it composites to a
    // paler surface and clears more contrast, not less. The 15% primary wash
    // measured 4.42:1 against --muted-foreground, i.e. below AA.
    const brandWash = tint(token(light, "brand"), background, 0.15);
    const primaryWash = tint(token(light, "primary"), background, 0.15);
    const muted = token(light, "muted-foreground");
    expect(contrastRatio(muted, brandWash)).toBeGreaterThan(
      contrastRatio(muted, primaryWash),
    );
    expect(contrastRatio(muted, primaryWash)).toBeLessThan(AA_NORMAL_TEXT);
  });
});
