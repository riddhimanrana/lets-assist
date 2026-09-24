import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { INITIAL_THEME_SCRIPT } from "./apply-initial-theme";

function parseThemeHead({
  saved = null,
  systemDark = false,
  blockedStorage = false,
  blockedMedia = false,
}: {
  saved?: string | null;
  systemDark?: boolean;
  blockedStorage?: boolean;
  blockedMedia?: boolean;
} = {}) {
  const classes = new Set(["font-geist", "light"]);
  const root = {
    classList: {
      remove: (...names: string[]) =>
        names.forEach((name) => classes.delete(name)),
      add: (name: string) => classes.add(name),
    },
    style: { colorScheme: "" },
  };
  runInNewContext(INITIAL_THEME_SCRIPT, {
    document: { documentElement: root },
    window: {
      localStorage: {
        getItem: () => {
          if (blockedStorage) throw new Error("Storage blocked");
          return saved;
        },
      },
      matchMedia: () => {
        if (blockedMedia) throw new Error("Media unavailable");
        return { matches: systemDark };
      },
    },
  });
  return { classes: [...classes].sort(), scheme: root.style.colorScheme };
}

describe("theme before first paint", () => {
  test.each([
    { saved: "dark", systemDark: false, expected: "dark" },
    { saved: "light", systemDark: true, expected: "light" },
    { saved: "system", systemDark: true, expected: "dark" },
    { saved: null, systemDark: true, expected: "dark" },
    { saved: "invalid", systemDark: true, expected: "dark" },
    { saved: null, systemDark: false, expected: "light" },
    { blockedStorage: true, systemDark: true, expected: "dark" },
    { blockedStorage: true, blockedMedia: true, expected: "light" },
    { saved: "dark", blockedMedia: true, expected: "dark" },
  ])(
    "applies $expected without application bundles: %j",
    ({ expected, ...settings }) => {
      const result = parseThemeHead(settings);
      expect(result.scheme).toBe(expected);
      expect(result.classes).toEqual([expected, "font-geist"].sort());
    },
  );

  test("runs directly in the document head before content, without a deferred script queue", () => {
    const layout = readFileSync(
      new URL("../../app/layout.tsx", import.meta.url),
      "utf8",
    );
    const head = layout.slice(
      layout.indexOf("<head>"),
      layout.indexOf("</head>"),
    );
    expect(head).toContain('<script\n          id="initial-theme"');
    expect(head).toContain("__html: INITIAL_THEME_SCRIPT");
    expect(head).not.toContain("<Script");
    expect(layout.indexOf("</head>")).toBeLessThan(layout.indexOf("<body"));
  });
});
