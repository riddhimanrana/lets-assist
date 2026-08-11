import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Regressions the synthetic CSF lifecycle atlas caught in the global footer at
 * 320x568, all of them axe `target-size` (serious):
 *
 * - the system-status tooltip trigger/link measured 82.3x17 with a 1.2px safe
 *   diameter, because the badge sized itself from `py-0.5` + `leading-none`.
 * - the mobile Instagram, Twitter/X and Email links were bare 16x16 glyphs
 *   with no padding and not enough neighbour spacing to compensate.
 *
 * The footer renders on every page, so each of these was a site-wide failure.
 * WCAG 2.2 SC 2.5.8 (AA) puts the floor at 24x24 CSS px.
 */

const MIN_TARGET_PX = 24;
const TAILWIND_SPACING_STEP_PX = 4;

const footerSource = readFileSync(
  new URL("./Footer.tsx", import.meta.url),
  "utf8",
);

/** `size-8` / `min-h-6` -> the CSS pixel value of that Tailwind spacing step. */
function spacingStepToPx(utility: string): number {
  const step = utility.match(/-(\d+(?:\.\d+)?)$/);
  if (!step) {
    throw new Error(`not a numeric spacing utility: ${utility}`);
  }
  return Number(step[1]) * TAILWIND_SPACING_STEP_PX;
}

function classConstant(name: string): string {
  const declaration = footerSource.match(
    new RegExp(`const ${name} =\\s*("(?:[^"\\\\]|\\\\.)*");`),
  );
  if (!declaration) {
    throw new Error(`missing class constant: ${name}`);
  }
  return JSON.parse(declaration[1]) as string;
}

function sourceSection(startMarker: string, endMarker?: string): string {
  const start = footerSource.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`missing source marker: ${startMarker}`);
  }
  const end = endMarker ? footerSource.indexOf(endMarker, start) : -1;
  return footerSource.slice(start, end === -1 ? undefined : end);
}

const statusLinkClass = classConstant("FOOTER_STATUS_LINK_CLASS");
const iconLinkClass = classConstant("FOOTER_ICON_LINK_CLASS");

const socialLinkData = sourceSection(
  "const FOOTER_SOCIAL_LINKS",
  "function FooterSocialLinks",
);
const socialLinkRenderer = sourceSection(
  "function FooterSocialLinks",
  "export function Footer",
);
const mobileBottomGroup = sourceSection(
  '<div className="ml-3 mr-3 border-t pt-4">',
  "{/* Desktop layout */}",
);
const desktopLayout = sourceSection("{/* Desktop layout */}");

describe("footer system-status target", () => {
  test("holds at least a 24px physical height", () => {
    const minHeight = statusLinkClass
      .split(/\s+/)
      .find((utility) => utility.startsWith("min-h-"));

    expect(minHeight, "status badge has no min-height floor").toBeDefined();
    expect(spacingStepToPx(minHeight ?? "")).toBeGreaterThanOrEqual(
      MIN_TARGET_PX,
    );
  });

  test("stays an inline badge with a visible focus ring", () => {
    expect(statusLinkClass).toContain("inline-flex");
    expect(statusLinkClass).toContain("items-center");
    expect(statusLinkClass).toContain("rounded-full");
    expect(statusLinkClass).toContain("focus-visible:ring-[3px]");
    expect(statusLinkClass).toContain("focus-visible:ring-ring/50");
  });

  test("keeps the status tone, dot and label", () => {
    expect(footerSource).toContain(
      "cn(FOOTER_STATUS_LINK_CLASS, statusMeta.badgeClassName)",
    );
    expect(footerSource).toContain(
      'cn("size-2 rounded-full", statusMeta.dotClassName)',
    );
    expect(footerSource).toContain(
      "aria-label={`System status: ${statusMeta.label}`}",
    );
  });

  test("keeps the href and the no-nested-interactive tooltip trigger", () => {
    const trigger = sourceSection("<TooltipTrigger", "<TooltipContent");

    // `render` hands the anchor to Base UI as the trigger element. Wrapping
    // the link in the default trigger button would nest interactives instead.
    expect(trigger).toContain("render={");
    expect(trigger).toContain("<Link");
    expect(trigger).toContain('href="https://status.lets-assist.com"');
    expect(footerSource).not.toContain("<TooltipTrigger>");
  });
});

describe("footer social and email targets", () => {
  test("give every icon link a >=24x24 hit area", () => {
    const size = iconLinkClass
      .split(/\s+/)
      .find((utility) => /^size-\d/.test(utility));

    expect(size, "icon link has no explicit box size").toBeDefined();
    expect(spacingStepToPx(size ?? "")).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  });

  test("center the glyph and carry a rounded focus/hover treatment", () => {
    expect(iconLinkClass).toContain("inline-flex");
    expect(iconLinkClass).toContain("items-center");
    expect(iconLinkClass).toContain("justify-center");
    expect(iconLinkClass).toContain("rounded-md");
    expect(iconLinkClass).toContain("hover:bg-accent");
    expect(iconLinkClass).toContain("focus-visible:ring-[3px]");
    expect(iconLinkClass).toContain("focus-visible:ring-ring/50");
  });

  test("keep the glyphs themselves at 16x16", () => {
    expect(socialLinkData.match(/className="size-4"/g)).toHaveLength(3);
    expect(socialLinkData).not.toContain("h-4 w-4");
  });

  test("expose exactly three links with unchanged names and hrefs", () => {
    const pairs = [
      ...socialLinkData.matchAll(/href: "([^"]+)",\s*\n\s*label: "([^"]+)",/g),
    ].map(([, href, label]) => ({ href, label }));

    expect(pairs).toEqual([
      { href: "https://instagram.com/letsassist.app", label: "Instagram" },
      { href: "https://x.com/letsassistapp", label: "Twitter" },
      { href: "mailto:contact@lets-assist.com", label: "Email" },
    ]);
  });

  test("apply the same target contract to both layouts", () => {
    // One shared renderer means the two layouts cannot drift apart again.
    expect(footerSource.match(/<FooterSocialLinks\b/g)).toHaveLength(2);
    expect(mobileBottomGroup).toContain("<FooterSocialLinks");
    expect(desktopLayout).toContain("<FooterSocialLinks");

    expect(socialLinkRenderer).toContain("FOOTER_SOCIAL_LINKS.map");
    expect(socialLinkRenderer).toContain("className={FOOTER_ICON_LINK_CLASS}");
    expect(socialLinkRenderer).toContain("aria-label={link.label}");
    expect(socialLinkRenderer).toContain(
      'rel={isExternal ? "noopener noreferrer" : undefined}',
    );
  });
});

describe("footer mobile bottom group", () => {
  test("stacks the copyright/status cluster above the social controls", () => {
    expect(mobileBottomGroup).toContain("flex flex-col gap-3");
    expect(mobileBottomGroup).not.toContain("justify-between");
    expect(mobileBottomGroup).not.toContain("hidden");
  });

  test("lets the crowded rows wrap instead of squeezing targets", () => {
    expect(mobileBottomGroup).toContain(
      "flex flex-wrap items-center gap-x-3 gap-y-2",
    );
    expect(mobileBottomGroup).toContain("flex-wrap");
    // A nowrap copyright forced the 320px row to overflow rather than reflow.
    expect(mobileBottomGroup).not.toContain("whitespace-nowrap");
  });

  test("keeps copyright, status and all three social links visible", () => {
    expect(mobileBottomGroup).toContain("© {currentYear} Tulip Coaching LLC");
    expect(mobileBottomGroup).toContain("{statusBadge}");
    expect(mobileBottomGroup).toContain("<FooterSocialLinks");
  });
});
