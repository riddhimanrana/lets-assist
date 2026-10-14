import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { ledgerDigest } from "./final-schema-manifest.mjs";
import { maintenanceTarget } from "./maintenance-preflight.mjs";
import { migrationDigests } from "./migration-digests.mjs";
import {
  candidateOnlyVersions,
  developmentOnlyVersions,
  reviewedCandidateVersions,
  reviewedDevelopmentVersions,
} from "./reconciliation-ledgers.mjs";

const root = new URL("../../", import.meta.url).pathname;
const combined = expectedVersions(root);
const candidate = reviewedCandidateVersions(combined);
const development = reviewedDevelopmentVersions(combined);

test("the exact Development and PR #873 histories survive the combined ledger", () => {
  assert.equal(combined.length, 738);
  assert.equal(
    ledgerDigest(combined),
    "ac438ba004623343ecb6925cf451dcc31e1f9a868f41d3504e6b0673b774351d",
  );
  assert.equal(candidate.length, 732);
  assert.equal(
    ledgerDigest(candidate),
    "30474c44971426ef8a8fdabaef1981113bb85791b6abce595c3a3181e8dd0f6a",
  );
  assert.equal(development.length, 729);
  assert.equal(
    ledgerDigest(development),
    "5683053e8fc69f99c841ece8d1c0f8447dba68a933369692a94ae1fc0703e90c",
  );
  assert.deepEqual(
    combined.filter((version) => !development.includes(version)),
    candidateOnlyVersions,
  );
  assert.deepEqual(
    combined.filter((version) => !candidate.includes(version)),
    developmentOnlyVersions,
  );
});

test("all fifteen newly joined migration files retain their reviewed bytes", () => {
  const names = readdirSync(
    new URL("../../supabase/migrations/", import.meta.url),
  );
  for (const version of [
    ...candidateOnlyVersions,
    ...developmentOnlyVersions,
  ]) {
    const matches = names.filter((name) => name.startsWith(`${version}_`));
    assert.equal(matches.length, 1, version);
    const [name] = matches;
    assert.equal(
      createHash("sha256")
        .update(
          readFileSync(
            new URL(`../../supabase/migrations/${name}`, import.meta.url),
          ),
        )
        .digest("hex"),
      migrationDigests[name],
      name,
    );
  }
});

test("the private roster schema requirement is present but the combined release stays blocked", () => {
  const release = JSON.parse(
    readFileSync(
      new URL(
        "../../lib/plugins/private/plugins/dvhs-csf/release.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(release.requiredPlatformSchemaVersion, "20261011110000");
  assert.ok(combined.includes(release.requiredPlatformSchemaVersion));
  assert.ok(combined.includes("20261012002404"));
  assert.throws(() => maintenanceTarget(root), /explicit release review/u);
});
