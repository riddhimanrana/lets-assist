import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reviewedCatalogDataWrites } from "./reviewed-catalog-data-writes.mjs";
import {
  topLevelDataWrites,
  unreviewedWriteTables,
} from "./migration-data-writes.mjs";
test("catalog exceptions bind exact historical migration statements", () => {
  assert.equal(reviewedCatalogDataWrites.length, 90);
  for (const entry of reviewedCatalogDataWrites) {
    const sql = readFileSync(
      new URL(`../../supabase/migrations/${entry.file}`, import.meta.url),
      "utf8",
    );
    assert.ok(entry.file.startsWith(entry.migration));
    assert.ok(
      topLevelDataWrites(sql).some(
        (write) =>
          write.table === entry.table &&
          write.operation === entry.operation &&
          write.statement === entry.statement,
      ),
    );
    assert.ok(!unreviewedWriteTables(sql).includes(entry.table));
    const changed =
      entry.operation === "INSERT"
        ? sql.replace(/(VALUES\s*\(\s*)'dvhs-csf'/u, "$1'unreviewed-plugin'")
        : sql.replace(
            /SET latest_version = '[^']+'/,
            "SET latest_version = '99.0.0'",
          );
    assert.ok(unreviewedWriteTables(changed).includes(entry.table));
  }
});
test("catalog target alone never authorizes an unreviewed write", () => {
  assert.deepEqual(
    unreviewedWriteTables("UPDATE public.plugins SET latest_version='99.0.0';"),
    ["public.plugins"],
  );
});
