import { describe, expect, test } from "bun:test";

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

function gitLsFiles(...patterns: string[]): string[] {
  const output = execFileSync("git", ["ls-files", "--", ...patterns], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return output.split("\n").filter((line) => line.length > 0);
}

describe("CSF source-data hygiene guard", () => {
  test(".gitignore excludes the real source-data directory", () => {
    const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    expect(gitignore.split("\n")).toContain("/docs/csf/source-data/");
  });

  test("no file under docs/csf/source-data is ever tracked", () => {
    expect(gitLsFiles("docs/csf/source-data")).toEqual([]);
  });

  test("workbook and mail formats under docs/csf stay inside curated directories", () => {
    const curatedPrefixes = ["docs/csf/evidence/", "docs/csf/reference/"];
    const tracked = gitLsFiles("docs/csf").filter((file) =>
      /\.(xlsx|xls|csv|eml|pdf)$/i.test(file),
    );
    const strays = tracked.filter(
      (file) => !curatedPrefixes.some((prefix) => file.startsWith(prefix)),
    );
    expect(strays).toEqual([]);
  });
});
