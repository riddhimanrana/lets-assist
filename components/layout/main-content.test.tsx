import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { MAIN_CONTENT_ID, MainContent } from "./MainContent";
import { SkipToContentLink } from "./SkipToContentLink";

// The first two groups render the real components. They cannot show that the
// link is painted on focus or that focus lands on <main>: both need a browser.
const shell = renderToStaticMarkup(
  <>
    <SkipToContentLink />
    <nav aria-label="Primary">
      <a href="/home">Home</a>
    </nav>
    <MainContent>
      <h1>Fictional page</h1>
    </MainContent>
  </>,
);

const openingTag = (tag: string) =>
  shell.match(new RegExp(`<${tag}\\b[^>]*>`, "u"))?.[0] ?? "";
const classesOf = (tag: string) =>
  (/class="([^"]*)"/u.exec(tag)?.[1] ?? "").split(/\s+/u);

describe("skip to content link", () => {
  const link = openingTag("a");

  test("is the first element and points at the main landmark", () => {
    expect(shell.startsWith("<a ")).toBe(true);
    expect(link).toContain(`href="#${MAIN_CONTENT_ID}"`);
    expect(shell).toContain(">Skip to content</a>");
    const navigation = shell.indexOf("<nav");
    expect(shell.indexOf("Skip to content")).toBeLessThan(navigation);
  });

  test("stays a keyboard stop that assistive technology can read", () => {
    expect(link).not.toContain("tabindex");
    expect(link).not.toContain("aria-hidden");
    expect(link).not.toContain("hidden=");
    expect(classesOf(link)).not.toContain("hidden");
    expect(classesOf(link)).not.toContain("invisible");
  });

  test("is parked off screen and returns on focus with a focus ring", () => {
    const classes = classesOf(link);
    expect(classes).toEqual(
      expect.arrayContaining([
        "fixed",
        "-translate-y-20",
        "focus:translate-y-0",
        "focus-visible:ring-[3px]",
        "motion-reduce:transition-none",
      ]),
    );
    // The link must not also be clipped, or focus would reveal nothing.
    expect(classes).not.toContain("sr-only");
  });
});

describe("main landmark", () => {
  test("is the only main, carries the target id and takes programmatic focus", () => {
    expect(shell.match(/<main\b/gu)).toHaveLength(1);
    const main = openingTag("main");
    expect(main).toContain(`id="${MAIN_CONTENT_ID}"`);
    expect(main).toContain('tabindex="-1"');
    expect(shell.split(`id="${MAIN_CONTENT_ID}"`)).toHaveLength(2);
  });

  test("keeps the layout classes the root layout relied on", () => {
    expect(classesOf(openingTag("main"))).toEqual(
      expect.arrayContaining(["flex-1", "w-full"]),
    );
    expect(shell).toContain("<h1>Fictional page</h1>");
  });
});

// Source check only: the root layout needs fonts and providers that do not
// load in a unit process, so this proves wiring, not rendered output.
describe("root layout wiring", () => {
  const layout = readFileSync(
    new URL("../../app/layout.tsx", import.meta.url),
    "utf8",
  );

  test("renders the skip link before the banner and navigation", () => {
    const skip = layout.indexOf("<SkipToContentLink />");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(layout.indexOf("<SystemStickyBanner />"));
    expect(skip).toBeLessThan(layout.indexOf("<Navbar />"));
  });

  test("wraps the page in the shared main and adds no second one", () => {
    expect(layout).toContain("<MainContent>{children}</MainContent>");
    expect(layout).not.toContain("<main");
  });
});

// Source inventory, not rendered coverage. It reads every JSX module under
// app/ and rejects a literal main tag, because all of them render inside the
// root layout's main. It does not see a main that arrives from components/,
// a plugin or a computed tag name, and it renders no route. Route handlers
// that return their own HTML document are .ts files and are not read.
describe("app router main inventory", () => {
  const appDirectory = fileURLToPath(new URL("../../app/", import.meta.url));
  const modules = readdirSync(appDirectory, { recursive: true })
    .map(String)
    .filter(
      (file) =>
        file.endsWith(".tsx") && !/\.(?:test|spec|fixture)\.tsx$/u.test(file),
    );

  test("finds the App Router modules it is meant to read", () => {
    expect(modules).toContain("layout.tsx");
    expect(modules.length).toBeGreaterThan(100);
  });

  test("no page, layout or client module under app/ adds a nested main", () => {
    const nested = modules.filter((file) =>
      /<\/?main\b/u.test(readFileSync(join(appDirectory, file), "utf8")),
    );
    expect(nested).toEqual([]);
  });
});

// Source wiring: nested layouts target the content after their repeated nav.
test("account and admin layouts give the skip handler a focusable page target", () => {
  for (const name of ["account", "admin"]) {
    const source = readFileSync(
      new URL(`../../app/${name}/layout.tsx`, import.meta.url),
      "utf8",
    );
    const target = source.indexOf("id={PAGE_CONTENT_ID}");
    expect(target).toBeGreaterThan(-1);
    expect(source.slice(target, target + 100)).toContain("tabIndex={-1}");
    const sidebar = source.indexOf(
      name === "account" ? "<AccountNav" : "<AdminSidebar",
    );
    expect(sidebar).toBeGreaterThan(-1);
    expect(target).toBeGreaterThan(sidebar);
  }
});

test("root anchor scrolling reserves the mobile navbar height", () => {
  const source = readFileSync(
    new URL("../../app/layout.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("scroll-pt-14 lg:scroll-pt-0");
});
