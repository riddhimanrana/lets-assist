import { describe, expect, test } from "bun:test";

import {
  isActiveDestination,
  memberLinks,
  publicLinks,
  type NavDestination,
} from "./destinations";

const byLabel = (links: readonly NavDestination[]) =>
  Object.fromEntries(links.map(([label, href]) => [label, href]));

describe("primary navigation destinations", () => {
  test("members get discovery and their own projects on separate routes", () => {
    expect(byLabel(memberLinks)).toMatchObject({
      Home: "/home",
      "My projects": "/projects",
    });
  });

  test("visitors reach the public upcoming-project feed", () => {
    expect(byLabel(publicLinks)).toMatchObject({
      "Upcoming projects": "/projects",
    });
    expect(byLabel(publicLinks)).not.toHaveProperty("My projects");
  });

  test("no list repeats a route, so one link is current at a time", () => {
    for (const links of [memberLinks, publicLinks]) {
      const hrefs = links.map(([, href]) => href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  test("a destination is current on its page and nested pages only", () => {
    expect(isActiveDestination("/projects", "/projects")).toBe(true);
    expect(isActiveDestination("/projects/abc", "/projects")).toBe(true);
    expect(isActiveDestination("/homework", "/home")).toBe(false);
    expect(isActiveDestination("/home", "/projects")).toBe(false);
  });
});
