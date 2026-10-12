import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TEXT_LINK_CLASS } from "@/lib/text-link";
import AcknowledgementsPage from "./page";

const openingAnchors = (html: string) => html.match(/<a\b[^>]*>/gu) ?? [];
const classesOf = (tag: string) =>
  (/class="([^"]*)"/u.exec(tag)?.[1] ?? "").split(/\s+/u).filter(Boolean);
const hrefOf = (tag: string) => /href="([^"]*)"/u.exec(tag)?.[1];

describe("content text links", () => {
  const tokens = TEXT_LINK_CLASS.split(/\s+/u);

  test("the shared class is semantic green with a non-colour cue and a visible focus ring", () => {
    expect(tokens).toContain("text-primary");
    expect(tokens).toContain("underline");
    expect(tokens).toContain("hover:decoration-primary");
    expect(tokens).toContain("focus-visible:ring-2");
    expect(tokens).toContain("focus-visible:ring-primary");
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
