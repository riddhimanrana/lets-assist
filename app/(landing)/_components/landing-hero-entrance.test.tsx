import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { securityResponseHeaders } from "@/lib/security/response-headers";

import { HeroHeading, HERO_HEADLINE_TEXT } from "./HeroHeading";
import { HeroVideo } from "./HeroVideo";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const PURPLE = /\b(?:indigo|purple|violet|fuchsia|pink)-\d{2,3}\b/u;

describe("landing headline entrance", () => {
  const html = renderToStaticMarkup(<HeroHeading className="fixture" />);
  const letters = [
    ...html.matchAll(
      /<span class="la-hero-letter inline-block" style="--la-delay:([\d.]+)s">([^<])<\/span>/gu,
    ),
  ];

  test("the h1 gives assistive technology its full text exactly once", () => {
    expect(HERO_HEADLINE_TEXT).toBe("The modern way to do volunteering");
    expect(html.match(/<h1\b/gu)).toHaveLength(1);
    expect(html).toStartWith(
      `<h1 class="fixture"><span class="sr-only">${HERO_HEADLINE_TEXT}</span>`,
    );
    // Everything after the readable text is a decorative line.
    const lines = html
      .slice(html.indexOf("</span>") + "</span>".length, -"</h1>".length)
      .split(/(?=<span aria-hidden="true")/u);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toStartWith('<span aria-hidden="true" class="block');
    }
    expect(html).not.toContain("aria-label");
  });

  test("the decorative letters spell the same headline in its final layout", () => {
    expect(letters.map(([, , letter]) => letter).join("")).toBe(
      HERO_HEADLINE_TEXT.replaceAll(" ", ""),
    );
    // Only the delay is inline. Nothing sizes, hides or moves a letter in
    // the markup, so the heading has its final dimensions without a script.
    expect(html.match(/style="/gu)).toHaveLength(letters.length);
    expect(html).not.toMatch(/opacity|transform|data-visible/u);
    // The green word keeps the semantic text token.
    expect(html).toContain('class="block text-primary"');
    expect(html).not.toContain("brand");
  });

  test("the letters enter in reading order over about a second", () => {
    const delays = letters.map(([, delay]) => Number(delay));
    expect(delays[0]).toBeCloseTo(0.04);
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]).toBeGreaterThan(delays[index - 1]);
    }
    expect((delays.at(-1) ?? 0) + 0.62).toBeLessThan(1.5);
  });

  test("the stylesheet plays the entrance once and only when motion is welcome", () => {
    const css = read("../../globals.css");
    const rules = [...css.matchAll(/\.la-hero-letter\s*\{([^}]*)\}/gu)];

    // One rule, and it sits inside the no-preference query. A reduced-motion
    // visitor gets the resting state, which is the final one.
    expect(rules).toHaveLength(1);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.la-hero-letter\s*\{/u,
    );
    const declaration = rules[0][1].replace(/\s+/gu, " ");
    expect(declaration).toContain("la-hero-letter-in 0.62s");
    expect(declaration).toContain("var(--la-delay, 0s) 1 both");
    expect(declaration).not.toContain("infinite");
    expect(declaration).not.toMatch(/opacity|transform|filter/u);
  });

  test("the hero renders the headline through this component", () => {
    const hero = read("./HeroContent.tsx");
    expect(hero.match(/<HeroHeading\b/gu)).toHaveLength(1);
    expect(hero).not.toMatch(/<h1\b/u);
  });
});

describe("demo video surfaces", () => {
  test("the thumbnail has no purple glow and mounts no player until opened", () => {
    const html = renderToStaticMarkup(<HeroVideo />);
    expect(html).toContain("Watch video");
    expect(html).not.toMatch(PURPLE);
    expect(html).not.toContain("blur-2xl");
    expect(html).not.toContain("<iframe");
  });

  test("no landing video dialog paints an app-owned purple layer", () => {
    for (const file of ["./HeroVideo.tsx", "./CallToAction.tsx"]) {
      const source = read(file);
      expect(source).not.toMatch(PURPLE);
      // The same video, title and player permissions as before.
      expect(source).toContain("0Smto1UOqTY");
      expect(source).toContain('title="Let\'s Assist Demo"');
      expect(source).toContain("allowFullScreen");
    }
  });

  // Source only. The painted backing and the 44px box are measured in a
  // browser, and nothing here speaks for the real YouTube player.
  test("each video dialog scopes a 44px white-on-black close button to itself", () => {
    const close = "[&>[data-slot=dialog-close]]:";
    for (const file of ["./HeroVideo.tsx", "./CallToAction.tsx"]) {
      const source = read(file);
      for (const utility of [
        "size-11",
        "top-2.5",
        "right-2.5",
        "bg-black/70",
        "text-white",
        "hover:bg-black/90",
        "hover:text-white",
        "focus-visible:ring-white",
        // Inset, so the white ring is drawn on the button's own black.
        "focus-visible:ring-inset",
      ]) {
        expect(source).toContain(`${close}${utility}`);
      }
    }
  });

  // Source only as well: the dialog is portalled, so a server render has no
  // open popup to read. This holds the structure that keeps the button off
  // the player. Whether it clears the player on screen, and anything about
  // playback, is a browser measurement.
  test("each video dialog draws its title and close button in a bar above the player", () => {
    const close = "[&>[data-slot=dialog-close]]:";
    for (const file of ["./HeroVideo.tsx", "./CallToAction.tsx"]) {
      const source = read(file);
      const content = source.slice(
        source.indexOf("<DialogContent"),
        source.indexOf("</DialogContent>"),
      );
      const toolbarStart = content.indexOf('data-slot="video-dialog-toolbar"');
      const playerStart = content.indexOf('data-slot="video-dialog-player"');
      expect(toolbarStart).toBeGreaterThan(-1);
      expect(playerStart).toBeGreaterThan(toolbarStart);

      const toolbar = content.slice(toolbarStart, playerStart);
      const player = content.slice(playerStart);

      // The bar closes before the player opens: siblings, not nested.
      expect(toolbar.match(/<\/div>/gu)).toHaveLength(1);
      expect(toolbar.match(/<div\b/gu)).toHaveLength(1);
      expect(toolbar).not.toContain("<iframe");
      expect(player.match(/<iframe\b/gu)).toHaveLength(1);

      // One title, visible, under the name the dialog already had.
      expect(source.match(/<DialogTitle\b/gu)).toHaveLength(1);
      expect(toolbar).toMatch(
        /<DialogTitle\b[^>]*>\s*Let&apos;s Assist demo video\s*<\/DialogTitle>/u,
      );
      expect(source).not.toContain("sr-only");

      // The button is 10px in and 44px square, so it ends at 54px. The bar
      // is at least 64px tall and keeps 64px clear on the right for it.
      for (const utility of [
        "min-h-16",
        "pr-16",
        "bg-background",
        "text-foreground",
      ]) {
        expect(toolbar).toContain(utility);
      }
      expect(content).toContain(`${close}top-2.5`);
      expect(content).toContain(`${close}right-2.5`);
      expect(content).toContain(`${close}size-11`);

      // The player keeps its own box.
      expect(player).toContain("relative aspect-video min-h-[200px] w-full");
    }
  });

  test("each YouTube embed sends the app origin while the site default stays no-referrer", () => {
    for (const file of ["./HeroVideo.tsx", "./CallToAction.tsx"]) {
      const iframes = read(file).match(/<iframe\b[\s\S]*?\/>/gu) ?? [];
      expect(iframes).toHaveLength(1);
      const iframe = iframes[0];
      if (!iframe) throw new Error("The demo iframe is missing");
      // YouTube answers an embed that carries no referrer with Error 153.
      // This policy sends the origin only, never a path or a query.
      expect(iframe.match(/referrerPolicy="([^"]*)"/gu) ?? []).toEqual([
        'referrerPolicy="strict-origin-when-cross-origin"',
      ]);
    }

    // The exception lives on the two iframes. Every other request keeps the
    // site-wide header.
    const headers = securityResponseHeaders(true)[0]?.headers ?? [];
    expect(
      headers.filter((header) => header.key === "Referrer-Policy"),
    ).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
  });
});
