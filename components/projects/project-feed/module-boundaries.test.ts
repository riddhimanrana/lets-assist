import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectsRoot = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(projectsRoot, path), "utf8");

describe("project feed module boundaries", () => {
  test("the controller uses one shared responsive filter surface", () => {
    const source = read("ProjectsInfiniteScroll.tsx");
    expect(source).toContain("filterAndSortProjects({");
    expect(source.match(/<ProjectFeedFilters/g)).toHaveLength(2);
    expect(source.split("\n").length).toBeLessThanOrEqual(600);
  });

  test("responsive filter modules remain independently budgeted", () => {
    for (const path of [
      "project-feed/ProjectFeedMobileFilters.tsx",
      "project-feed/ProjectFeedDesktopFilters.tsx",
      "project-feed/ProjectFeedActiveFilters.tsx",
    ]) {
      const source = read(path);
      expect(source).toMatch(/^"use client";/);
      expect(source.split("\n").length).toBeLessThanOrEqual(600);
    }
  });
});
