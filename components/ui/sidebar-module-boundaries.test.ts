import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) =>
  readFileSync(join(import.meta.dir, path), "utf8");

describe("sidebar module boundaries", () => {
  test("stateful and layout modules stay within component budgets", () => {
    expect(read("sidebar.tsx").split("\n").length).toBeLessThanOrEqual(600);
    expect(read("sidebar-layout.tsx").split("\n").length).toBeLessThanOrEqual(
      600,
    );
  });

  test("the established sidebar surface re-exports extracted layout pieces", () => {
    const source = read("sidebar.tsx");
    for (const name of [
      "SidebarContent",
      "SidebarGroup",
      "SidebarHeader",
      "SidebarInset",
      "SidebarSeparator",
    ]) {
      expect(source).toContain(name);
    }
  });
});
