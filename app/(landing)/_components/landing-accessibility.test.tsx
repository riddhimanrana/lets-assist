import { describe, expect, mock, test } from "bun:test";
import { hasReducedMotionListener, prefersReducedMotion } from "motion-dom";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  createElement,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AnimatedText } from "./AnimatedText";
import ComparisonSection from "./ComparisonSection";
import { ComparisonTextFlip } from "./ComparisonTextFlip";
import { MotionLinkButton } from "./MotionLinkButton";
import { RealCheckIn } from "./RealCheckIn";
import TestimonialsSection from "./TestimonialsSection";
import VolunteerJourneySection from "./VolunteerJourneySection";
import { EmailNotification } from "./journey/EmailNotification";
import { MiniCertificate } from "./journey/MiniCertificate";
import { QRScannerPreview } from "./journey/QRScannerPreview";

// These tests read the markup the real components render, as a tree, so they
// can ask what a screen reader would be given and what sits above a label.
// They do not measure colour contrast, box sizes or focus rings: those need a
// browser and are listed as pending in tests/e2e/landing.
type MarkupNode = {
  tag: string;
  attributes: Record<string, string>;
  parent: MarkupNode | null;
  children: Array<MarkupNode | string>;
};

const VOID_TAGS = new Set(["br", "hr", "img", "input", "link", "meta", "wbr"]);

function decode(value: string) {
  return value
    .replace(/&#x27;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function parseMarkup(markup: string): MarkupNode {
  const root: MarkupNode = {
    tag: "#root",
    attributes: {},
    parent: null,
    children: [],
  };
  let current = root;
  const token =
    /<\/([\w-]+)>|<([\w-]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/gu;
  for (const match of markup.matchAll(token)) {
    const [, closing, opening, rawAttributes, selfClosing, text] = match;
    if (text !== undefined) {
      current.children.push(decode(text));
    } else if (closing) {
      current = current.parent ?? current;
    } else if (opening) {
      const node: MarkupNode = {
        tag: opening,
        attributes: {},
        parent: current,
        children: [],
      };
      for (const [, name, value] of (rawAttributes ?? "").matchAll(
        /([^\s=]+)(?:="([^"]*)")?/gu,
      )) {
        node.attributes[name] = decode(value ?? "");
      }
      current.children.push(node);
      if (!selfClosing && !VOID_TAGS.has(opening)) current = node;
    }
  }
  return root;
}

function render(element: ReactElement) {
  return parseMarkup(renderToStaticMarkup(element));
}

function elements(node: MarkupNode): MarkupNode[] {
  return node.children.flatMap((child) =>
    typeof child === "string" ? [] : [child, ...elements(child)],
  );
}

function isHidden(node: MarkupNode) {
  return node.attributes["aria-hidden"] === "true";
}

function allText(node: MarkupNode): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : allText(child)))
    .join("");
}

// What assistive technology is given: everything outside aria-hidden.
function exposedText(node: MarkupNode): string {
  return node.children
    .map((child) => {
      if (typeof child === "string") return child;
      return isHidden(child) ? "" : exposedText(child);
    })
    .join("");
}

// What is drawn but kept from assistive technology.
function decorativeText(node: MarkupNode): string {
  return node.children
    .map((child) => {
      if (typeof child === "string") return "";
      return isHidden(child) ? allText(child) : decorativeText(child);
    })
    .join("");
}

function collapse(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function ownText(node: MarkupNode) {
  return collapse(
    node.children.filter((child) => typeof child === "string").join(""),
  );
}

function classes(node: MarkupNode) {
  return (node.attributes.class ?? "").split(/\s+/u).filter(Boolean);
}

function lineage(node: MarkupNode) {
  const nodes: MarkupNode[] = [];
  for (let current: MarkupNode | null = node; current;) {
    nodes.push(current);
    current = current.parent;
  }
  return nodes;
}

// Class names without their variant prefixes: `dark:bg-gray-900` is reported
// as `bg-gray-900`.
function utilities(nodes: MarkupNode[]) {
  return nodes
    .flatMap(classes)
    .map((name) => name.slice(name.lastIndexOf(":") + 1));
}

function hidesFirstRender(style: string) {
  return (
    /(?:^|;)opacity:\s*0(?:;|$)/u.test(style) ||
    /scale(?:X|Y)?\(0(?:,\s*0)?\)/u.test(style) ||
    /(?:^|;)(?:display:\s*none|visibility:\s*hidden)(?:;|$)/u.test(style)
  );
}

function hiddenFirstRenderStyles(root: MarkupNode) {
  return elements(root)
    .map((node) => node.attributes.style ?? "")
    .filter(hidesFirstRender);
}

// Everything on the way up from a node that would keep it from being drawn
// before a script runs: an inline entrance style, the `hidden` attribute, or
// an unconditional hiding class.
function hiddenFirstRenderAncestors(node: MarkupNode) {
  return lineage(node).flatMap((ancestor) => {
    const style = ancestor.attributes.style ?? "";
    return [
      ...(hidesFirstRender(style) ? [style] : []),
      ...("hidden" in ancestor.attributes ? ["hidden"] : []),
      ...classes(ancestor).filter((name) =>
        ["hidden", "invisible", "opacity-0"].includes(name),
      ),
    ];
  });
}

// Renders with the motion preference the real motion library would report:
// null on a server, true in a browser that asks for reduced motion.
function withMotionPreference<T>(reduced: boolean | null, run: () => T) {
  const previous = {
    listener: hasReducedMotionListener.current,
    preference: prefersReducedMotion.current,
  };
  hasReducedMotionListener.current = true;
  prefersReducedMotion.current = reduced;
  try {
    return run();
  } finally {
    hasReducedMotionListener.current = previous.listener;
    prefersReducedMotion.current = previous.preference;
  }
}

describe("animated landing text", () => {
  for (const mode of ["words", "letters"] as const) {
    test(`${mode} mode gives the heading its text once, with no aria-label`, () => {
      const text = "Who will you help next?";
      const root = render(
        createElement("h2", null, createElement(AnimatedText, { text, mode })),
      );
      const heading = root.children[0] as MarkupNode;

      expect(heading.tag).toBe("h2");
      for (const node of elements(root)) {
        expect(node.attributes).not.toHaveProperty("aria-label");
        expect(node.attributes).not.toHaveProperty("role");
      }
      // Exact equality: the string is exposed, and exposed only once.
      expect(exposedText(heading)).toBe(text);
      // The animated fragments still spell the same string for sighted users.
      expect(collapse(decorativeText(heading))).toBe(text);
      expect(
        elements(heading).filter((node) => classes(node).includes("sr-only")),
      ).toHaveLength(1);
    });
  }
});

describe("landing testimonials", () => {
  const label = "Testimonials from teachers and advisors";

  test("the quotes sit in a named region that takes keyboard focus", () => {
    const root = render(createElement(TestimonialsSection));
    const regions = elements(root).filter(
      (node) => node.attributes.role === "region",
    );

    expect(regions).toHaveLength(1);
    const [region] = regions;
    expect(region.attributes["aria-label"]).toBe(label);
    expect(region.attributes.tabindex).toBe("0");
    expect(classes(region)).toContain("overflow-x-auto");
    expect(classes(region)).toContain("focus-visible:ring-2");

    const cards = elements(region).filter((node) => node.tag === "article");
    expect(cards).toHaveLength(8);
    // 330px, or narrower on a phone so a strip of the next card shows. How
    // much shows at 320 and 390 is a browser measurement.
    for (const card of cards) {
      expect(classes(card)).toContain("w-[min(330px,calc(100vw_-_96px))]");
      expect(classes(card)).toContain("shrink-0");
      expect(classes(card)).not.toContain("w-[330px]");
    }
    const text = collapse(exposedText(region));
    for (const copy of [
      "Let's Assist looks like a very promising system!",
      "I have heard positive remarks regarding your system.",
      "Minu Basu",
      "DV Speech & Debate Advisor",
      "More community voices",
    ]) {
      expect(text).toContain(copy);
    }
  });

  test("the row is the same with and without a motion preference", () => {
    const server = withMotionPreference(null, () =>
      renderToStaticMarkup(createElement(TestimonialsSection)),
    );
    const reduced = withMotionPreference(true, () =>
      renderToStaticMarkup(createElement(TestimonialsSection)),
    );

    expect(reduced).toBe(server);
    // Nothing moves the row on its own, so nothing fights a manual scroll.
    expect(server).not.toMatch(/transform:/u);
    expect(hiddenFirstRenderStyles(parseMarkup(server))).toEqual([]);
  });
});

describe("testimonial row keyboard scrolling", () => {
  type RegionProps = {
    role?: string;
    children?: ReactNode;
    onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  };

  // The handler under test is the one the real component puts on its region.
  // The section has no hooks, so it can be called for its element tree.
  function regionProps(node: ReactNode): RegionProps | undefined {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = regionProps(child);
        if (found) return found;
      }
      return undefined;
    }
    if (!isValidElement<RegionProps>(node)) return undefined;
    return node.props.role === "region"
      ? node.props
      : regionProps(node.props.children);
  }

  // Stands in for the scroll container: 2752px of quotes in a 1063px row. It
  // clamps the way a browser does, and records how it was asked to scroll.
  // `cardWidth` gives the row a first card to measure. Left out, the row has
  // no `querySelector` at all; null is a row with no card in it.
  function press(
    key: string,
    {
      from = 400,
      nested = false,
      cardWidth,
      ...modifiers
    }: {
      from?: number;
      nested?: boolean;
      cardWidth?: number | null;
      altKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
      shiftKey?: boolean;
    } = {},
  ) {
    const requests: ScrollToOptions[] = [];
    const row = {
      scrollLeft: from,
      scrollWidth: 2752,
      clientWidth: 1063,
      querySelector:
        cardWidth === undefined
          ? undefined
          : (selector: string) =>
              selector === "article" && cardWidth !== null
                ? { getBoundingClientRect: () => ({ width: cardWidth }) }
                : null,
      scrollTo(options: ScrollToOptions) {
        requests.push(options);
        row.scrollLeft = Math.min(
          Math.max(options.left ?? row.scrollLeft, 0),
          row.scrollWidth - row.clientWidth,
        );
      },
    };
    let prevented = false;
    const handler = regionProps(TestimonialsSection())?.onKeyDown;
    if (!handler) throw new Error("The testimonial region has no key handler.");
    handler({
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...modifiers,
      currentTarget: row,
      target: nested ? {} : row,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as KeyboardEvent<HTMLDivElement>);
    return { scrollLeft: row.scrollLeft, requests, prevented };
  }

  test("the arrow keys move the row at once and claim the key", () => {
    const right = press("ArrowRight");
    expect(right.scrollLeft).toBeGreaterThan(400);
    expect(right.requests).toHaveLength(1);
    // Instant: the position changes in the same task, with no frames needed.
    expect(right.requests[0].behavior).toBe("instant");
    expect(right.prevented).toBe(true);

    const left = press("ArrowLeft");
    expect(left.scrollLeft).toBeLessThan(400);
    expect(left.requests[0].behavior).toBe("instant");
    expect(left.prevented).toBe(true);

    // One press each way returns to the start.
    expect(400 - left.scrollLeft).toBe(right.scrollLeft - 400);
  });

  test("an arrow press moves by the measured card plus the 16px gap", () => {
    // The card widths the class gives at 390, at 320 and on a desktop.
    expect(press("ArrowRight", { cardWidth: 294 }).scrollLeft).toBe(400 + 310);
    expect(press("ArrowLeft", { cardWidth: 224 }).scrollLeft).toBe(400 - 240);
    expect(press("ArrowRight", { cardWidth: 330 }).scrollLeft).toBe(400 + 346);
    expect(press("ArrowLeft", { cardWidth: 330 }).scrollLeft).toBe(400 - 346);
  });

  test("a card that cannot be measured falls back to the 346px step", () => {
    for (const cardWidth of [
      undefined,
      null,
      0,
      -10,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(press("ArrowRight", { cardWidth }).scrollLeft).toBe(400 + 346);
      expect(press("ArrowLeft", { cardWidth }).scrollLeft).toBe(400 - 346);
    }
  });

  test("Home and End ignore the card width", () => {
    expect(press("Home", { cardWidth: 224 }).scrollLeft).toBe(0);
    expect(press("End", { cardWidth: 224 }).scrollLeft).toBe(2752 - 1063);
  });

  test("Home and End reach the first and last quotes", () => {
    const home = press("Home");
    expect(home.scrollLeft).toBe(0);
    expect(home.requests[0].behavior).toBe("instant");
    expect(home.prevented).toBe(true);

    const end = press("End");
    expect(end.scrollLeft).toBe(2752 - 1063);
    expect(end.requests[0].behavior).toBe("instant");
    expect(end.prevented).toBe(true);
  });

  test("the row stops at either end", () => {
    expect(press("ArrowLeft", { from: 100 }).scrollLeft).toBe(0);
    expect(press("ArrowLeft", { from: 0 }).scrollLeft).toBe(0);
    expect(press("ArrowRight", { from: 1600 }).scrollLeft).toBe(2752 - 1063);
    expect(press("ArrowRight", { from: 2752 - 1063 }).scrollLeft).toBe(
      2752 - 1063,
    );
  });

  test("key combinations, nested targets and other keys are left alone", () => {
    const untouched = { scrollLeft: 400, requests: [], prevented: false };

    for (const modifier of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
        expect(press(key, modifier)).toEqual(untouched);
      }
    }
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(press(key, { nested: true })).toEqual(untouched);
    }
    for (const key of ["ArrowDown", "ArrowUp", "Tab", " ", "Enter", "a"]) {
      expect(press(key)).toEqual(untouched);
    }
  });

  test("the rendered region opts out of the smooth-scroll layer sideways", () => {
    const root = render(createElement(TestimonialsSection));
    const [region] = elements(root).filter(
      (node) => node.attributes.role === "region",
    );

    expect(region.attributes).toHaveProperty("data-lenis-prevent-horizontal");
    expect(region.attributes).not.toHaveProperty("data-lenis-prevent");
  });
});

const RAW_PALETTE =
  /^(?:text|bg)-(?:white|black|(?:gray|orange|amber|slate|zinc|neutral|stone)-\d+)(?:\/\d+)?$/u;

describe("comparison mock labels", () => {
  const root = render(createElement(ComparisonSection));
  // The side advert is `hidden` at every width, so it is never drawn.
  const drawn = (node: MarkupNode) =>
    !lineage(node).some((ancestor) => classes(ancestor).includes("hidden"));
  const labelled = (label: string) =>
    elements(root).filter((node) => ownText(node) === label && drawn(node));

  const reported: Array<[label: string, count: number]> = [
    ["signupgenius.com", 1],
    ["AD", 1],
    ["Ads show on the free plan", 1],
    ["Volunteer Signup Sheet", 1],
    ["3/5", 3],
    ["Illustrative mock", 1],
    ["lets-assist.com/explore", 1],
  ];

  for (const [label, count] of reported) {
    test(`"${label}" is not faded by an ancestor and uses theme tokens`, () => {
      const nodes = labelled(label);
      expect(nodes).toHaveLength(count);

      for (const node of nodes) {
        const fades = utilities(lineage(node)).filter((name) => {
          const amount = /^opacity-(\d+)$/u.exec(name)?.[1];
          return amount !== undefined && Number(amount) < 100;
        });
        expect(fades).toEqual([]);
        expect(
          lineage(node)
            .map((ancestor) => ancestor.attributes.style ?? "")
            .filter((style) => {
              const amount = /(?:^|;)opacity:\s*([\d.]+)/u.exec(style)?.[1];
              return amount !== undefined && Number(amount) < 1;
            }),
        ).toEqual([]);

        // The label and the surface directly behind it.
        const surface = node.parent ? [node, node.parent] : [node];
        expect(
          utilities(surface).filter((name) => RAW_PALETTE.test(name)),
        ).toEqual([]);
      }
    });
  }

  test("no mock label uses a translucent text colour", () => {
    for (const label of [
      ...reported.map(([name]) => name),
      "Sign-up sheet",
      "Not a screenshot. See the provider's site for its current product.",
    ]) {
      const nodes = labelled(label);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(
          utilities(lineage(node)).filter((name) =>
            /^text-[a-z-]+\/\d+$/u.test(name),
          ),
        ).toEqual([]);
      }
    }
  });

  test("the advert line is steady foreground text at a readable size", () => {
    const [line] = labelled("Ads show on the free plan");

    // The whole recipe: no pulse, no arbitrary 9px size, no tinted colour.
    // The contrast ratio itself is measured in a browser, not here.
    expect(classes(line)).toEqual([
      "text-xs",
      "font-semibold",
      "text-foreground",
    ]);
    expect(
      utilities(lineage(line)).filter((name) => name.startsWith("animate-")),
    ).toEqual([]);
    expect(hiddenFirstRenderAncestors(line)).toEqual([]);
    // It still sits in the advert box, beside the "AD" marker.
    expect(line.parent ? classes(line.parent) : []).toContain("bg-background");
    expect(elements(line.parent ?? line).map(ownText)).toEqual([
      "AD",
      "Ads show on the free plan",
    ]);
  });

  // The other provider's sheet is a drawing. It says so, and it says nothing
  // about what that provider lacks or how old it is.
  test("the provider mock is labelled illustrative and claims no gaps", () => {
    expect(labelled("Illustrative mock")).toHaveLength(1);
    expect(
      hiddenFirstRenderAncestors(labelled("Illustrative mock")[0]),
    ).toEqual([]);

    const text = collapse(allText(root));
    for (const claim of [
      "Founded 2007",
      "2010 design",
      "No hours",
      "No certs",
      "No QR",
      "Start Your Free Trial",
      "potluck",
      "outdated",
      "cluttered",
      "SignUpGenius is",
      "Not included",
      "Premium only",
      "COPPA",
    ]) {
      expect(text).not.toContain(claim);
    }
  });

  test("a logo beside its written name has an empty alt", () => {
    const logos = elements(root).filter(
      (node) =>
        node.tag === "img" &&
        /signupgenius-logo|logo\.png/u.test(node.attributes.src ?? ""),
    );
    // The mock's logo and the two column headings.
    expect(logos).toHaveLength(3);
    for (const logo of logos) {
      expect(logo.attributes.alt).toBe("");
    }
  });

  test("the mock content and the table control are still rendered", () => {
    const text = collapse(allText(root));
    for (const copy of [
      "9:00 AM - Setup",
      "10:00 AM - Registration",
      "11:00 AM - Food",
      "Sign-up sheet",
      "Explore opportunities",
      "View details",
    ]) {
      expect(text).toContain(copy);
    }
    expect(
      elements(root).filter(
        (node) =>
          node.tag === "button" &&
          collapse(allText(node)) === "Show all 10 features",
      ),
    ).toHaveLength(1);
  });
});

describe("comparison table", () => {
  const root = render(createElement(ComparisonSection));
  const tables = elements(root).filter((node) => node.tag === "table");
  const cells = tables.flatMap((table) =>
    elements(table).filter((node) => node.tag === "th" || node.tag === "td"),
  );

  test("it is one named table with the three column headings", () => {
    expect(tables).toHaveLength(1);
    expect(tables[0]?.attributes["aria-label"]).toBe(
      "Let's Assist and SignUpGenius feature comparison",
    );
    expect(
      cells
        .filter((cell) => cell.tag === "th")
        .map((cell) => collapse(allText(cell))),
    ).toEqual(["Feature comparison", "Let's Assist", "SignUpGenius"]);
  });

  // Whether every column is readable at 390 and 320 is a browser measurement.
  // This holds the layout that makes it possible: a fixed table with no
  // minimum width, no scroll region around it, and cells that wrap.
  test("it fits its card by wrapping, with no scroll region and no cut text", () => {
    const [table] = tables;
    if (!table) throw new Error("The comparison table is missing");

    expect(classes(table)).toContain("table-fixed");
    expect(classes(table).filter((name) => name.includes("min-w-"))).toEqual(
      [],
    );
    expect(
      lineage(table)
        .flatMap(classes)
        .filter((name) => /overflow-(?:x-)?(?:auto|scroll)$/u.test(name)),
    ).toEqual([]);
    expect(
      elements(root).filter(
        (node) => node.attributes["data-slot"] === "table-container",
      ),
    ).toEqual([]);

    expect(cells.length).toBeGreaterThan(3);
    for (const cell of cells) {
      expect(classes(cell)).toContain("whitespace-normal");
      expect(classes(cell)).not.toContain("whitespace-nowrap");
    }
    expect(elements(table).flatMap(classes)).not.toContain("truncate");
    expect(collapse(allText(table))).toContain("Paid hour reports");
  });

  // What each status cell gives assistive technology, written out here by
  // hand so a mark with no words, or the wrong words, fails. The provider
  // column says what its public pages document. Where we have not confirmed
  // a feature either way it points to those pages, and never says "Not
  // included". These are the words on the page, not a check of the provider.
  const statuses: Array<
    [feature: string, letsAssist: string, signupGenius: string]
  > = [
    ["QR check-in and check-out", "Included", "Ticket QR scans"],
    ["Hour certificates", "Included", "See provider docs"],
    ["Verified hours", "Included", "See provider docs"],
    ["Organization roles", "Included", "See provider docs"],
    ["Personal dashboard", "Included", "See provider docs"],
    ["Hours CSV exports", "Included", "Paid hour reports"],
  ];

  test("the provider column is dated and links to its three sources", () => {
    const [table] = tables;
    const noteId = table?.attributes["aria-describedby"];
    expect(noteId).toBe("comparison-sources");

    const notes = elements(root).filter(
      (node) => node.attributes.id === noteId,
    );
    expect(notes).toHaveLength(1);
    const [note] = notes;
    expect(hiddenFirstRenderAncestors(note)).toEqual([]);
    expect(collapse(exposedText(note))).toBe(
      "SignUpGenius column checked against its public pages on October 12, 2026. Plans and features change, so confirm with the provider: Hours report, Product overview, Sign-up features.",
    );

    const links = elements(note).filter((node) => node.tag === "a");
    expect(links.map((link) => [ownText(link), link.attributes.href])).toEqual([
      [
        "Hours report",
        "https://support.signupgenius.com/hc/en-us/articles/29670376445335-Track-Volunteer-Hours-with-a-Report",
      ],
      [
        "Product overview",
        "https://www.signupgenius.com/videos/what-is-signupgenius",
      ],
      ["Sign-up features", "https://www.signupgenius.com/sign-ups"],
    ]);
    for (const link of links) {
      expect(link.attributes.target).toBe("_blank");
      expect(link.attributes.rel).toBe("noopener noreferrer");
      expect(classes(link)).toContain("underline");
    }
  });

  // The six rows of a first render. The four behind "Show all 10 features"
  // need a click, so the browser spec reads those.
  test("every status cell of the first six rows reads its truth in words", () => {
    const rows = elements(root).filter(
      (node) => node.tag === "tr" && node.parent?.tag === "tbody",
    );
    expect(rows).toHaveLength(statuses.length);

    rows.forEach((row, index) => {
      const [feature, ...columns] = elements(row).filter(
        (node) => node.tag === "td",
      );
      const [name, letsAssist, signupGenius] = statuses[index];

      expect(collapse(exposedText(feature))).toStartWith(name);
      expect(columns.map((cell) => collapse(exposedText(cell)))).toEqual([
        letsAssist,
        signupGenius,
      ]);

      for (const cell of columns) {
        const words = collapse(exposedText(cell));
        const marks = elements(cell).filter((node) => node.tag === "svg");
        if (words === "Included" || words === "Not included") {
          // The drawn mark stays, hidden, beside one readable label.
          expect(marks).toHaveLength(1);
          expect(isHidden(marks[0])).toBe(true);
          expect(
            elements(cell)
              .filter((node) => classes(node).includes("sr-only"))
              .map(ownText),
          ).toEqual([words]);
        } else {
          expect(marks).toEqual([]);
        }
      }
    });
  });

  // The light green does not carry small text on a white card. The ratio is
  // a browser measurement; this holds the recipe on the rendered labels:
  // foreground text. The Open badge is flat in both themes; the remaining
  // labels use the green only under the dark variant.
  test("small labels retain readable foreground recipes without a filled status badge", () => {
    const labels = elements(root).filter(
      (node) =>
        ["Open", "Key", "Let's Assist", "QR check-in and check-out"].includes(
          ownText(node),
        ) ||
        (node.tag === "button" &&
          collapse(allText(node)) === "Show all 10 features"),
    );
    // One badge, three key rows, one column heading, one name, one control.
    expect(labels).toHaveLength(7);

    for (const label of labels) {
      const own = [label, ...(label.parent ? [label.parent] : [])].flatMap(
        classes,
      );
      expect(own).toContain("text-foreground");
      if (ownText(label) === "Open") {
        expect(label.attributes["data-variant"]).toBe("neutral");
        expect(own).not.toContain("dark:text-primary");
        expect(own.filter((name) => name.startsWith("bg-[image:"))).toEqual([]);
      } else {
        expect(own).toContain("dark:text-primary");
      }
      expect(
        own.filter((name) =>
          ["text-primary", "text-primary-foreground", "bg-primary"].includes(
            name,
          ),
        ),
      ).toEqual([]);
    }
  });
});

describe("comparison headline word", () => {
  // Fictional words. The timer and preference changes are covered by
  // landing-motion-lifecycle.test.ts; this is the markup of a first render.
  const words = ["alpha", "bravo", "charlie"];
  const renderFlip = (reduced: boolean | null, list = words) =>
    withMotionPreference(reduced, () =>
      render(createElement(ComparisonTextFlip, { words: list })),
    );

  for (const reduced of [null, false]) {
    test(`the first word is drawn at once (reduced motion: ${reduced})`, () => {
      const root = renderFlip(reduced);

      expect(collapse(exposedText(root))).toBe("alpha");
      expect(elements(root)).toHaveLength(words.length + 3);
      expect(hiddenFirstRenderStyles(root)).toEqual([]);
    });
  }

  test("reduced motion gets the first word in a plain span", () => {
    const root = renderFlip(true);
    const [frame, word] = elements(root);

    expect(elements(root)).toHaveLength(words.length + 3);
    expect(classes(frame)).toContain("inline-grid");
    expect(frame.attributes.style).toBeUndefined();
    // No inline style means no motion wrapper is holding the word.
    expect(word.tag).toBe("span");
    // The darker orange is for the light page. Dark keeps the lighter one.
    // The ratios are a browser measurement.
    expect(word.attributes).toEqual({
      class:
        "col-start-1 row-start-1 whitespace-nowrap font-bold text-orange-700 dark:text-orange-400",
    });
    expect(ownText(word)).toBe("alpha");
    expect(collapse(exposedText(root))).toBe("alpha");
    expect(collapse(decorativeText(root))).toBe(words.join(""));
  });

  for (const reduced of [null, true]) {
    test(`no words and one word both render (reduced motion: ${reduced})`, () => {
      const none = renderFlip(reduced, []);
      expect(elements(none)).toHaveLength(3);
      expect(collapse(allText(none))).toBe("");

      const one = renderFlip(reduced, ["alpha"]);
      expect(collapse(exposedText(one))).toBe("alpha");
      expect(hiddenFirstRenderStyles(one)).toEqual([]);
    });
  }

  test("the section headline reads the same under reduced motion", () => {
    const root = withMotionPreference(true, () =>
      render(createElement(ComparisonSection)),
    );
    const headlines = elements(root).filter(
      (node) =>
        node.tag === "h2" &&
        collapse(exposedText(node)) === "One workflow for sign-ups",
    );

    expect(headlines).toHaveLength(1);
    expect(hiddenFirstRenderAncestors(headlines[0])).toEqual([]);
  });

  test("the animated branch carries the same two-theme colour", () => {
    const [, word] = elements(renderFlip(false));

    expect(classes(word)).toEqual(
      expect.arrayContaining(["text-orange-700", "dark:text-orange-400"]),
    );
    expect(classes(word)).not.toContain("text-orange-400");
  });
});

describe("journey pagination", () => {
  const stepLabels = [
    "Browse feed",
    "Sign up & confirm",
    "QR check-in/out",
    "Track progress",
    "Get certified",
  ];

  test("each pill is a labelled toggle inside a 32px target", () => {
    const root = render(createElement(VolunteerJourneySection));
    const pills = elements(root).filter(
      (node) =>
        node.tag === "button" &&
        node.attributes["aria-label"]?.startsWith("Show step"),
    );

    expect(pills.map((pill) => pill.attributes["aria-label"])).toEqual(
      stepLabels.map((label, index) => `Show step ${index + 1} of 5: ${label}`),
    );
    expect(pills.map((pill) => pill.attributes["aria-pressed"])).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
    ]);

    for (const pill of pills) {
      expect(pill.attributes.type).toBe("button");
      // size-8 is 2rem square on the default spacing scale. The painted box
      // is measured in the browser spec.
      expect(classes(pill)).toContain("size-8");
      expect(classes(pill)).toContain("focus-visible:ring-2");

      // The visible pill keeps its compact shape and is decoration only.
      const marks = elements(pill);
      expect(marks).toHaveLength(1);
      expect(isHidden(marks[0])).toBe(true);
      expect(classes(marks[0])).toEqual(
        expect.arrayContaining(["h-2", "w-8", "rounded-full"]),
      );
    }
  });

  test("unpressed pills are painted with an opaque token, not a faint wash", () => {
    const root = render(createElement(VolunteerJourneySection));
    const pills = elements(root).filter(
      (node) =>
        node.tag === "button" &&
        node.attributes["aria-label"]?.startsWith("Show step"),
    );
    const fills = pills.map((pill) =>
      classes(elements(pill)[0]).filter((name) => name.startsWith("bg-")),
    );

    // The pressed pill keeps the green. The rest share one text token that
    // is drawn at full strength in both themes. This checks the markup only,
    // not the rendered contrast.
    expect(fills).toEqual([
      ["bg-primary"],
      ["bg-muted-foreground"],
      ["bg-muted-foreground"],
      ["bg-muted-foreground"],
      ["bg-muted-foreground"],
    ]);

    for (const pill of pills) {
      const mark = elements(pill)[0];
      // No opacity modifier, no theme override and no hiding utility can
      // thin the fill back out.
      expect(
        classes(mark).filter(
          (name) =>
            name.includes("/") ||
            name.includes("dark:") ||
            name.startsWith("opacity-") ||
            name === "invisible" ||
            name === "hidden",
        ),
      ).toEqual([]);
      // The pill is still a native toggle with its name and focus ring.
      expect(pill.attributes.type).toBe("button");
      expect(pill.attributes["aria-pressed"]).toMatch(/^(true|false)$/);
      expect(classes(pill)).toEqual(
        expect.arrayContaining(["size-8", "focus-visible:ring-2"]),
      );
    }
  });

  test("the step cards keep their own toggles and copy", () => {
    const root = render(createElement(VolunteerJourneySection));
    const cards = elements(root).filter(
      (node) =>
        node.tag === "button" &&
        node.attributes["aria-pressed"] !== undefined &&
        classes(node).includes("text-left"),
    );

    expect(cards).toHaveLength(5);
    cards.forEach((card, index) => {
      expect(collapse(exposedText(card))).toStartWith(stepLabels[index]);
    });
    expect(hiddenFirstRenderStyles(root)).toEqual([]);
  });
});

describe("hero link button", () => {
  const renderLink = (reduced: boolean | null) =>
    withMotionPreference(reduced, () =>
      render(
        createElement(MotionLinkButton, {
          href: "/signup",
          children: "Run a volunteer event",
        }),
      ),
    );

  test("the wrapper has the same tabindex on the server and under reduced motion", () => {
    const server = renderLink(null).children[0] as MarkupNode;
    const reduced = renderLink(true).children[0] as MarkupNode;

    expect(server.tag).toBe("div");
    expect(server.attributes.tabindex).toBe("-1");
    expect(reduced.attributes).toEqual(server.attributes);
  });

  for (const reduced of [null, true]) {
    test(`the link is the only keyboard stop (reduced motion: ${reduced})`, () => {
      const root = renderLink(reduced);
      const stops = elements(root).filter((node) => {
        const tabindex = node.attributes.tabindex;
        if (tabindex !== undefined) return Number(tabindex) >= 0;
        return (
          node.tag === "button" ||
          (node.tag === "a" && "href" in node.attributes)
        );
      });

      expect(stops).toHaveLength(1);
      expect(stops[0].tag).toBe("a");
      expect(stops[0].attributes.href).toBe("/signup");
      // The second copy of the label is the hover animation's and is hidden.
      expect(collapse(exposedText(root))).toBe("Run a volunteer event");
    });
  }
});

describe("hero first render", () => {
  // The hero mounts the real project page as its demo, and that page reads
  // the app router. The real context supplies one, as Next does.
  const router = {
    bfcacheId: "landing-hero-first-render",
    back: () => {},
    forward: () => {},
    refresh: () => {},
    push: () => {},
    replace: () => {},
    prefetch: async () => {},
  };

  test("the copy, both links and the live demo are drawn without a script", async () => {
    // Bun does not select Next's server-only empty marker while rendering on
    // the server. Match that marker here; every product component stays real,
    // and rendering invokes no database or provider actions.
    mock.module("server-only", () => ({}));
    // Imported here because the demo pulls in the project page's module
    // graph. If that graph cannot load in this process, only this test fails.
    const { HeroContent } = await import("./HeroContent");
    const root = withMotionPreference(null, () =>
      render(
        createElement(
          AppRouterContext.Provider,
          { value: router },
          createElement(HeroContent, { demoDateAnchor: "2026-10-12" }),
        ),
      ),
    );
    const all = elements(root);

    const copy = all.filter(
      (node) =>
        node.tag === "p" &&
        collapse(allText(node)).startsWith(
          "Find a project, sign up for a shift",
        ),
    );
    expect(copy).toHaveLength(1);
    expect(hiddenFirstRenderAncestors(copy[0])).toEqual([]);

    for (const [name, href] of [
      ["Find a project", "/projects"],
      ["Run a volunteer event", "/signup?redirect=%2Fprojects%2Fcreate"],
    ]) {
      const links = all.filter(
        (node) => node.tag === "a" && collapse(exposedText(node)) === name,
      );
      expect(links).toHaveLength(1);
      expect(links[0].attributes.href).toBe(href);
      expect(hiddenFirstRenderAncestors(links[0])).toEqual([]);
      // The hover animation's second copy of the label is still there, kept
      // from assistive technology and parked below the visible one.
      expect(collapse(decorativeText(links[0]))).toBe(name);
      const hoverCopies = elements(links[0]).filter(isHidden);
      expect(hoverCopies).toHaveLength(1);
      expect(hoverCopies[0].attributes.style).toContain("translateY(140%)");
    }

    const demo = all.filter((node) => node.attributes.id === "live-demo");
    expect(demo).toHaveLength(1);
    expect(hiddenFirstRenderAncestors(demo[0])).toEqual([]);
    expect(collapse(allText(demo[0]))).toContain("Santa Cruz Beach Cleanup");

    // The hero headline is the only h1. The demo is the real project page in
    // demo mode, so its title drops to an h2 and keeps the page's classes.
    const headlines = all.filter((node) => node.tag === "h1");
    expect(headlines).toHaveLength(1);
    expect(lineage(headlines[0])).not.toContain(demo[0]);
    const demoTitles = elements(demo[0]).filter(
      (node) =>
        ownText(node) === "Santa Cruz Beach Cleanup" &&
        classes(node).includes("wrap-break-word"),
    );
    expect(demoTitles).toHaveLength(1);
    expect(demoTitles[0].tag).toBe("h2");
    expect(classes(demoTitles[0])).toEqual([
      "mb-1.5",
      "text-2xl",
      "font-bold",
      "text-balance",
      "wrap-break-word",
      "sm:text-3xl",
    ]);

    // The three steps under the demo share the same first render.
    const highlight = all.filter(
      (node) => node.tag === "h2" && ownText(node) === "Choose a shift",
    );
    expect(highlight).toHaveLength(1);
    expect(hiddenFirstRenderAncestors(highlight[0])).toEqual([]);
  }, 30_000);
});

describe("journey preview first render", () => {
  for (const reduced of [null, true]) {
    const previews = [
      ["email", createElement(EmailNotification), "Signup confirmed"],
      [
        "certificate",
        createElement(MiniCertificate, {
          projectName: "Sample service event",
          organizationName: "Sample organization",
          volunteerName: "Sample volunteer",
          hours: 2,
          shouldAnimate: false,
        }),
        "Certificate of Volunteer Service",
      ],
      [
        "scanner",
        createElement(QRScannerPreview, { shouldAnimate: false }),
        "Scanning…",
      ],
    ] as const;

    for (const [name, preview, label] of previews) {
      test(`${name} content has no hidden initial ancestor (motion: ${reduced})`, () => {
        const root = withMotionPreference(reduced, () => render(preview));
        for (const text of name === "certificate"
          ? [label, "Verified"]
          : [label]) {
          const labels = elements(root).filter(
            (node) => ownText(node) === text,
          );
          expect(labels).toHaveLength(1);
          expect(hiddenFirstRenderAncestors(labels[0])).toEqual([]);
        }
      });
    }

    test(`an idle scanner does not expose a successful check-in (motion: ${reduced})`, () => {
      const root = withMotionPreference(reduced, () =>
        render(createElement(QRScannerPreview, { shouldAnimate: false })),
      );
      expect(collapse(exposedText(root))).toContain("Scanning…");
      expect(collapse(exposedText(root))).not.toContain("Checked in");
    });
  }
});

describe("server-rendered static sections", () => {
  test("check-in copy and figures need no browser state", () => {
    const first = renderToStaticMarkup(createElement(RealCheckIn));
    const second = withMotionPreference(true, () =>
      renderToStaticMarkup(createElement(RealCheckIn)),
    );
    const root = parseMarkup(first);
    const text = collapse(exposedText(root));

    expect(second).toBe(first);
    for (const copy of [
      "This is what check-in looks like",
      "scan the printed code",
      "Each session gets its own code.",
      "The check-in time is recorded right away.",
    ]) {
      expect(text).toContain(copy);
    }
    expect(elements(root).filter((node) => node.tag === "img")).toHaveLength(3);
    expect(hiddenFirstRenderStyles(root)).toEqual([]);
  });

  test("the testimonial heading and quotes are in the first render", () => {
    const root = render(createElement(TestimonialsSection));
    const text = collapse(exposedText(root));

    expect(
      elements(root).filter(
        (node) =>
          node.tag === "h2" &&
          collapse(allText(node)) === "What teachers and advisors told us",
      ),
    ).toHaveLength(1);
    expect(text).toContain("Jill Nonn");
    expect(hiddenFirstRenderStyles(root)).toEqual([]);
  });
});
