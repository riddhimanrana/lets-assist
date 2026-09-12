import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

export function updateEmbeddedServingExpectations(
  migrationTestsDir,
  pluginKey,
  version,
  sourceCommit,
) {
  const key = escapePattern(pluginKey);
  const columns = [
    ["latest_version", version],
    ["code_reference", sourceCommit],
  ];
  const updates = [];

  for (const file of readdirSync(migrationTestsDir).filter((name) =>
    name.endsWith(".test.sql"),
  )) {
    const path = join(migrationTestsDir, file);
    let source = readFileSync(path, "utf8");
    const targetsServingCatalog = source.includes(
      `FROM public.plugins WHERE key = '${pluginKey}'`,
    );
    if (!targetsServingCatalog) continue;

    for (const [column, expected] of columns) {
      const pattern = new RegExp(
        `(\\(SELECT ${column} FROM public\\.plugins WHERE key = '${key}'\\),\\n\\s*)'[^']+'`,
        "gu",
      );
      const matches = [...source.matchAll(pattern)];
      if (matches.length !== 1) {
        throw new Error(
          `${file} must contain one ${column} serving catalog expectation`,
        );
      }
      source = source.replace(pattern, `$1${sqlString(expected)}`);
    }
    updates.push([path, source]);
  }

  for (const [path, source] of updates) writeFileSync(path, source);
}
