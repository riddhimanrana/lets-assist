import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";
import fg from "fast-glob";

const root = mkdtempSync(join(tmpdir(), "lets-assist-glob-compat-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(path: string): void {
  const fullPath = join(root, path);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, "fixture");
}

fixture("microfrontends.json");
fixture("nested/microfrontends.jsonc");
fixture("node_modules/other/microfrontends.json");
fixture("app/help/page.tsx");
fixture("app/help/page.js");
fixture("app/admin/page.tsx");
fixture("app/.hidden/page.tsx");

test("Vercel config discovery keeps brace, absolute, and ignore semantics", () => {
  expect(
    fg
      .globSync("**/{microfrontends.json,microfrontends.jsonc}", {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        followSymbolicLinks: false,
        ignore: ["**/node_modules/**", "**/.git/**"],
      })
      .sort(),
  ).toEqual(
    [
      join(root, "microfrontends.json"),
      join(root, "nested/microfrontends.jsonc"),
    ].sort(),
  );
});

test("the Vercel Next config loader still discovers the host configuration", () => {
  const config = withMicrofrontends({ reactStrictMode: true });
  expect(typeof config.webpack).toBe("function");
  expect(typeof config.rewrites).toBe("function");
});

test("sitemap page discovery returns the same public route source set", async () => {
  expect(
    (await fg("app/**/page.{js,jsx,ts,tsx}", { cwd: root, dot: false })).sort(),
  ).toEqual(["app/admin/page.tsx", "app/help/page.js", "app/help/page.tsx"]);
});

test("test discovery accepts pattern arrays and excludes node_modules", async () => {
  expect(
    (
      await fg(["**/page.tsx", "**/page.js"], {
        cwd: root,
        ignore: ["**/node_modules/**"],
        onlyFiles: true,
        unique: true,
      })
    ).sort(),
  ).toEqual(["app/admin/page.tsx", "app/help/page.js", "app/help/page.tsx"]);
});
