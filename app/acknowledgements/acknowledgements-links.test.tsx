import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { TEXT_LINK_CLASS } from "@/lib/text-link";
import AcknowledgementsPage from "./page";

const openingAnchors = (html: string) => html.match(/<a\b[^>]*>/gu) ?? [];
const classesOf = (tag: string) =>
  (/class="([^"]*)"/u.exec(tag)?.[1] ?? "").split(/\s+/u).filter(Boolean);
const hrefOf = (tag: string) => /href="([^"]*)"/u.exec(tag)?.[1];

const globalsCss = readFileSync(
  new URL("../globals.css", import.meta.url),
  "utf8",
);

// Declarations in source order: the light value first, then the dark one.
const declared = (token: string) =>
  [...globalsCss.matchAll(new RegExp(`--${token}:\\s*hsl\\(([^)]+)\\)`, "gu"))]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);

function luminance(hsl: string) {
  const [h = 0, s = 0, l = 0] = (hsl.match(/[\d.]+/gu) ?? []).map(Number);
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(first: string, second: string) {
  const [dark, light] = [luminance(first), luminance(second)].sort(
    (a, b) => a - b,
  );
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe("content text links", () => {
  const tokens = TEXT_LINK_CLASS.split(/\s+/u);

  test("the shared class is the content-link green with a non-colour cue and a visible focus ring", () => {
    expect(tokens).toContain("text-content-link");
    expect(tokens).toContain("underline");
    expect(tokens).toContain("hover:decoration-content-link");
    expect(tokens).toContain("focus-visible:ring-2");
    expect(tokens).toContain("focus-visible:ring-content-link");
  });

  test("the shared class never takes the decorative brand token or a raw colour", () => {
    for (const token of tokens) {
      expect(token).not.toContain("brand");
      expect(token).not.toMatch(/#[0-9a-f]{3,8}|rgb|hsl/iu);
      expect(token).not.toMatch(
        /(?:green|emerald|lime|teal)-\d{2,3}(?:\/\d+)?$/u,
      );
    }
  });

  test("the content-link token is declared per theme and mapped for utilities", () => {
    expect(declared("content-link")).toEqual(declared("primary"));
    expect(declared("primary")).toEqual(["142.1 76.2% 36.3%", "115 54% 76%"]);
    expect(globalsCss).toContain("--color-content-link: var(--content-link);");
  });

  // Arithmetic on the declared token values against the solid page and card
  // surfaces. It says nothing about tinted or translucent surfaces, and it is
  // not a rendered measurement.
  test("content links retain the measured reference contrast in each theme", () => {
    const links = declared("content-link");
    expect(links).toHaveLength(2);
    for (const surface of ["background", "card"]) {
      const surfaces = declared(surface);
      expect(surfaces).toHaveLength(2);
      for (const [theme, link] of links.entries()) {
        const ratio = contrast(link, surfaces[theme] ?? "");
        if (theme === 0) {
          expect(ratio).toBeGreaterThan(3.2);
          expect(ratio).toBeLessThan(3.4);
        } else {
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  test("every Acknowledgements link renders with the shared class", () => {
    const anchors = openingAnchors(
      renderToStaticMarkup(<AcknowledgementsPage />),
    );

    expect(anchors.map(hrefOf)).toEqual([
      "https://riddhimanrana.com",
      "https://riddhimanrana.com/blog/building-lets-assist",
      "https://github.com/riddhimanrana/lets-assist",
    ]);
    for (const anchor of anchors) {
      expect(classesOf(anchor)).toEqual(expect.arrayContaining(tokens));
    }
  });
});
