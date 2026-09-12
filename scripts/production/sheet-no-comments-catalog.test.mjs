import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { sheetNoCommentsDefinitions } from "./sheet-no-comments-catalog.mjs";

const versions = expectedVersions(process.cwd());
const source = readFileSync(
  "scripts/production/verify-csf-target-schema.sql",
  "utf8",
);

test("499 pins the no-comments transport function definitions and ACLs", () => {
  assert.equal(versions.length, 500);
  const current = acceptedCatalogQuery(source, versions.slice(0, 499));
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 498));
  for (const [signature, digest, body, service] of sheetNoCommentsDefinitions) {
    assert.ok(
      current.includes(`('${signature}','${digest}','${body}',${service})`),
    );
  }
  for (const digest of [
    "9b853e618876d9cb5c9b48b70457e0a0",
    "49185542b46d06ce6fa6162344375c38",
    "e0b23b6940ffb13848fbb86a6802517e",
    "2d8b14c04e326df51e23ce2be331abd4",
  ])
    assert.ok(!preceding.includes(digest));
});
