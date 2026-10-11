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
import { MotionLinkButton } from "./MotionLinkButton";
import { RealCheckIn } from "./RealCheckIn";
import TestimonialsSection from "./TestimonialsSection";
import VolunteerJourneySection from "./VolunteerJourneySection";

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

    expect(
      elements(region).filter((node) => node.tag === "article"),
    ).toHaveLength(8);
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
  function press(
    key: string,
    {
      from = 400,
      nested = false,
      ...modifiers
    }: {
      from?: number;
      nested?: boolean;
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
    ["Volunteer Signup Sheet", 1],
    ["3/5", 3],
    ["2010 design", 1],
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
      "Founded 2007",
      "No hours",
      "Ads",
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

  test("the mock content and the table control are still rendered", () => {
    const text = collapse(allText(root));
    for (const copy of [
      "9:00 AM - Setup",
      "10:00 AM - Registration",
      "11:00 AM - Food",
      "No certs",
      "No QR",
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
          createElement(HeroContent),
        ),
      ),
    );
    const all = elements(root);

    const copy = all.filter(
      (node) =>
        node.tag === "p" &&
        collapse(allText(node)).startsWith("Sign up from one link"),
    );
    expect(copy).toHaveLength(1);
    expect(hiddenFirstRenderAncestors(copy[0])).toEqual([]);

    for (const [name, href] of [
      ["Run a volunteer event", "/signup"],
      ["Contact us", "/contact"],
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

    // The highlight cards under the demo share the same first render.
    const highlight = all.filter(
      (node) =>
        node.tag === "h3" && ownText(node) === "QR code check-in at events",
    );
    expect(highlight).toHaveLength(1);
    expect(hiddenFirstRenderAncestors(highlight[0])).toEqual([]);
  }, 30_000);
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
