import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The browser stability check scrolls to and measures each landing section by
// id. A plain server render cannot resolve the `next/dynamic` sections, so this
// contract reads the source: the components LandingLazySections renders, in
// order, and the `<section id>` each one owns.
const landing = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(path, "utf8");

function renderedSectionIds() {
  const source = read(join(landing, "LandingLazySections.tsx"));
  const files = new Map<string, string>();
  for (const [, single, list, path] of source.matchAll(
    /import\s+(?:(\w+)|\{([^}]*)\})\s+from\s+"(\.\/_components\/[^"]+)"/gu,
  ))
    for (const name of single ? [single] : list.split(","))
      if (name.trim()) files.set(name.trim(), path);
  for (const [, name, path] of source.matchAll(
    /const\s+(\w+)\s*=\s*dynamic\(\s*\(\)\s*=>\s*import\("(\.\/_components\/[^"]+)"\)/gu,
  ))
    files.set(name, path);
  const body = source.slice(
    source.indexOf("export function LandingLazySections"),
  );
  const ids: string[] = [];
  for (const [, name] of body.matchAll(/<([A-Z]\w*)\b/gu)) {
    const path = files.get(name);
    if (!path) throw new Error(`Unresolved landing component ${name}.`);
    const id = /<section\b[^>]*?\bid="([^"]+)"/u.exec(
      read(join(landing, `${path}.tsx`)),
    )?.[1];
    if (id) ids.push(id);
  }
  return ids;
}

function browserCheckedSectionIds() {
  const spec = read(
    join(landing, "../../tests/e2e/csf/platform-landing-stability.spec.ts"),
  );
  const list = /\nconst sections = \[([^\]]*)\];/u.exec(spec)?.[1];
  if (list === undefined) throw new Error("Browser section list missing.");
  return [...list.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
}

describe("landing browser stability covers the rendered sections", () => {
  test("the rendered sections are the current reviewed landing", () => {
    expect(renderedSectionIds()).toEqual([
      "journey",
      "org-tooling",
      "check-in",
      "comparison",
      "testimonials",
      "cta",
    ]);
  });

  test("the browser check measures every rendered section in order", () => {
    expect(browserCheckedSectionIds()).toEqual(renderedSectionIds());
  });

  test("the removed partner list is neither rendered nor expected", () => {
    expect(renderedSectionIds()).not.toContain("partners");
    expect(browserCheckedSectionIds()).not.toContain("partners");
  });
});
