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
fixture("depth.txt");
fixture("one/first.txt");
fixture("one/two/second.txt");
fixture("one/two/three/third.txt");
fixture("static-export/index.html");
fixture("static-export/help/index.html");

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

test("absolute static-export patterns keep absolute paths without an absolute option", async () => {
  const exportRoot = join(root, "static-export");
  const pattern = join(exportRoot, "**", "*.html");
  const expected = [
    join(exportRoot, "index.html"),
    join(exportRoot, "help/index.html"),
  ].sort();
  for (const options of [{ cwd: root }, { cwd: root, absolute: false }]) {
    const sync = fg.globSync(pattern, options).sort();
    const asyncMatches = (await fg(pattern, options)).sort();
    expect(sync).toEqual(expected);
    expect(asyncMatches).toEqual(expected);
    expect(sync.map((path) => path.replace(exportRoot, ""))).toEqual([
      "/help/index.html",
      "/index.html",
    ]);
  }
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

test("fast-glob depth counts the starting directory", async () => {
  const filesAtDepth = [
    ["depth.txt"],
    ["depth.txt", "one/first.txt"],
    ["depth.txt", "one/first.txt", "one/two/second.txt"],
  ];
  for (const [index, expected] of filesAtDepth.entries()) {
    const deep = index + 1;
    expect(fg.globSync("**/*.txt", { cwd: root, deep }).sort()).toEqual(
      expected,
    );
    expect((await fg("**/*.txt", { cwd: root, deep })).sort()).toEqual(
      expected,
    );
  }
  expect(fg.globSync("one/**/*.txt", { cwd: root, deep: 2 }).sort()).toEqual([
    "one/first.txt",
    "one/two/second.txt",
  ]);
  expect((await fg("one/two/**/*.txt", { cwd: root, deep: 1 })).sort()).toEqual(
    ["one/two/second.txt"],
  );
});

test("directory results match fast-glob's path and globstar semantics", async () => {
  const expected = ["one/two", "one/two/three"];
  expect(fg.globSync("one/**", { cwd: root, onlyDirectories: true })).toEqual(
    expected,
  );
  expect(await fg("one/**", { cwd: root, onlyDirectories: true })).toEqual(
    expected,
  );
  expect(
    fg.globSync("one/**", {
      cwd: root,
      onlyDirectories: true,
      markDirectories: true,
    }),
  ).toEqual(["one/two/", "one/two/three/"]);
});
