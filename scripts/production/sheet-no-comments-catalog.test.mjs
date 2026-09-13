import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import {
  sheetNoCommentsDefinitions,
  sheetNoCommentsTables,
} from "./sheet-no-comments-catalog.mjs";

const versions = expectedVersions(process.cwd());
const source = readFileSync(
  "scripts/production/verify-csf-target-schema.sql",
  "utf8",
);

test("499 pins the no-comments transport function definitions and ACLs", () => {
  assert.equal(versions.length, 505);
  const current = acceptedCatalogQuery(source, versions.slice(0, 499));
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 498));
  for (const [signature, digest, body, service] of sheetNoCommentsDefinitions) {
    assert.ok(
      current.includes(`('${signature}','${digest}','${body}',${service})`),
    );
  }
  for (const [name, digest, denied] of sheetNoCommentsTables)
    assert.ok(current.includes(`('${name}','${digest}',${denied})`));
  for (const digest of [
    "06266c48d39c43f57bf10b560d3f62c9",
    "745fbb6ec18093cecb445dd5be6273f1",
    "55c423adec03f617d38e2f6ad2d6b243",
  ])
    assert.ok(!preceding.includes(digest));
});
