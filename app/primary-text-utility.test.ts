import { expect, test } from "bun:test";
import { compile } from "@tailwindcss/node";
import { readFileSync } from "node:fs";

test("primary text and fills use the same theme color", async () => {
  const compiler = await compile(
    readFileSync(new URL("./globals.css", import.meta.url), "utf8"),
    {
      base: process.cwd(),
      onDependency() {},
    },
  );
  const css = compiler.build([
    "text-primary",
    "hover:text-primary",
    "dark:text-primary",
    "text-primary/80",
    "bg-primary",
  ]);
  const fill = /\.bg-primary\s*\{([^}]+)\}/u.exec(css)?.[1];
  expect(fill).toContain("background-color: var(--primary)");
  for (const selector of [
    ".text-primary {",
    ".hover\\:text-primary:hover {",
    ".dark\\:text-primary:is(.dark *) {",
  ]) {
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThan(-1);
    const declarations = css.slice(start, css.indexOf("}", start));
    expect(declarations).toContain("color: var(--primary)");
    expect(declarations).not.toContain("color: var(--content-link)");
  }
  expect(css).toContain("color-mix(in oklab, var(--primary) 80%, transparent)");
});
