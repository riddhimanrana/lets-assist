import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { historyIdentityDefinitions } from "./history-identity-catalog.mjs";

const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const versions = expectedVersions(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const reviewed = versions.slice(0, 533);

test("reviewed history guards preserve the accepted 530 catalog byte for byte", () => {
  assert.equal(
    createHash("sha256")
      .update(acceptedCatalogQuery(source, versions.slice(0, 530)))
      .digest("hex"),
    "ab6ff3c70e366e50471bb81ab29dc3d4f8b66c68d13d553a9638139271b23e92",
  );
});

test("533 pins all eleven reviewed history and identity functions and their execution roles", () => {
  const query = acceptedCatalogQuery(source, reviewed);
  assert.equal(historyIdentityDefinitions.length, 11);
  for (const [
    signature,
    digest,
    service,
    definer,
    volatility,
  ] of historyIdentityDefinitions)
    assert.ok(
      query.includes(
        `('${signature}','${digest}',${service},${definer},'${volatility}')`,
      ),
    );
  assert.ok(query.includes("count(*)=11"));
  assert.ok(query.includes("a.grantor='postgres'::regrole"));
  assert.ok(query.includes("p.proowner='postgres'::regrole"));
  assert.ok(
    query.includes(
      "NOT has_function_privilege('authenticated',p.oid,'EXECUTE')",
    ),
  );
  assert.ok(
    query.includes("NOT has_function_privilege('anon',p.oid,'EXECUTE')"),
  );
  assert.ok(
    query.includes(
      "WHEN (SELECT valid FROM reviewed_history_identity_posture) AND (SELECT valid FROM accepted_upgrade_posture)",
    ),
  );
});

test("533 retains the full fixed-cap relation fingerprint and exact validated constraint", () => {
  const query = acceptedCatalogQuery(source, reviewed);
  assert.ok(
    query.includes(
      "('csf_opportunities','ca19166ee6970f30c58bf560dc1e311d',false)",
    ),
  );
  assert.ok(query.includes("k.conname='csf_opportunities_point_cap_check'"));
  assert.ok(query.includes("k.contype='c' AND k.convalidated"));
  assert.ok(query.includes("b3cb543817380b31299030dc23f802b0"));
  assert.ok(query.includes("db32b25e5818c2067614aebe169f4cb9"));
});

test("changed ledger entries and arbitrary future migrations do not inherit approval", () => {
  for (const index of [0, 529, 530, 531, 532]) {
    const altered = [...reviewed];
    altered[index] = "20990101000000";
    assert.throws(
      () => acceptedCatalogQuery(source, altered),
      /explicit release review/u,
    );
  }
  assert.throws(
    () => acceptedCatalogQuery(source, [...reviewed, "20990101000000"]),
    /explicit release review/u,
  );
});

test("new catalog construction fails closed if an inherited fingerprint is missing", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(
        source.replace("SELECT 1 / CASE\n", "SELECT 2 / CASE\n"),
        reviewed,
      ),
    /catalog.*contract changed/u,
  );
});

test("exact 534 publication preserves the reviewed 533 schema checks byte for byte", () => {
  const publication = versions.slice(0, 534);
  assert.equal(publication.length, 534);
  assert.equal(publication.at(-1), "20260915161001");
  assert.equal(
    acceptedCatalogQuery(source, publication),
    acceptedCatalogQuery(source, reviewed),
  );
  for (const index of [0, 529, 530, 531, 532, 533]) {
    const altered = [...publication];
    altered[index] = "20990101000000";
    assert.throws(
      () => acceptedCatalogQuery(source, altered),
      /explicit release review/u,
    );
  }
  assert.throws(
    () => acceptedCatalogQuery(source, [...publication, "20990101000000"]),
    /explicit release review/u,
  );
});
